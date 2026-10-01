---
tags: [indice, proceso]
---

# fases

Estado del `docs/PLAN-REESTRUCTURACION.txt` (v2). Cada fase = commits `phase-N`.

## Hechas

- **FASE 0** (`420b2c3`) — secretos fuera de git, mapas borrados, `.gitignore`, `check:secrets`, `.nvmrc`, `LICENSE`, `CONTRIBUTING`. Rollback: tag `pre-phase-0`.
- **FASE 1** (`0b5e73f`) — [[orquestador-v2]], [[pipeline]], [[state]], factory, `RunLock`. Tests: pipeline + estado atómico.
- **FASE 2** (`d451de0`) — [[motor-opencode]], [[opencode-adapter]], [[opencode-agent]], [[personas]], config unificada + schema + validador, `setup.js`, `START.bat`/`STOP.bat`, `smoke`, `export-agents`.
- **fix START end-to-end** (`2ac6362`) — modo `run`, modelo instalado, `resolveBinary`, `stdin:'ignore'`, `dir` contenida.
- **FASE 3** (`dfd9abc`) — [[guards]], helmet/rate-limit/bind, deliverable honesto, XSS, `docs/SECURITY.md`.
- **FASE 4** (commit `1662046`) — `npm test` (105/105), `npm run lint` limpio, humo borrado, `lib/llm-provider-presets.js` fijado contra sus tests, CI. Documentación Obsidian (MOC + 8 notas).
- **FASE 5** (commit `0b7ec8e`) — `server.js` 1099→63 líneas, `src/` borrado, barrels, `prompts→personas`, `dashboard-local` borrado, deps limpias. Obsidian revisado.
- **FASE 6** (commit `4071aa9`) — `GET /api/state?logs=&since=` (`limitStateLogs` + meta), tope cliente 2000, `clearLogs` real, `docs/adr/0001-ws-sin-auth-localhost.md`, nota [[dashboard]].
- **UX intermedio** (commit `a76f068`) — pill, preflight, Settings opencode, validación POST config.
- **U0** (commit `246ad6c`) — START.bat llega al servidor (paréntesis en echoes).
- **U1** (commit `cd0e820`) — roles+flow+loops, skills, validador, endpoints.
- **U2** (commit `dcbeb0e`) — UI 3 pestañas, sin legacy, endpoint flow borrado.
- **UX tooltips** (commit `bf48c5b`) — sistema CSS `[data-tip]` (~50), sin duplicados (57 IDs únicos).
- **UX modelos** (commit `ff494f4`) — registro `agents.models`, sin orden en roles, selects por rol/motor, `GET /api/engine/ollama-models`.
- **UX cloud+variant** (commit `e537be4`) — `GET /api/engine/opencode-models` (muse-spark verificado sin login).
- **UX conversaciones** (commit `c25e0c0`) — evento WS `exchange`, `GET /api/steps/:session`, vista Conversación, `variant` global/por rol.
- **UX variantes** (commit `27658a9`) — catálogo con modificadores por modelo, datalists en UI.
- **U3** (en curso) — verificación viva real OK (2 llamadas, 6 artefactos), sin endpoints huérfanos, ADR-0002.
- Nota: un sprint completo en modo `run` tarda >15 min (cold-boot por paso + loops); para verificación viva usar flujos mínimos o `serve`.

## Pendientes

- **FASE 6** — tope `allLogs` en cliente ✓, paginación `/api/state` ✓, `dashboard-local` borrado en FASE 5 ✓.
- **FASE 7** — reescribir `README.md`/`GUIA-USO.md`, `TROUBLESHOOTING.md`, `docs/adr/0001-opencode-motor.md`, `CHANGELOG.md`, bump `0.2.0`.

## Deuda conocida (no olvidar)

- Remoto `origin` con secretos en historial (`a096207`, `84e9756`): **rotar claves**. Sin reescritura salvo que se haga público.
- `outputs.port` + `autoOpenDashboard` siguen en config; el bind ya es local por defecto.
