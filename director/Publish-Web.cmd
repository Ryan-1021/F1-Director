@echo off
cd /d "%~dp0"
set "SHARE=%~dp0..\share"
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
if exist "%~dp0director.html" copy /Y "%~dp0director.html" "%WEBDIR%\director.html" >nul
echo Published to %WEBDIR%
echo Soft-refresh (F5) should pick it up; hard refresh if a tab still looks stale.