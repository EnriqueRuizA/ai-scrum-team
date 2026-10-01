@echo off
setlocal

REM Directorio del repo (este .bat), sin rutas hardcodeadas
cd /d "%~dp0"

REM Puerto: env PORT > config/outputs.port > 3000
if not "%PORT%"=="" goto :portOk
for /f "usebackq delims=" %%p in (`node -e "try{const c=require('./config/project-config.json');process.stdout.write(String((c.outputs&&c.outputs.port)||3000));}catch(e){process.stdout.write('3000');}"`) do set PORT=%%p
if "%PORT%"=="" set PORT=3000
:portOk

REM Encontrar PID escuchando en el puerto y pararlo
powershell -NoProfile -Command "$p=(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess; if($p){ Write-Host ('[INFO] Parando servidor en puerto %PORT% (PID ' + $p + ')...'); Stop-Process -Id $p -Force; Write-Host '[OK] Servidor parado.' } else { Write-Host '[OK] No hay servidor escuchando en el puerto %PORT%.' }"

endlocal
