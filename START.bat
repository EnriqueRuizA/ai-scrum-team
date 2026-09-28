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

REM Verificar si el puerto está en uso
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %DASH_PORT% -State Listen -ErrorAction SilentlyContinue) { Write-Host '[OK] Ya hay un servidor en http://localhost:%DASH_PORT% (puerto %DASH_PORT% en uso).'; exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo.
  echo IMPORTANTE: Usa el dashboard en el NAVEGADOR, no abras index.html con doble clic.
  echo Abre: http://localhost:%DASH_PORT%/
  start "" "http://localhost:%DASH_PORT%/"
  endlocal
  exit /b 0
)

REM Si el puerto no está en uso, iniciar el servidor
echo Iniciando servidor...
node server.js
if %errorlevel%==0 (
  echo Servidor iniciado correctamente en http://localhost:%DASH_PORT%/
  echo Abre: http://localhost:%DASH_PORT%/
  start "" "http://localhost:%DASH_PORT%/"
) else (
  echo Error al iniciar el servidor.
)

endlocal
exit /b %errorlevel%
```