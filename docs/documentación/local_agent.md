---
tags: [clase, agente]
src: src/agent/local.js
---

# local_agent

- **Ruta**: `src/agent/local.js`
- **Clase**: `LocalAgent`

## Miembros

- `constructor({ name, role, persona, model, config })` — crea `llm`, `rag`, `editor`
- `init()` → `Promise<void>` — `rag.build()` si `config.local.rag.enabled`
- `generatePrompt(prompt)` → `Promise<string>` — system + user (+ contexto RAG) → `llm.generate()`
- `handleResponse(response)` → `Promise<void>` — parsea JSON: acciones `write` / `lint` / `test`
- `runTask(taskPrompt)` → `Promise<string>` — `generatePrompt` + `handleResponse`

## Relaciones

### Depende de

- [[ollama|OllamaClient]] — `this.llm`, vía `generate()`
- [[ragi|RAG]] — `this.rag`, vía `build()` / `query()` (⚠️ ver discrepancia en [[ragi]])
- [[editor|FileEditor]] — `this.editor`, vía `write()` en acción `write`
- [[validator|Validator]] — vía `lint()` / `test()` en acciones `lint` / `test`
- [[logger]] — trazas `info` / `error` / `warn`
- `uuid`, `config.local.*` (externos, sin nota)

### Usado por

- [[orchestrator|ScrumMasterOrchestrator]] — lo instancia por rol en `init()` y lo ejecuta en `runSprint()`

## Dónde mirar / cambiar

- Comportamiento de un agente (prompt, acciones write/lint/test) → aquí.
- Conexión LLM → [[ollama|OllamaClient]] · Ficheros → [[editor|FileEditor]] · Validación → [[validator|Validator]].
