const {
  app, BrowserWindow, globalShortcut, ipcMain,
  Tray, Menu, nativeImage, shell, dialog, clipboard
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const { spawn, execFileSync } = require('child_process');
const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

// ─── Store ────────────────────────────────────────────────────────────────────
const store = new Store({
  defaults: {
    license:    null,
    isPremium:  false,
    hotkey:     'F9',
    preSec:     15,
    postSec:    5,
    quality:    'medium',
    watermark:  true,
    saveDir:    path.join(app.getPath('videos'), 'RageReplay'),
    clips:      [],
    totalClips: 0
  }
});

// ─── Globals ──────────────────────────────────────────────────────────────────
let mainWindow   = null;
let tray         = null;
let ffmpegPath   = null;
let recProc      = null;
let recStartTime = null;
let rollingFile  = null;
let isRecording  = false;
let exportBusy   = false;
const isDev      = process.argv.includes('--dev');
const tmpDir     = path.join(app.getPath('temp'), 'ragereplay');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── ffmpeg path ──────────────────────────────────────────────────────────────
function getFFmpegPath() {
  const vendorPath = path.join(__dirname, '../../vendor/ffmpeg.exe');
  if (fs.existsSync(vendorPath)) return vendorPath;
  if (!isDev) return path.join(process.resourcesPath, 'ffmpeg.exe');
  return 'ffmpeg';
}

function ensureDirs() {
  [tmpDir, store.get('saveDir')].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function send(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, payload);
  }
}

function log(...args) { console.log('[RR]', ...args); }

// ─── Kill ffmpeg (Windows-reliable) ──────────────────────────────────────────
function killFFmpeg(proc) {
  if (!proc || proc.exitCode !== null) return;
  try { proc.stdin.write('q'); } catch (_) {}
  setTimeout(() => {
    if (proc && proc.exitCode === null) {
      try { execFileSync('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { windowsHide: true }); }
      catch (_) { try { proc.kill('SIGKILL'); } catch (__) {} }
    }
  }, 1500);
}

// ─── Audio device probe ───────────────────────────────────────────────────────
// Priority: VB-Cable → Stereo Mix → other loopback → null (video-only)
// Logs full device list to console for debugging.
async function probeAudioDevice() {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, [
      '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });

    let output = '';
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('close', () => {
      log('=== dshow raw output ===');
      output.split('\n').forEach(l => l.trim() && log(l));
      log('========================');

      // Modern ffmpeg (2024+) dropped "DirectShow audio devices" header.
      // Now all devices appear as: [in#0 @ ...] "Device Name" (audio)
      // We collect every line that ends with (audio) and extract the quoted name.
      const audioDevices = [];
      for (const line of output.split('\n')) {
        // Skip @device_... alternative name lines
        if (line.includes('@device_')) continue;
        // Match lines with (audio) tag — works for both old and new ffmpeg format
        if (!line.includes('(audio)')) continue;
        const m = line.match(/"([^"]{2,})"/);
        if (m) audioDevices.push(m[1]);
      }

      log('Audio devices found:', audioDevices);

      if (audioDevices.length === 0) {
        log('No audio devices — video-only');
        resolve(null);
        return;
      }

      // Priority checks — first match wins
      const checks = [
        d => d.toLowerCase().includes('cable output'),   // VB-Audio VB-Cable
        d => d.toLowerCase().includes('stereo mix'),
        d => d.toLowerCase().includes('what u hear'),
        d => d.toLowerCase().includes('wave out mix'),
        d => d.toLowerCase().includes('loopback'),
        d => d.toLowerCase().includes('output'),         // generic output device
      ];

      for (const check of checks) {
        const found = audioDevices.find(check);
        if (found) {
          log('Selected audio device:', found);
          resolve(found);
          return;
        }
      }

      // Nothing matched — log and go video-only (microphone would be annoying)
      log('No loopback device found. Devices available:', audioDevices.join(', '));
      log('→ Install VB-Cable from vb-audio.com/Cable or enable Stereo Mix in Windows Sound settings');
      resolve(null);
    });

    proc.on('error', () => resolve(null));
    setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(null); }, 5000);
  });
}

