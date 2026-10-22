@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\prepare-runtime.ps1" %*
if errorlevel 1 (
  echo [VECTOR AI] Khong chuan bi duoc runtime. Xem loi phia tren.
  pause
  exit /b 1
)
echo [VECTOR AI] Da gom runtime vao du an.
pause
