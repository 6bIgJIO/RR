const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rr', {
  // Store
  get: (key) => ipcRenderer.invoke('get-store', key),
  set: (key, value) => ipcRenderer.invoke('set-store', key, value),

  // Recording
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  triggerClip: () => ipcRenderer.invoke('trigger-clip'),

  // Clips
  shareClip: (clipPath, platform) => ipcRenderer.invoke('share-clip', clipPath, platform),
  deleteClip: (clipId) => ipcRenderer.invoke('delete-clip', clipId),
  openClip: (clipPath) => ipcRenderer.invoke('open-clip', clipPath),

  // License
  validateLicense: (key) => ipcRenderer.invoke('validate-license', key),
  revokeLicense: () => ipcRenderer.invoke('revoke-license'),

  // Settings
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  registerHotkey: (key) => ipcRenderer.invoke('register-hotkey', key),

  // Window
  minimize: () => ipcRenderer.invoke('window-minimize'),
  hide: () => ipcRenderer.invoke('window-hide'),

  // Events from main → renderer
  on: (event, cb) => {
    const handler = (_, ...args) => cb(...args);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.removeListener(event, handler);
  }
});
