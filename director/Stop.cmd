@echo off
cd /d "%~dp0"
title F1 Director - Stop
echo Stopping F1 Director (jar on port 8720)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Director.ps1"
echo.
echo Done. You can close this window.
pause
