@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\export-project.ps1" %*
if errorlevel 1 (
  echo [VECTOR AI] Xuat du an that bai.
  pause
  exit /b 1
)
pause
