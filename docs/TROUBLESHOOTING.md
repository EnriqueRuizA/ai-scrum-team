# Troubleshooting — AI Scrum Team

## Arranque

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| `START.bat` se cierra tras el preflight | Bug antiguo de paréntesis en `echo` (ya corregido); si ves `No se esperaba .`, actualiza el `.bat` | Usar el `START.bat` actual |
| Puerto 3000 en uso | Otro `node server.js` (a veces huérfano de pruebas) | `STOP.bat`; si persiste, mata procesos `node` |
| `PORT` inválido | `outputs.port` no entero | El servidor lo valida y sale con error claro |
| Dashboard en blanco / DISCONNECTED | Abriste `index.html` con doble clic | Usa `http://127.0.0.1:3000` |

## Motor

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| Pill «Motor NO disponible (run)» | opencode no instalado | https://opencode.ai ; `opencode --version` debe responder |
| Pill «Motor NO disponible (serve)» | `opencode serve` caído | `opencode serve --port 4096` (START.bat lo levanta solo en modo serve) |
| `spawn opencode ENOENT` en Windows | Shim `.cmd` de npm no ejecutable directo | El adapter resuelve al `.exe` solo; si falla, fija `agents.opencode.command` o `OPENCODE_BIN` |
| Llamada cuelga hasta timeout | El modelo esperaba input interactivo | `stdin:'ignore'` ya lo evita (falla rápido); revisa permisos `--auto` |
| Modelo Ollama ausente | No está instalado | `ollama pull <modelo>` o elige uno de «Cargar de Ollama» |
| Modelo cloud pide login | Falta auth | `opencode auth login`; Ollama Cloud además `ollama pull <modelo>-cloud` |
| `variant` rechazada | El modelo no tiene esa variante | Elige de la lista sugerida (catálogo `verbose=1`); vacío = defecto |
| Sprint completo tarda >15 min | Modo `run` = cold-boot por paso + loops | Normal; usa `serve` para runs largos |

## Ejecución

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| `POST /api/start` 400 motor | Ver pill/hint | Arranca el motor o cambia a `run` |
| `POST /api/config` 400 | Campo inválido | El error nombra el campo (`agents.flow[2].loop.max`…) |
| `POST /api/start` 409 | Ya hay un run en vuelo | Espera o páralo; un solo run por proceso |
| Skills desconocidas al guardar | Typo o skill no creada | Aviso no bloqueante; crea `.opencode/skills/<n>/SKILL.md` |
| Logs gigantes | Runs largos | Topes: 5000 servidor, 2000 cliente, 500 DOM; `?logs=`/`since=` |
| `state.json` corrupto tras kill | Corte a mitad de escritura | Existe `state.json` atómico (tmp+rename); restaura desde Sesiones en disco |

## Tests/CI

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| `npm test` falla en CI | Sin opencode/ollama | Los tests mockean el motor; si falla, es bug real, no entorno |
| `npm run lint` con errores | Código nuevo sin revisar | `npx eslint <fichero>`; `src/` ya no existe |

## Proveedor Ollama (UnknownError en 2-3s)

Sintoma: `opencode run fallo (code 1): ... "name":"UnknownError","data":{"message":"Unexpected server error..."}` casi al instante, sin que Ollama reciba nada (su `server.log` no muestra la peticion).

Causa: el hijo `opencode run` no tiene proveedor Ollama explicito (ni `OPENCODE_CONFIG_CONTENT` en el entorno ni bloque `provider` en el `opencode.json` efectivo) y muere antes de llamar al proveedor.

Fix: el adapter inyecta `opencode.example/opencode.json` (versionado, sin secretos) al hijo via `OPENCODE_CONFIG_CONTENT`. No requiere accion. Si usas modo `serve`, reinicia `opencode serve` tras actualizar la config, porque el servidor persistente no hereda la inyeccion por llamada.
