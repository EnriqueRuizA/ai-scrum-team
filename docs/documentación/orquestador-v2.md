---
tags: [clase, orquestacion]
src: orchestrator/index.js
---

# orquestador-v2

- **Ruta**: `orchestrator/index.js`
- **Clase**: `ScrumMasterOrchestrator` (única; sustituye al `orchestrator.js` truncado de raíz, hoy shim)

## Miembros

- `constructor(config, credentials)` — `sessionId` (uuid), `outputDir`, `team` (vía [[team-config]]), `StateStore`, `runControl`
- `initialize()` → `Promise<void>` — valida Scrum Master habilitado, crea agentes vía `agents/factory.js`, init secuencial (compartido primero si backend Claude)
- `initAgent(key, agent)` — init con `try/catch`, emite `agent_initializing` / `agent_ready`
- `runFullProject()` → delega en [[pipeline]]; escribe puntero `.last-dashboard-session.json`
- `getState()` → copia profunda (el servidor añade `_activeRun`)
- `saveState()` → `StateStore.saveNow()` (nunca lanza; ver [[state]])
- `cleanup()` — `close()` por agente con `try/catch`, vacía mapas
- `setPaused()`, `requestStopAfterCurrentStep()`, `waitWhilePaused()`, `checkGracefulStopAfterStep()` — control de ejecución

## Relaciones

### Depende de

- [[pipeline]] — `runPipeline(ctx)`
- [[state]] — `StateStore`
- [[team-config]] — `normalizeTeam`, `getEnabledRoles`, `createAgents`
- [[personas]] — indirecto (vía factory)

### Usado por

- `server.js` — `runProject()` (eventos → WebSocket)

## Dónde mirar / cambiar

- Orden/contenido de un sprint → [[pipeline]]
- Persistencia/rotación de logs → [[state]]
- Qué agentes se crean → `agents/factory.js` (FASE 2: rama opencode)
