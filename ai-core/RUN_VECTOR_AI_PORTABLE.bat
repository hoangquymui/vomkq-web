@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-project.ps1" -Portable
if errorlevel 1 (
  echo [VECTOR AI] Khong chay duoc ban chia se. Xem loi phia tren.
  pause
  exit /b 1
)
