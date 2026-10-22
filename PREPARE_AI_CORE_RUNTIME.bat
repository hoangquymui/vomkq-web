@echo off
setlocal
REM ============================================================================
REM  AI CORE (VECTOR AI) - chuan bi moi truong chay portable
REM  Dung khi may chua co Ollama hoac bundle Python trong ai-core/runtime.
REM ============================================================================
cd /d "%~dp0ai-core"
if not exist "scripts\prepare-runtime.ps1" (
  echo [AI CORE] Khong tim thay scripts\prepare-runtime.ps1 trong ai-core.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\prepare-runtime.ps1" %*
if errorlevel 1 (
  echo.
  echo [AI CORE] Khong chuan bi duoc runtime portable.
  echo - Can backend\.venv tren may nay (python -m venv backend\.venv ^&^& pip install -r backend\requirements.txt)
  echo - Can Node.js va Ollama da cai dat de gom vao bundle.
  pause
  exit /b 1
)
echo.
echo [AI CORE] Runtime da san sang trong ai-core\runtime\bundles.
pause