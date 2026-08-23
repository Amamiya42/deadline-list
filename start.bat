@echo off
rem deadline清单 启动脚本
rem 防御性清除 ELECTRON_RUN_AS_NODE：若该变量被设置（某些开发工具会注入），
rem electron.exe 会退化成普通 Node 模式导致启动失败。这里启动前强制清空。
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" .
