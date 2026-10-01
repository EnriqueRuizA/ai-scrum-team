---
tags: [modulo, agentes, prompts]
src: agents/personas.js
---

# personas

- **Ruta**: `agents/personas.js` — fuente ÚNICA de system prompts (re-exporta `prompts/index.js`)
- `personaFor(role, config)`, `ROLES`, `SCRUM_MASTER/PRODUCT_OWNER/DEVELOPER/QA_TESTER/PROJECT_CONTEXT`

## Relaciones

### Usado por

- `agents/factory.js` — inyecta `persona` en cada agente
- `scripts/export-agents.js` — genera `.opencode/agent/*.md` (tu `.opencode/` local, no commiteado) y `opencode.example/` (versionado)

## Dónde mirar / cambiar

- Tono/instrucciones de un rol → `prompts/index.js` (FASE 5 lo mueve aquí del todo)
- Tras cambiar una persona → `npm run export-agents` para regenerar los `.md`
