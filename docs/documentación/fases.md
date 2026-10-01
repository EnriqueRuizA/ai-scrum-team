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
- **UX intermedio** (en curso) — `GET /api/engine/health`, pill de motor + preflight, sección opencode en Settings, validación en `POST /api/config`, banner sin credenciales.

## Pendientes

- **FASE 6** — tope `allLogs` en cliente ✓, paginación `/api/state` ✓, `dashboard-local` borrado en FASE 5 ✓.
- **FASE 7** — reescribir `README.md`/`GUIA-USO.md`, `TROUBLESHOOTING.md`, `docs/adr/0001-opencode-motor.md`, `CHANGELOG.md`, bump `0.2.0`.

## Deuda conocida (no olvidar)

- Remoto `origin` con secretos en historial (`a096207`, `84e9756`): **rotar claves**. Sin reescritura salvo que se haga público.
- `outputs.port` + `autoOpenDashboard` siguen en config; el bind ya es local por defecto.
