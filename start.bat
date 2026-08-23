@echo off
rem deadline-list launcher
rem Clear ELECTRON_RUN_AS_NODE defensively: some dev tools inject it, which
rem makes electron.exe run as plain Node and fail to start the app.
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" .
