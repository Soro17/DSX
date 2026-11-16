@echo off
title DSX
cd /d "%~dp0"

if not exist "%~dp0package.json" (
  echo.
  echo START-DSX must be run from inside the extracted DSX folder,
  echo next to the "server" and "public" folders - not from inside the ZIP
  echo and not from a copy on the Desktop.
  echo.
  echo Fix: right-click the DSX ZIP file, choose "Extract All", open the
  echo extracted folder, and double-click START-DSX there.
  echo.
  pause
  exit /b 1
)

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