// ─── Recording ────────────────────────────────────────────────────────────────
// Records ONE continuous file (max 3 min). On trigger: stop → trim last N seconds → restart.
// No segment muxer races. Simple and reliable.
async function startRecording() {
  if (isRecording || exportBusy) return;
  ensureDirs();

  rollingFile  = path.join(tmpDir, `rolling_${Date.now()}.mp4`);
  recStartTime = Date.now();

  const q = { high: { crf: '18', fps: '60' }, medium: { crf: '23', fps: '30' }, low: { crf: '28', fps: '30' } };
  const { crf, fps } = q[store.get('quality')] || q.medium;

  // WASAPI loopback = captures game audio with no extra drivers.
  // We detect the loopback device name first (async), then build args.
  const videoArgs = [
    '-f',         'gdigrab',
    '-framerate',  fps,
    '-i',         'desktop',
  ];
  const encodeArgs = [
    '-c:v',       'libx264',
    '-crf',        crf,
    '-preset',    'ultrafast',
    '-pix_fmt',   'yuv420p',
    '-t',         '180',
  ];

  // Probe dshow audio devices. Stereo Mix = captures what plays through speakers.
  // User must enable Stereo Mix in Windows: Sound Settings → Recording → Show Disabled.
  const audioDevice = await probeAudioDevice();
  let args;
  if (audioDevice) {
    log(`Using audio: "${audioDevice}"`);
    args = [
      '-y',
      ...videoArgs,
      '-f', 'dshow', '-i', `audio=${audioDevice}`,
      ...encodeArgs,
      '-c:a', 'aac', '-b:a', '128k',
      rollingFile
    ];
  } else {
    log('No loopback audio — recording video-only');
    args = ['-y', ...videoArgs, ...encodeArgs, '-an', rollingFile];
  }

  log('Starting recorder...');
  recProc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });

  let started = false;
  recProc.stderr.on('data', d => {
    const line = d.toString();
    if (!started && line.includes('frame=')) {
      started    = true;
      isRecording = true;
      send('recording-status', { recording: true });
      log('Buffer recording active');
    }
  });

  recProc.on('error', err => {
    log('Spawn error:', err.message);
    isRecording = false;
    send('recording-error',
      err.code === 'ENOENT'
        ? 'ffmpeg not found. Put ffmpeg.exe in the vendor/ folder and restart.'
        : err.message
    );
  });

  recProc.on('close', code => {
    log('Recorder closed, code:', code);
    isRecording = false;
    recProc     = null;
    send('recording-status', { recording: false });
    // Only auto-restart if NOT mid-export. If exportBusy, triggerClip() restarts after export.
    if (!app.isQuitting && !exportBusy) {
      log('Auto-restart (idle close)');
      setTimeout(startRecording, 1500);
    }
  });
}

// ─── Trigger ──────────────────────────────────────────────────────────────────
async function triggerClip() {
  if (!isRecording) {
    send('clip-error', 'Not recording yet — wait a moment after launch.');
    return;
  }
  if (exportBusy) {
    send('clip-error', 'Still processing last clip, wait a second.');
    return;
  }

  exportBusy = true;
  send('clip-triggered', {});

  const isPrem   = store.get('isPremium');
  const preSec   = store.get('preSec');
  const postSec  = store.get('postSec');
  const maxDur   = isPrem ? 90 : 15;
  const clipDur  = Math.min(preSec + postSec, maxDur);
  const elapsed  = (Date.now() - recStartTime) / 1000;

  if (elapsed < 4) {
    send('clip-error', 'Recording just started — wait a few seconds and try again.');
    exportBusy = false;
    return;
  }

  // Collect post-trigger buffer
  const waitMs = Math.min(postSec, isPrem ? 30 : 5) * 1000;
  await sleep(waitMs);

  // Snapshot current recording state
  const snapFile    = rollingFile;
  const snapElapsed = (Date.now() - recStartTime) / 1000;

  log(`Stopping recorder (elapsed ${snapElapsed.toFixed(1)}s) to export`);

  // Stop recorder — it auto-restarts via close handler AFTER export finishes
  if (recProc) killFFmpeg(recProc);

  // Wait for ffmpeg to flush & close the file
  await sleep(2500);

  await exportClip(snapFile, snapElapsed, clipDur);
  exportBusy = false;
  // close handler already fired during export (exportBusy was true then, so it skipped restart).
  // We must explicitly restart here.
  if (!app.isQuitting) {
    log('Restarting recorder after export');
    setTimeout(startRecording, 500);
  }
}

