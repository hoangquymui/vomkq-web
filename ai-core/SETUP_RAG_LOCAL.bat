@echo off
setlocal
title VECTOR AI - Setup local RAG
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-rag.ps1" %*
if errorlevel 1 (
  echo.
  echo [VECTOR AI] Thiet lap RAG that bai. Xem thong bao phia tren.
  pause
  exit /b 1
)
echo.
echo [VECTOR AI] Hoan tat thiet lap duoc yeu cau.
pause
