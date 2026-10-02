# CHANGELOG — ai-scrum-team

Formato Keep a Changelog (resumen por fase/entrega).

## [Unreleased]

### Añadido

- Sesiones como proyectos activos: `GET /api/sessions` incluye el proyecto
  en ejecución marcado `_activeRun` (etiqueta EN VIVO) y
  `POST /api/sessions/:id/resume` reanuda una sesión guardada desde el
  siguiente sprint (conserva logs/artefactos/sprints; usa
  `config.snapshot.json` de la sesión o la config actual; botón
  **Continuar** en la tarjeta Proyectos del dashboard; `startFrom` en el
  pipeline + `ScrumMasterOrchestrator.resume()`).
- Diagnóstico de `opencode run`: el error incluye cola de stdout + stderr +
  modelo (antes solo stderr, a menudo vacío e indiagnosticable), `--dir`
  absoluto y `resolveBinary` en Windows que descarta shims no ejecutables
  (`.cmd`/`.ps1`/script sh) y prefiere el `.exe` real.
- Proveedor Ollama explícito: `opencode.example/opencode.json` (versionado,
  sin secretos) inyectado al hijo `opencode run` vía `OPENCODE_CONFIG_CONTENT`.
  Sin esto, `run` muere en 2-3s con `UnknownError: Unexpected server error`
  antes de llamar a Ollama. Excepción en `.gitignore` para el template.
- Una sesión opencode por agente y ejecución (reutilizada con `--session` en
  `run` y `sessionID` en `serve`; título único `rol [session-…]`): antes se
  creaba una por llamada y se acumulaban decenas de duplicadas. `toContainedRelPath`:
  rutas absolutas dentro del proyecto se relativizan en vez de abortar.
- Gestor de proyectos en el dashboard: tabla con nombre, estado, sprints y
  fecha, con acciones Ver (solo vista), Continuar (reanuda) y Borrar (con
  confirmación; bloqueado en el proyecto en vivo). `GET /api/sessions`
  incluye `summary` por sesión (+ `projectName` guardado en el estado) y
  nuevo `DELETE /api/sessions/:id` con limpieza del puntero.

### Corregido

- `POST /api/start` y `POST /api/sessions/:id/resume` liberan el `RunLock`
  en cada 400/409 previo al arranque (antes, un preflight fallido dejaba el
  servidor en 409 permanente hasta reiniciar).

## [1.1.0] — 2026-10-01 — Reestructuración completa + UX por roles

Reescritura sobre el motor opencode (modelos gratuitos). Lo viejo roto
(orquestador truncado, doble arquitectura, secretos en git) queda corregido.

### Añadido

- Orquestador único (`orchestrator/`: índice, pipeline genérico, estado
  atómico) + `server/` por rutas (63 líneas el entry).
- Motor opencode (`llm/`): modos `run`/`serve`, `variant` (xhigh…), catálogo
  con modificadores por modelo, `GET /api/engine/*`, `GET /api/skills`.
- Roles libres + skills + flow con loops + tareas tipadas; validador con
  errores por campo; `agents.models[]` con import de Ollama/nube.
- UI de 3 pestañas (Proyecto/Agentes/Ajustes) con tooltips, pill y preflight
  del motor, vista Conversación (prompt+respuesta en vivo), `GET /api/steps`.
- Seguridad: guards anti-traversal/pollution, helmet+rate-limit+bind local,
  spawn sin shell, XSS saneado (`docs/SECURITY.md`, ADRs).
- Tests: 140 Jest en verde, lint limpio, CI (Node 20/22), `check:secrets`,
  `smoke`, `export-agents`, `setup.js` como health-check.
- Docs: README/GUIA/TROUBLESHOOTING nuevos, Obsidian (`MOC-arquitectura`).

### Cambiado

- `agents.team` → `agents.roles[]`+`agents.flow[]` (team se ignora, no se borra).
- `POST /api/config` valida (400 con campo); `GET /api/state?logs=&since=`.
- `START.bat` con preflight y auto-serve; `STOP.bat` sin rutas fijas.

### Eliminado

- `src/` entero, agentes Playwright/RAG a medida, `agents-config.json`,
  `dashboard-local.html`, mapas temporales, endpoint Flow/diagram,
  endpoints huérfanos (`config/models`, `agents/:id/model`, `artifact/*`,
  `download/*`, `pause` alias), team-table y bloques legacy de Settings.
- `config/credentials.json` fuera de git (+ rotación pendiente si hubo push).
- Deps: `chalk`, `node-cron`, `uuid`; `playwright` a opcionales.

### Notas de migración

- Hacer backup de `config/project-config.json`; la app añade `roles`+`flow`
  clásicos por defecto si faltan. Revisar `agents.opencode.model` (debe
  existir: `ollama list` u `opencode models`).
- Si el repo se publicó con secretos en historial, rotar claves (ver
  `docs/SECURITY.md`).

## [1.0.0] — anterior

Prototipo inicial (orquestador Claude.ai web + backend local experimental).
