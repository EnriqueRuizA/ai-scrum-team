---
tags: [clase, orquestacion, legacy]
src: src/orchestrator/orchestrator.js (ELIMINADO en FASE 5, ver [[legacy-src]] y [[orquestador-v2]])
---

# orchestrator

- **Ruta**: `src/orchestrator/orchestrator.js`
- **Clase**: `ScrumMasterOrchestrator`

## Miembros

- `constructor(config, credentials)` — `sessionId` (uuid), `outputDir`, `state`, `agentOrder`
- `init()` → `Promise<void>` — instancia un agente por rol del orden resuelto
- `getState()` → `object` — devuelve `state`
- `runSprint()` → `Promise<void>` — ejecuta `runTask()` de cada agente en paralelo
- `resolveAgentOrder(config)` → `string[]` *(función, privada)* — lee `config/agents-config.json`, fallback a `config.agents.team`
- `resolveAgentModel(config, role)` → `string` *(función, privada)* — `agent.model` → `defaultModel` → `gpt-4o-mini`

## Relaciones

### Depende de

- [[local_agent|LocalAgent]] — `new LocalAgent({...})` por cada rol en `init()`
- [[logger]] — trazas `info` / `error`
- `prompts/index.js` — `prompts[role](config)` para la persona (pendiente de nota propia)
- `uuid`, `fs-extra` (externos, sin nota)

### Usado por

- Nadie en `src/` — es la raíz de ejecución (lo llama `server.js` / entrypoint, pendiente de nota)

## Dónde mirar / cambiar

- Orden de agentes o modelo por agente → `resolveAgentOrder` / `resolveAgentModel` aquí.
- Lógica de un rol concreto → [[local_agent|LocalAgent]].
