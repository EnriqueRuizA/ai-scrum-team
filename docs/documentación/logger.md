---
tags: [clase, util, legacy]
src: src/utils/logger.js (ELIMINADO en FASE 5, ver [[legacy-src]])
---

# logger

- **Ruta**: `src/utils/logger.js`
- **Tipo**: módulo singleton (objeto exportado, sin clase)

## Métodos

- `info(...msg)` → `void` — log nivel INFO en consola y `logs/app.log`
- `debug(...msg)` → `void` — log nivel DEBUG en consola y `logs/app.log`
- `warn(...msg)` → `void` — log nivel WARN en consola y `logs/app.log`
- `error(...msg)` → `void` — log nivel ERROR en consola y `logs/app.log`

## Relaciones

### Depende de (externo, sin nota)

- `fs-extra`, `path` — paquetes npm / Node, no son notas del grafo

### Usado por

- [[orchestrator|ScrumMasterOrchestrator]]
- [[local_agent|LocalAgent]]
- [[ollama|OllamaClient]]
- [[validator|Validator]]
- [[editor|FileEditor]]

> Nodo hoja: todo el proyecto lo usa, él no usa a nadie del grafo.
