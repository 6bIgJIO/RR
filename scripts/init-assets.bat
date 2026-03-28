@echo off
echo Creating placeholder icons for build...
mkdir assets 2>nul
mkdir vendor 2>nul
copy nul assets\icon.ico >nul 2>&1
copy nul assets\tray.ico >nul 2>&1
echo Done. Replace these with real icons before publishing.
echo.
echo Open https://www.favicon-generator.org/ to generate icons from any image.
