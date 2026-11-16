@echo off
title DSX
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing DSX - first time only, please wait about a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed. Take a screenshot of this window and send it to Claude.
    pause
    exit /b 1
  )
)

echo.
echo Starting DSX... your browser will open in a few seconds.
echo Keep this window open while you use DSX. Close it to stop DSX.
echo.
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3000"
call npm start
pause
