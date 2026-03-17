@echo off
setlocal

p:
cd /d "P:\REPOSITORIO GIT\ai-scrum-team"

REM Evitar que el script "parezca que no funciona" por EADDRINUSE.
REM Si ya hay un server escuchando en 3000, no arrancamos otro.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { Write-Host '[OK] Ya hay un servidor en http://localhost:3000 (puerto 3000 en uso).'; exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  endlocal
  exit /b 0
)

npm start