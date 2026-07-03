@echo off
title Subathon Timer
cd /d "%~dp0"
echo ==============================
echo   SUBATHON TIMER - preflight
echo ==============================
echo.

rem ---- [1/4] app files (re-download from GitHub if missing) ----
if exist "server.js" if exist "public\overlay.html" if exist "public\control.html" (
  echo [OK]  App files present
  goto node_check
)
echo [FIX] App files missing - downloading latest from GitHub...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://github.com/YassineAta/subathon/archive/refs/heads/main.zip' -OutFile \"$env:TEMP\subathon.zip\"; Expand-Archive \"$env:TEMP\subathon.zip\" \"$env:TEMP\subathon_x\" -Force; Copy-Item \"$env:TEMP\subathon_x\subathon-main\*\" . -Recurse -Force -Exclude 'start.bat'"
if not exist "server.js" (
  echo [XX]  Download failed - check the internet connection and retry.
  pause
  exit /b 1
)
echo [OK]  App files downloaded

:node_check
rem ---- [2/4] Node.js 22+ (install if missing) ----
set "NODE_EXE=node"
set "NODEMAJOR=0"
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODEMAJOR=%%v"
set "NODEMAJOR=%NODEMAJOR:v=%"
if %NODEMAJOR% GEQ 22 (
  echo [OK]  Node.js v%NODEMAJOR% found
  goto port_check
)
echo [FIX] Node.js 22+ not found - installing now. Accept the admin prompt...
where winget >nul 2>nul
if errorlevel 1 goto msi
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
goto locate
:msi
echo       winget not available - downloading installer directly...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://nodejs.org/dist/v22.18.0/node-v22.18.0-x64.msi' -OutFile \"$env:TEMP\node-lts.msi\"; Start-Process msiexec -ArgumentList '/i',\"$env:TEMP\node-lts.msi\",'/qn' -Verb RunAs -Wait"
:locate
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  echo [OK]  Node.js installed
  goto port_check
)
echo [XX]  Install finished but node.exe was not found.
echo       Close this window and double-click start.bat again.
pause
exit /b 1

:port_check
rem ---- [3/4] port 4025 (stop stale/stuck instance) ----
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4025 " ^| findstr "LISTENING"') do (
  echo [FIX] Old timer instance running - stopping it ^(PID %%p^)
  taskkill /f /pid %%p >nul 2>nul
)
echo [OK]  Port 4025 ready

rem ---- [4/4] updates (git installs only) ----
if exist ".git" (
  git pull --ff-only >nul 2>nul && echo [OK]  Code up to date
)

echo.
echo Starting server...
:loop
"%NODE_EXE%" server.js --open
echo.
echo Server stopped. Restarting in 3s... close this window to quit.
timeout /t 3 /nobreak >nul
goto loop