async function exportClip(sourceFile, totalSec, clipDur) {
  if (!fs.existsSync(sourceFile)) {
    send('clip-error', 'Buffer file missing — recording may have failed.');
    return;
  }
  const size = fs.statSync(sourceFile).size;
  if (size < 5000) {
    send('clip-error', 'Buffer file too small — try recording for 5+ seconds first.');
    return;
  }

  ensureDirs();
  const saveDir = store.get('saveDir');
  const clipId  = uuidv4();
  const outFile = path.join(saveDir, `clip_${Date.now()}.mp4`);
  const isPrem    = store.get('isPremium');
  const wmark     = store.get('watermark') || !isPrem;
  const startSs   = Math.max(0, totalSec - clipDur);
  const wmPng     = path.join(__dirname, '../../assets/watermark.png');
  const hasWmPng  = fs.existsSync(wmPng);

  log(`Export: ss=${startSs.toFixed(1)} dur=${clipDur} wmark=${wmark} wmPng=${hasWmPng} size=${(size/1024/1024).toFixed(1)}MB`);

  // PNG overlay — no fontconfig, no font paths, works on all Windows ffmpeg builds
  // -c:a copy passes through audio from the buffer file (if present), no re-encode needed
  const args = (wmark && hasWmPng) ? [
    '-y',
    '-ss',  String(startSs),
    '-i',   sourceFile,
    '-i',   wmPng,
    '-t',   String(clipDur),
    '-filter_complex', 'overlay=W-w-16:H-h-16',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'fast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '128k',
    outFile
  ] : [
    '-y',
    '-ss',  String(startSs),
    '-i',   sourceFile,
    '-t',   String(clipDur),
    '-c:v', 'libx264', '-crf', '20', '-preset', 'fast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '128k',
    outFile
  ];

  await new Promise(resolve => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let lastErr = '';

    proc.stderr.on('data', d => {
      const line = d.toString();
      lastErr = line;
      const m = line.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m) {
        const done = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
        send('clip-processing', { progress: Math.min(99, Math.round(done / clipDur * 100)) });
      }
    });

    proc.on('error', err => {
      send('clip-error', err.code === 'ENOENT' ? 'ffmpeg not found' : err.message);
      resolve();
    });

    proc.on('close', code => {
      if (code !== 0) {
        log('Export failed, last stderr:', lastErr.slice(-300));
        send('clip-error', `Export failed (exit ${code}) — check that ffmpeg.exe is in vendor/`);
        resolve();
        return;
      }

      if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1000) {
        send('clip-error', 'Output file not created or empty');
        resolve();
        return;
      }

      const clip = {
        id:        clipId,
        path:      outFile,
        duration:  clipDur,
        size:      fs.statSync(outFile).size,
        createdAt: Date.now()
      };

      const clips = store.get('clips');
      clips.unshift(clip);
      if (clips.length > 200) clips.pop();
      store.set('clips', clips);
      store.set('totalClips', store.get('totalClips') + 1);
      send('clip-ready', clip);
      log('Clip saved:', outFile);

      try { fs.unlinkSync(sourceFile); } catch (_) {}
      resolve();
    });
  });
}

