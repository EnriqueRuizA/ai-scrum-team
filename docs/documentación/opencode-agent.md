---
tags: [clase, agentes]
src: agents/opencode-agent.js
---

# opencode-agent

- **Ruta**: `agents/opencode-agent.js`
- **Clase**: `OpencodeAgent` — un agente por rol sobre el [[motor-opencode]]

## Interfaz (la misma que `agents/factory.js` exige a todos)

- `initialize()` — `health()` del adapter; lanza con hint si no hay motor
- `sendMessage(message, isFirst?)` — antepone la persona solo la primera vez; `title=role`; `dir` = `outputDir` de la sesión
- `parseJSONResponse(text)` — vía `lib/parse-llm-json` (tolerante)
- `close()`, `startNewConversation()`, eventos `log/response/sending/ready`

## Relaciones

### Depende de

- [[opencode-adapter]] — `generate()`
- [[personas]] — `persona` inyectada por la factory

### Usado por

- `agents/factory.js:createOpencodeAgents` (rama `agents.opencode`)
- [[pipeline]] — vía `agents.{scrumMaster,productOwner,developer,qaTester}`

## Dónde mirar / cambiar

- Persona de un rol → [[personas]] (no aquí)
- Modelo por rol → `agents.team[].model` (endpoint `PATCH /api/config/agents/:id/model`)
