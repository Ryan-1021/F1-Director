@echo off
cd /d "%~dp0"
set "SHARE=%~dp0..\share"
set "WEBDIR=%SHARE%\web"
if not exist "%WEBDIR%" mkdir "%WEBDIR%" >nul 2>&1
set "NEEDS_STAMP=0"
for /f "tokens=1,2 delims==" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sync-WebPublish.ps1" -DirectorRoot "%~dp0." -WebDir "%WEBDIR%" 2^>nul') do (
  if /i "%%a"=="NEEDS_STAMP" set "NEEDS_STAMP=%%b"
)
if "%NEEDS_STAMP%"=="1" if exist "%~dp0..\VERSION" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stamp-WindowTitle.ps1" -WebDir "%WEBDIR%" -VersionFile "%~dp0..\VERSION"
)
echo Published to %WEBDIR%
echo Soft-refresh (F5) should pick it up; hard refresh if a tab still looks stale.