// ─── Share ────────────────────────────────────────────────────────────────────
function shareClip(clipPath, platform) {
  if (platform === 'folder' || platform === 'discord') { shell.showItemInFolder(clipPath); return; }
  if (platform === 'copy') { clipboard.writeText(clipPath); send('share-done', { platform }); return; }
  const urls = { tiktok: 'https://www.tiktok.com/upload', youtube: 'https://studio.youtube.com', twitter: 'https://twitter.com/compose/tweet' };
  if (urls[platform]) { shell.openExternal(urls[platform]); setTimeout(() => shell.showItemInFolder(clipPath), 800); }
}

// ─── License ──────────────────────────────────────────────────────────────────
async function validateLicense(key) {
  const PERMALINK = 'ragereplay';
  try {
    const res  = await fetch(`https://api.gumroad.com/v2/licenses/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `product_permalink=${PERMALINK}&license_key=${encodeURIComponent(key)}&increment_uses_count=false`
    });
    const data = await res.json();
    if (data.success) { store.set('license', key); store.set('isPremium', true); send('license-valid', { email: data.purchase?.email || '' }); return true; }
    send('license-invalid', data.message || 'Invalid key');
    return false;
  } catch {
    if (store.get('license') === key) { store.set('isPremium', true); send('license-valid', { email: '(offline)' }); return true; }
    send('license-invalid', 'Network error');
    return false;
  }
}

// ─── Window & Tray ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420, height: 600, minWidth: 380, minHeight: 520,
    frame: false, backgroundColor: '#0a0a0a', resizable: true,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    show: false
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', e => { e.preventDefault(); mainWindow.hide(); });
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function buildTray() {
  if (tray) { try { tray.destroy(); } catch (_) {} }
  const iconPath = path.join(__dirname, '../../assets/tray.ico');
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Rage Replay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Rage Replay', enabled: false },
    { type: 'separator' },
    { label: `Trigger  [${store.get('hotkey')}]`, click: () => triggerClip() },
    { label: 'Open', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => mainWindow.show());
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-store',         (_, k)    => store.get(k));
ipcMain.handle('set-store',         (_, k, v) => store.set(k, v));
ipcMain.handle('start-recording',   ()        => startRecording());
ipcMain.handle('stop-recording',    ()        => { if (recProc) killFFmpeg(recProc); });
ipcMain.handle('trigger-clip',      ()        => triggerClip());
ipcMain.handle('share-clip',        (_, p, l) => shareClip(p, l));
ipcMain.handle('open-clip',         (_, p)    => shell.openPath(p));
ipcMain.handle('delete-clip', (_, id) => {
  const clips = store.get('clips');
  const c = clips.find(x => x.id === id);
  if (c?.path && fs.existsSync(c.path)) try { fs.unlinkSync(c.path); } catch (_) {}
  store.set('clips', clips.filter(x => x.id !== id));
});
ipcMain.handle('validate-license',  (_, k)    => validateLicense(k));
ipcMain.handle('revoke-license',    ()        => { store.set('license', null); store.set('isPremium', false); });
ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) { store.set('saveDir', r.filePaths[0]); return r.filePaths[0]; }
  return null;
});
ipcMain.handle('register-hotkey', (_, key) => {
  globalShortcut.unregisterAll();
  try {
    const ok = globalShortcut.register(key, () => triggerClip());
    if (ok) { store.set('hotkey', key); buildTray(); }
    return ok;
  } catch { return false; }
});
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-hide',     () => mainWindow?.hide());

// ─── Lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ffmpegPath = getFFmpegPath();
  log('ffmpeg:', ffmpegPath, '| exists:', fs.existsSync(ffmpegPath));
  createWindow();
  buildTray();
  try { globalShortcut.register(store.get('hotkey'), () => triggerClip()); } catch (_) {}
  setTimeout(startRecording, 2000);
});

app.on('will-quit', () => { app.isQuitting = true; globalShortcut.unregisterAll(); if (recProc) killFFmpeg(recProc); });
app.on('window-all-closed', e => e.preventDefault());
