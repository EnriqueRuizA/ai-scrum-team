@echo off
setlocal

cd /d "%~dp0"

echo Cambiando al directorio: %CD%

REM Intenta obtener el puerto del dashboard desde config/project-config.json usando PowerShell
for /f "tokens=*" %%a in ('powershell -NoProfile -Command "try { (Get-Content config/project-config.json -Raw | ConvertFrom-Json).outputs.port } catch { exit 1 }"') do (
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

REM Si el puerto no está en uso, preflight + iniciar el servidor
REM (OPENCODE_SKIP_SETUP=1 salta la pausa de abajo, no el preflight)
echo Comprobando motor (opencode/ollama)...
node setup.js
if "%OPENCODE_SKIP_SETUP%"=="1" goto :skipSetupPause
if %errorlevel%==0 goto :skipSetupPause
echo.
echo [AVISO] El preflight devolvio aviso o error. Puedes continuar igualmente
echo o pulsa Ctrl+C para revisar: ollama serve u opencode serve.
pause
:skipSetupPause
REM Si el modo es serve y opencode serve no escucha, levantarlo en otra ventana
for /f "tokens=1,2 delims=|" %%a in ('powershell -NoProfile -Command "try { $c=Get-Content config/project-config.json -Raw | ConvertFrom-Json; $m=$c.agents.opencode.mode; if(-not $m){$m='run'}; $u=$c.agents.opencode.url; if(-not $u){$u='http://127.0.0.1:4096'}; $p=([uri]$u).Port; Write-Host ($m.ToLower()+'|'+$p) } catch { Write-Host 'run|4096' }"') do (
  set "OC_MODE=%%a"
  set "OC_PORT=%%b"
)
if /i "%OC_MODE%"=="serve" (
  powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %OC_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
  if %errorlevel%==0 (
    echo [OK] opencode serve ya escucha en el puerto %OC_PORT%.
  ) else (
    echo Levantando opencode serve en el puerto %OC_PORT% - nueva ventana...
    start "opencode serve" opencode serve --port %OC_PORT%
    timeout /t 4 /nobreak >nul
  )
)
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