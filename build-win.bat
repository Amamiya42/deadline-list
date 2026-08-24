@echo off
chcp 65001 >nul
cd /d "%~dp0"
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo 正在打包 Windows 版本（x64 / x86 / arm64）...
call npx electron-builder --win
echo.
echo 完成！产物在 dist 文件夹里。
pause
