---
tags: [clase, motor]
src: llm/opencode-adapter.js
---

# opencode-adapter

- **Ruta**: `llm/opencode-adapter.js` (+ `llm/factory.js` → `createAdapter(config)`)
- **Clase**: `OpencodeAdapter` — único adapter de IA (FASE 2; ver [[motor-opencode]])

## Miembros

- `constructor(cfg)` — `{mode, url, model, dir, timeoutMs, auto, command, env}`; `command` solo si override (`node` en tests)
- `resolveBinary()` — resuelve y cachea el `.exe` real (Windows); verifica con `--version`
- `health()` — `run`: `--version`; `serve`: `GET /global/health`. Devuelve `{ok, mode, version?, error?, hint?}` (hint accionable, nunca stack al usuario)
- `generate({prompt, files?, dir?, title?, model?, signal?, timeoutMs?})` — `run`: `spawnSafe` + `collectRunText`; `serve`: crea sesión + `POST message` + abort best-effort si cancelan
- `collectRunText(stdout)` / `collectMessageText(body)` — parseo tolerante (verificado contra eventos reales: extrae una sola vez)

## Relaciones

### Depende de

- `utils/exec-safe.js` — `spawnSafe` (`shell:false`, timeout, `AbortSignal`, `stdin:'ignore'`)
- [[guards]] — indiretamente (el `dir` por llamada contiene al modelo)

### Usado por

- [[opencode-agent]] — `sendMessage()` → `generate()`
- `setup.js`, `scripts/smoke-opencode.js`, rama `agents.opencode` de `POST /api/start`

## Dónde mirar / cambiar

- Nuevo modo (p.ej. `acp`) → `generate()` + `health()` aquí; la interfaz no cambia
- Timeout global → `agents.opencode.timeoutMs` (defecto 10 min)
