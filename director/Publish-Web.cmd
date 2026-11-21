@echo off
cd /d "%~dp0"
set "SHARE=%~dp0..\share"
set "WEBDIR=%SHARE%\web"
if not exist "%WEBDIR%" mkdir "%WEBDIR%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sync-WebPublish.ps1" -DirectorRoot "%~dp0." -WebDir "%WEBDIR%"
if errorlevel 1 (
  echo Publish failed ^(Sync-WebPublish.ps1^), error %ERRORLEVEL%.
  exit /b %ERRORLEVEL%
)
echo Published to %WEBDIR%
echo Soft-refresh (F5) should pick it up; hard refresh if a tab still looks stale.