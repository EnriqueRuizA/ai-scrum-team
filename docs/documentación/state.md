---
tags: [clase, persistencia]
src: orchestrator/state.js
---

# state

- **Ruta**: `orchestrator/state.js`
- **Clase**: `StateStore` — persistencia con garantías (caza un bug real en FASE 1: `appendFile` sin `ensureDir`)

## Miembros

- `constructor(outputDir, sessionId, maxSprints)` — `state` inicial, `statePath`, `overflowPath`
- `pushLog(entry)` — tope `MAX_LOGS=5000` en RAM; el exceso va a `logs-overflow.jsonl` (append con `ensureDir`)
- `scheduleSave()` — debounce 500 ms (`unref`), nunca lanza
- `saveNow()` — un solo vuelo (`_savePromise`); nunca lanza (registra `saveError`, flag `saved`)
- `_writeAtomic()` — `writeJson(tmp) + move(tmp, state.json)` (sobrevive a SIGKILL a mitad)
- `static load(statePath)` — lectura para restaurar

## Relaciones

### Usado por

- [[orquestador-v2]] — `log()` (push + schedule), `saveState()`, cierre

## Dónde mirar / cambiar

- Tamaño de estado / rotación → `MAX_LOGS`, `SAVE_DEBOUNCE_MS` aquí
- Restaurar tras F5/reinicio → `server.js:loadDashboardStateFromDisk` (lee `state.json` + puntero)
