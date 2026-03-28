# ⬡ Rage Replay

Instant gaming clip capture for Windows. Press a hotkey → get a shareable clip. No BS.

---

## What it does

- **Continuous buffer recording** — always recording in the background, 30–60fps
- **One-key trigger** — F9 (or any key) saves the last N seconds + N seconds after
- **1-click share** — TikTok, YouTube Shorts, Twitter, Discord
- **Watermark** on free tier, removable with a license key
- **Lives in the tray** — zero UI friction while gaming

---

## Stack

- **Electron** — cross-platform desktop shell
- **ffmpeg** (gdigrab) — screen capture + clip export
- **electron-store** — local settings & clip library
- **Gumroad API** — license validation

---

## Setup & Build (5 steps)

### Prerequisites
- Node.js 18+ (https://nodejs.org)
- Git (optional)

### Step 1 — Clone / extract the project
```
cd C:\Users\YOU\Desktop
```

### Step 2 — Get ffmpeg
1. Go to https://github.com/BtbN/FFmpeg-Builds/releases
2. Download `ffmpeg-master-latest-win64-gpl.zip`
3. Extract → find `bin\ffmpeg.exe`
4. Copy it to `vendor\ffmpeg.exe` inside this project

### Step 3 — Build
```
scripts\build.bat
```
This runs `npm install` + `electron-builder` and outputs:
```
dist\Rage Replay Setup 1.0.0.exe
```

### Step 4 — Test locally
Run `npm start` (dev mode) first. Test:
- F9 triggers a clip
- Clip appears in the Clips tab
- Share buttons open the right URLs
- Settings save between restarts

### Step 5 — Deploy to Gumroad

1. Go to https://app.gumroad.com/products/new
2. Set product type: **Digital Product**
3. Upload `dist\Rage Replay Setup 1.0.0.exe` as the product file
4. **CRITICAL**: Set permalink to exactly `ragereplay`
   (or update `PRODUCT_PERMALINK` in `src/main/index.js`)
5. Set price: $9–12 one-time (see Pricing below)
6. Enable "Generate unique license keys" in product settings
7. Publish

---

## Gumroad License Flow

When a user buys:
1. Gumroad emails them a license key automatically
2. They open Rage Replay → Settings → paste key → ACTIVATE
3. App calls `https://api.gumroad.com/v2/licenses/verify`
4. On success: watermark removed, clip limit lifted, Premium badge shown
5. Works offline after first validation (key stored locally)

---

## Pricing Strategy

| Plan | Price | Limits |
|------|-------|--------|
| Free | $0 | 15s clips, watermark |
| Premium | $9 one-time | 90s clips, no watermark, all quality options |

**Why $9?** Under $10 impulse-buy threshold. Gamers pay this for a skin.

**Optional upsell later:**
- $19 lifetime (when you have reviews)
- $3/mo subscription (when you have cloud features)

---

## Changing the hotkey default

In `src/main/index.js` line ~30:
```js
hotkey: 'F9',
```
Change to `F8`, `F10`, `Alt+Z`, etc.

---

## Updating the Gumroad URL

In `src/renderer/index.html`, find:
```js
window.open('https://gumroad.com/l/ragereplay', '_blank');
```
Replace `ragereplay` with your actual Gumroad permalink.

---

## Distribution checklist

- [ ] Test installer on a fresh Windows 10 machine
- [ ] Test installer on Windows 11
- [ ] Verify F9 works in a full-screen game (try Minecraft/Fortnite windowed first)
- [ ] Verify clip saves to Videos\RageReplay
- [ ] Verify Gumroad license key activates correctly
- [ ] Verify Premium removes watermark
- [ ] Upload to Gumroad
- [ ] Post demo clip on TikTok/Reddit r/gaming

---

## Known limits of the free recording method (gdigrab)

- Works for windowed and borderless-windowed games
- **Does NOT capture exclusive fullscreen** DirectX games reliably
  → Tell users to run games in "Borderless Window" mode (standard practice for capture tools)
- Audio: gdigrab captures video only. Audio capture requires dshow — add later if requested
- Performance: ultrafast preset means CPU usage ~5–15% on modern hardware

---

## Folder structure

```
rage-replay/
├── src/
│   ├── main/index.js        ← Electron main process, recording, IPC
│   ├── renderer/index.html  ← UI (HTML/CSS/JS, no framework)
│   └── preload/index.js     ← Secure bridge main ↔ renderer
├── assets/
│   ├── icon.ico             ← App icon (create 256x256 ICO)
│   └── tray.ico             ← Tray icon (create 16x16 ICO)
├── vendor/
│   └── ffmpeg.exe           ← YOU MUST ADD THIS
├── scripts/
│   └── build.bat            ← Build script
└── package.json
```

---

## Creating icons (required for build)

Use any of these free tools:
- https://www.favicon-generator.org/ (upload a PNG → download ICO)
- https://convertico.com/
- Or hire someone on Fiverr for $5

Place:
- `assets/icon.ico` — 256x256 (shown in taskbar, installer)
- `assets/tray.ico` — 16x16 (shown in system tray)

**Quick hack**: Create two placeholder files to unblock the build:
```
copy nul assets\icon.ico
copy nul assets\tray.ico
```
Then replace with real icons before publishing.

---

## Go-to-market (first 100 users)

1. **Record a 30s demo** showing the app saving a sick gaming moment
2. Post on:
   - r/gaming, r/pcgaming, r/ShadowPlay (yes really, they complain there)
   - Discord servers for popular games (Fortnite, Valorant, CS2)
   - TikTok with #gaming #gamingclips
3. **Lead with the pain**: "ShadowPlay stopped working / requires login / uploads to Nvidia servers — this is the 5MB offline alternative"
4. **Virality mechanic**: The watermark IS your marketing. Free users spread "RAGE REPLAY" in every clip they share.

---

## Revenue math

| Users | Free→Premium rate | Monthly |
|-------|------------------|---------|
| 200 | 10% = 20 sales | $180 |
| 1,000 | 10% = 100 sales | $900 |
| 5,000 | 10% = 500 sales | $4,500 |

Gumroad takes 10% fee.
