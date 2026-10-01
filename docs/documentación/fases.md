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
- **FASE 4** (en curso) — `npm test` (105/105), `npm run lint` limpio, humo borrado, `lib/llm-provider-presets.js` fijado contra sus tests, CI. Esta documentación.

## Pendientes

- **FASE 5** — borrar [[legacy-src]], partir `server.js` (<300 líneas), barrels, quitar deps muertas (`node-cron`, `chalk`, `uuid`→`crypto`, `playwright`→opcional), endurecer lint.
- **FASE 6** — tope `allLogs` en cliente, paginación `/api/state`, decidir `public/dashboard-local.html` (hoy roto).
- **FASE 7** — reescribir `README.md`/`GUIA-USO.md`, `TROUBLESHOOTING.md`, `docs/adr/0001-opencode-motor.md`, `CHANGELOG.md`, bump `0.2.0`.

## Deuda conocida (no olvidar)

- Remoto `origin` con secretos en historial (`a096207`, `84e9756`): **rotar claves**. Sin reescritura salvo que se haga público.
- `outputs.port` + `autoOpenDashboard` siguen en config; el bind ya es local por defecto.
