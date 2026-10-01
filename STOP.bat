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

REM Uso: STOP.bat --with-engine  => tambien para opencode serve (puerto de agents.opencode.url).
REM Por defecto NO se toca el motor (puede ser tu TUI u otro proyecto).
if /i not "%1"=="--with-engine" goto :engineInfo
for /f "tokens=* delims=" %%q in ('powershell -NoProfile -Command "try { $u=(Get-Content config/project-config.json -Raw | ConvertFrom-Json).agents.opencode.url; if(-not $u){$u='http://127.0.0.1:4096'}; Write-Host (([uri]$u).Port) } catch { Write-Host '4096' }"') do set OC_PORT=%%q
powershell -NoProfile -Command "$p=(Get-NetTCPConnection -LocalPort %OC_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess; if($p){ Write-Host ('[INFO] Parando opencode serve en puerto %OC_PORT% (PID ' + $p + ')...'); Stop-Process -Id $p -Force; Write-Host '[OK] Motor parado.' } else { Write-Host '[OK] No hay motor escuchando en el puerto %OC_PORT%.' }"
goto :end
:engineInfo
powershell -NoProfile -Command "$u='http://127.0.0.1:4096'; try { $j=(Get-Content config/project-config.json -Raw | ConvertFrom-Json).agents.opencode.url; if($j){$u=$j} } catch {}; $p=([uri]$u).Port; if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { Write-Host ('[INFO] opencode serve sigue en puerto ' + $p + ' (se deja en marcha; usa STOP.bat --with-engine para pararlo).') }"
:end

endlocal
