@echo off
setlocal EnableDelayedExpansion
title VECTOR AI - Development
cd /d "%~dp0"

if exist "runtime\active.json" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-project.ps1" -Development
  if errorlevel 1 goto :error
  exit /b 0
)

if not exist "node_modules" (
  echo [VECTOR AI] Dang cai thu vien lan dau...
  call npm install
  if errorlevel 1 goto :error
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo [VECTOR AI] Dang tao moi truong Python Core...
  python -m venv "backend\.venv"
  if errorlevel 1 goto :error
)

"backend\.venv\Scripts\python.exe" -c "import fastapi,uvicorn,httpx,sympy,langgraph,pypdf,fitz" >nul 2>&1
if errorlevel 1 (
  echo [VECTOR AI] Dang cai thu vien Python Core lan dau...
  pushd "backend"
  ".venv\Scripts\python.exe" -m pip install -r "requirements.txt"
  set "PIP_RESULT=%ERRORLEVEL%"
  popd
  if not "!PIP_RESULT!"=="0" goto :error
)

echo [VECTOR AI] Dang khoi dong che do phat trien...
call npm run desktop
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo [VECTOR AI] Khoi dong that bai. Hay xem loi o phia tren.
pause
exit /b 1
