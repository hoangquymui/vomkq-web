@echo off
setlocal
cd /d "%~dp0"
title VECTOR AI - Legacy data migration
call npm run tauri -- dev --config src-tauri/tauri.migration.conf.json
if errorlevel 1 pause
