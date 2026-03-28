@echo off
echo ========================================
echo   RAGE REPLAY — Build Setup
echo ========================================
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found.
  echo Download from https://nodejs.org ^(LTS version^)
  pause
  exit /b 1
)

echo [1/4] Node.js found.

:: Install dependencies
echo [2/4] Installing dependencies...
call npm install
if errorlevel 1 (
  echo ERROR: npm install failed
  pause
  exit /b 1
)

:: Check for ffmpeg
if not exist "vendor\ffmpeg.exe" (
  echo.
  echo [3/4] ffmpeg not found in vendor\
  echo.
  echo  Download ffmpeg.exe from: https://github.com/BtbN/FFmpeg-Builds/releases
  echo  Pick: ffmpeg-master-latest-win64-gpl.zip
  echo  Extract ffmpeg.exe from the bin\ folder
  echo  Place it in:  vendor\ffmpeg.exe
  echo.
  mkdir vendor 2>nul
  echo  Created vendor\ folder. Add ffmpeg.exe there, then re-run this script.
  pause
  exit /b 1
)

echo [3/4] ffmpeg found.

:: Build installer
echo [4/4] Building installer...
call npm run build:win
if errorlevel 1 (
  echo ERROR: Build failed
  pause
  exit /b 1
)

echo.
echo ========================================
echo   BUILD COMPLETE
echo ========================================
echo.
echo  Installer: dist\Rage Replay Setup 1.0.0.exe
echo.
echo  Next steps:
echo  1. Test the installer on a clean Windows machine
echo  2. Upload to Gumroad as a product file
echo  3. Set your Gumroad product permalink to: ragereplay
echo  4. Update GUMROAD_PERMALINK in src\main\index.js if different
echo.
pause
