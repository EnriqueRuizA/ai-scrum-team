---
tags: [modulo, agentes, config]
src: agents/team-config.js
---

# team-config

- **Ruta**: `agents/team-config.js` — fuente ÚNICA del equipo (re-exporta `lib/default-team.js`, sin duplicar)
- Roles válidos: `productOwner`, `developer`, `qaTester`, `scrumMaster`

## Funciones

- `normalizeTeam(config)` — filtra roles desconocidos, defaultea equipo completo si queda vacío
- `getEnabledRoles(team)` → `Set` — lo que [[pipeline]] y la factory consultan
- `isRoleEnabled(team, role)`, `defaultTeam()`, `DEFAULT_LABELS`
- `agents/factory.js:createAgents()` — rama `agents.opencode` → `createOpencodeAgents` (ver [[opencode-agent]]); si no, legacy local/Claude (hasta [[fases|FASE 5]])

## Relaciones

### Usado por

- [[orquestador-v2]] — `initialize()`
- `server.js` — `PATCH /api/config/order` (reordena `agents.team`), `PATCH /api/config/agents/:id/model`
- `utils/config-validator.js` — valida contra los mismos roles

## Dónde mirar / cambiar

- Añadir un rol → `VALID_ROLES` + factory + [[personas]] + endpoint de modelo
- Orden del equipo → `agents.team` en `config/project-config.json` (única fuente; `agents-config.json` eliminado en FASE 2)
