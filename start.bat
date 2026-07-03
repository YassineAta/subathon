@echo off
title Subathon Timer
cd /d "%~dp0"

rem ---- find Node.js 22+, install it if missing ----
set "NODE_EXE=node"
set "NODEMAJOR=0"
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODEMAJOR=%%v"
set "NODEMAJOR=%NODEMAJOR:v=%"
if %NODEMAJOR% GEQ 22 goto run

echo Node.js 22+ not found on this PC - installing it now.
echo Accept the admin prompt if one appears...
echo.
where winget >nul 2>nul
if errorlevel 1 goto msi
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
goto locate

:msi
echo winget not available - downloading Node.js installer directly...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://nodejs.org/dist/v22.18.0/node-v22.18.0-x64.msi' -OutFile \"$env:TEMP\node-lts.msi\"; Start-Process msiexec -ArgumentList '/i',\"$env:TEMP\node-lts.msi\",'/qn' -Verb RunAs -Wait"

:locate
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  goto run
)
echo.
echo Install finished but node.exe was not found.
echo Close this window and double-click start.bat again.
pause
exit /b 1

:run
echo Using Node: %NODE_EXE%
:loop
"%NODE_EXE%" server.js --open
echo.
echo Server stopped. Restarting in 3s... close this window to quit.
timeout /t 3 /nobreak >nul
goto loop
