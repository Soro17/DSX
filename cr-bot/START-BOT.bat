@echo off
title CR Practice Bot
cd /d "%~dp0"

if not exist "%~dp0bot.py" (
  echo Run START-BOT from inside the extracted cr-bot folder, not from inside the ZIP.
  pause
  exit /b 1
)

set PY=python
where py >nul 2>nul && set PY=py
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Get it from https://www.python.org/downloads/
  echo IMPORTANT: tick "Add python.exe to PATH" in the installer, then run START-BOT again.
  pause
  exit /b 1
)

if not exist ".installed" (
  echo Installing bot requirements - first time only...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Install failed. Take a screenshot of this window and send it to Claude.
    pause
    exit /b 1
  )
  echo ok> .installed
)

:menu
echo.
echo ==============================================
echo   CR Practice Bot   (Training Camp only!)
echo   Open BlueStacks + a Training Camp match first
echo ==============================================
echo   1. Calibrate  (check the bot sees your screen)
echo   2. Learn my cards
echo   3. Dry run    (watch decisions, no taps)
echo   4. PLAY
echo   5. Quit
echo.
set /p choice=Pick 1-5: 
if "%choice%"=="1" ( %PY% calibrate.py & start "" calibration.png & goto menu )
if "%choice%"=="2" ( %PY% bot.py --learn & goto menu )
if "%choice%"=="3" ( %PY% bot.py --dry-run & goto menu )
if "%choice%"=="4" ( %PY% bot.py & goto menu )
if "%choice%"=="5" exit /b 0
goto menu
