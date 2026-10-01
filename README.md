# AI Scrum Team Orchestrator

> Orquestador de flujos agénticos con **modelos gratuitos**: define roles con
> misión y skills, ordénalos en un flujo con loops, y ejecútalo con el motor
> **opencode** (Ollama local o modelos free en cloud). Sin APIs de pago.

## Arquitectura

```
┌──────────────────────────────────────────────────────┐
│              DASHBOARD (127.0.0.1:3000)              │
│  Proyecto · Agentes · Ajustes · WS en tiempo real     │
└────────────────────────────┬─────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────┐
│              ORQUESTADOR (orchestrator/)              │
│  Ejecutor genérico: roles × tareas × loops           │
└──────────────┬───────────────────────┬───────────────┘
               │                       │
   ┌───────────▼───────────┐  ┌────────▼────────┐
   │  MOTOR OPENCODE        │  │ outputs/        │
   │  run (simple) / serve  │  │ session-XXX/    │
   │  (modelos gratuitos)   │  │ artefactos+app  │
   └───────────────────────┘  └─────────────────┘
```

- **Roles** (`agents.roles[]`): id, misión, modelo, variante, skills, on/off.
- **Flow** (`agents.flow[]`): pasos `{rol, tarea}` con loops
  (`until`, `max`, `fix`) y `onError`. Tareas: plan, refinar, implementar,
  probar, revisar, libre.
- **Motor**: `agents.opencode` (`mode`, `model`, `variant`, `url`).
- **Modelos** (`agents.models[]`): registro local + cloud, elegible por rol.

## Requisitos

- Node.js >= 20 (`npm ci`)
- [opencode](https://opencode.ai) instalado
- Un modelo: Ollama local (`ollama pull qwen3.5:9b`) o cloud free de opencode
  (botón «Cargar nube opencode» en Ajustes; p.ej. `opencode/muse-spark-…-free`)

## Uso

```bat
START.bat        :: preflight + (serve si toca) + dashboard
STOP.bat         :: para el servidor (añade --with-engine para el motor)
```

1. Comprueba el pill **Motor: OK**.
2. Ajusta **Agentes** (roles, modelos, skills, flow con loops) → Guardar.
3. Pulsa **Iniciar** en Proyecto. Sigue sprints, artefactos y la
   **Conversación** (prompt + respuesta de cada llamada) en vivo.

```bash
npm test            # Jest (sin motor real)
npm run lint        # ESLint limpio
npm run check:secrets
npm run smoke       # verificación manual contra motor real
npm run export-agents  # genera .opencode/agent/*.md desde roles
```

## Configuración

Toda en `config/project-config.json` (validada con errores por campo):

- `project`, `scrum.maxSprints`
- `agents.roles[]`, `agents.flow[]`, `agents.models[]`, `agents.opencode`
- `outputs.port` (bind local `127.0.0.1` por defecto)

Sin credenciales en el proyecto: la auth de proveedores vive en opencode
(`~/.local/share/opencode/auth.json` o `opencode auth login`).

## Proveedores opcionales (no son el camino principal)

Cualquier proveedor configurado en opencode (incluidos Claude/OpenAI de pago)
funciona poniendo su id `proveedor/modelo` en el registro. El proyecto no
guarda ni pide sus claves.

## Documentación

- Uso día a día: [`docs/GUIA-USO.md`](docs/GUIA-USO.md)
- Problemas: [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)
- Seguridad: [`docs/SECURITY.md`](docs/SECURITY.md)
- Decisiones: [`docs/adr/`](docs/adr/)
- Mapa Obsidian: [`docs/documentación/MOC-arquitectura.md`](docs/documentación/MOC-arquitectura.md)
- Cambios: [`CHANGELOG.md`](CHANGELOG.md)
