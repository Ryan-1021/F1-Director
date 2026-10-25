@echo off
cd /d "%~dp0"
title F1 Director Console

rem Find share pack: sibling ../share, or jar beside / above this script.
set "SHARE="
if exist "%~dp0..\share\F1-RaceControl-Desktop-0.1.15_modify.jar" (
  set "SHARE=%~dp0..\share"
)
if not defined SHARE if exist "%~dp0..\F1-RaceControl-Share-0.1.10-win64\F1-RaceControl-Desktop.jar" (
  set "SHARE=%~dp0..\F1-RaceControl-Share-0.1.10-win64"
)
if not defined SHARE if exist "%~dp0F1-RaceControl-Desktop-0.1.15_modify.jar" (
  set "SHARE=%~dp0."
)
if not defined SHARE if exist "%~dp0..\F1-RaceControl-Desktop-0.1.15_modify.jar" (
  set "SHARE=%~dp0.."
)
if not defined SHARE (
  echo Cannot find F1-RaceControl-Desktop-0.1.15_modify.jar
  echo Put this director folder next to the share folder:
  echo   F1-Director\director
  echo   F1-Director\share
  echo or copy these files into the share pack folder.
  pause
  exit /b 1
)

set "JAVA_EXE=%SHARE%\jre\bin\java.exe"
set "JAR=%SHARE%\F1-RaceControl-Desktop-0.1.15_modify.jar"
if not exist "%JAR%" if exist "%SHARE%\F1-RaceControl-Desktop.jar" set "JAR=%SHARE%\F1-RaceControl-Desktop.jar"
if not exist "%JAVA_EXE%" (
  echo jre\bin\java.exe not found under:
  echo   %SHARE%
  echo Keep the jre folder from the share pack.
  pause
  exit /b 1
)
if not exist "%JAR%" (
  echo Jar not found: %JAR%
  pause
  exit /b 1
)

set "HTML=%~dp0director.html"
if not exist "%HTML%" (
  echo director.html missing next to Start.cmd
  pause
  exit /b 1
)

echo Share pack: %SHARE%
echo.

rem Publish director + patched board JS into the jar web/ override so
rem the UI is served from http://127.0.0.1:8720/director.html (same origin).
set "WEBDIR=%SHARE%\web"
if not exist "%WEBDIR%" mkdir "%WEBDIR%" >nul 2>&1
if exist "%~dp0web-override\app.js" (
  copy /Y "%~dp0web-override\app.js" "%WEBDIR%\app.js" >nul
  copy /Y "%~dp0web-override\trackmap-estimate.js" "%WEBDIR%\trackmap-estimate.js" >nul
  copy /Y "%~dp0web-override\rank-swap.js" "%WEBDIR%\rank-swap.js" >nul
  copy /Y "%~dp0web-override\board.html" "%WEBDIR%\board.html" >nul
  copy /Y "%~dp0web-override\index.html" "%WEBDIR%\index.html" >nul
  copy /Y "%~dp0web-override\style.css" "%WEBDIR%\style.css" >nul
)
if exist "%~dp0web-override\circuits" (
  if not exist "%WEBDIR%\circuits" mkdir "%WEBDIR%\circuits" >nul 2>&1
  xcopy /Y /Q /E "%~dp0web-override\circuits\*" "%WEBDIR%\circuits\" >nul
)
if exist "%~dp0web-override\icons" (
  if not exist "%WEBDIR%\icons" mkdir "%WEBDIR%\icons" >nul 2>&1
  xcopy /Y /Q /E "%~dp0web-override\icons\*" "%WEBDIR%\icons\" >nul
)
if exist "%~dp0web-override\favicon.ico" copy /Y "%~dp0web-override\favicon.ico" "%WEBDIR%\favicon.ico" >nul
if exist "%~dp0web-override\favicon-32.png" copy /Y "%~dp0web-override\favicon-32.png" "%WEBDIR%\favicon-32.png" >nul
if exist "%~dp0assets" (
  if not exist "%WEBDIR%\assets" mkdir "%WEBDIR%\assets" >nul 2>&1
  xcopy /Y /Q /E "%~dp0assets\*" "%WEBDIR%\assets\" >nul
)
copy /Y "%HTML%" "%WEBDIR%\director.html" >nul
rem Seed layouts.json once (do not overwrite user-saved presets in share\web)
if not exist "%WEBDIR%\layouts.json" if exist "%~dp0layouts.json" (
  copy /Y "%~dp0layouts.json" "%WEBDIR%\layouts.json" >nul
)
echo Published web UI to: %WEBDIR%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Director.ps1" -JavaExe "%JAVA_EXE%" -Jar "%JAR%" -WebDir "%WEBDIR%" -ExtraArgs "%*"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo Start finished with error code %RC%.
  pause
  exit /b %RC%
)
echo All stopped. You can close this window.
timeout /t 3 >nul
exit /b 0
