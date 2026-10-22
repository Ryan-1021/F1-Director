@echo off
cd /d "%~dp0"
title F1 Director (bare board)

set "JAVA_EXE=%~dp0jre\bin\java.exe"
if not exist "%JAVA_EXE%" (
  echo jre\bin\java.exe not found. Keep the jre folder next to this script.
  pause
  exit /b 1
)

echo Starting F1 Director bare board UI (upstream jar, no director shell)...
echo Keep this window open. Close it or Ctrl+C to quit.
echo For the full director shell, use ..\director\Start.cmd instead.
echo.
"%JAVA_EXE%" -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -jar "%~dp0F1-RaceControl-Desktop-0.1.15_modify.jar" --open %*
echo.
echo Exited.
pause
