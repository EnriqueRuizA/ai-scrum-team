@echo off
setlocal

p:
cd /d "P:\REPOSITORIO GIT\ai-scrum-team"

echo Cambiando al directorio: %CD%

REM Intenta obtener el puerto del dashboard desde config/project-config.json usando PowerShell
for /f "tokens=*" %%a in ('powershell -Command "(Get-Content config/project-config.json | ConvertFrom-Json).outputs.port"') do (
  set "DASH_PORT=%%a"
  goto :portFound
)

REM Si no se puede obtener el puerto del archivo de configuración, usa el puerto predeterminado 3000
set "DASH_PORT=3000"

:portFound
echo Puerto del dashboard: %DASH_PORT%

REM Evitar que el script "parezca que no funciona" por EADDRINUSE.
REM Si ya hay un servidor escuchando en 3000, no arrancamos otro.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { Write-Host '[OK] Ya hay un servidor en http://localhost:3000 (puerto 3000 en uso).'; exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo.
  echo IMPORTANTE: Usa el dashboard en el NAVEGADOR, no abras index.html con doble clic.
  echo Abre: http://localhost:%DASH_PORT%/
  start "" "http://localhost:%DASH_PORT%/"
  endlocal
  exit /b 0
)

echo El puerto 3000 está en uso.  No se puede iniciar el servidor.
endlocal
exit /b 1
