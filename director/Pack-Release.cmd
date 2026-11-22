@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Pack-Release.ps1" %*
if errorlevel 1 (
  echo Pack-Release failed, error %ERRORLEVEL%.
  exit /b %ERRORLEVEL%
)