@echo off
title Subathon Timer
cd /d "%~dp0"
:loop
node server.js --open
echo.
echo Server stopped. Restarting in 3s... (close this window to quit)
timeout /t 3 /nobreak >nul
goto loop
