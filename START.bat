@echo off
setlocal

p:
cd /d "P:\REPOSITORIO GIT\ai-scrum-team"

REM Evitar que el script "parezca que no funciona" por EADDRINUSE.
REM Si ya hay un server escuchando en 3000, no arrancamos otro.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { Write-Host '[OK] Ya hay un servidor en http://localhost:3000 (puerto 3000 en uso).'; exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo.
  echo IMPORTANTE: Usa el dashboard en el NAVEGADOR, no abras index.html con doble clic.
  for /f "usebackq delims=" %%p in (`node -e "try{const c=require('./config/project-config.json');process.stdout.write(String((c.outputs&&c.outputs.port)||3000));}catch(e){process.stdout.write('3000');}"`) do set "DASH_PORT=%%p"
  echo Abre: http://localhost:%DASH_PORT%/
  start "" "http://localhost:%DASH_PORT%/"
  endlocal
  exit /b 0
)

npm start