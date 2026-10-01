---
tags: [modulo, frontend, agentes]
src: index.html (tab-agents) + orchestrator/
---

# agentes-flow

Pestaña **Agentes** (U2) + modelo `agents.roles[]`/`agents.flow[]` (U1).

## UI (tab-agents)

- Cards por rol: id (fijo si clásico), nombre, misión, modelo, skills (comas),
  toggle activo, ↑↓, ✕, "+ Nuevo rol" (id `rol-N`).
- Flow: filas rol + tarea + loop (`until`, `max` 1–10, fix rol/tarea) + `onError`,
  ↑↓, ✕, "+ Añadir paso". Tira viva = el flow tal cual se ejecutará.
- Un solo Guardar → `POST /api/config {agents:{roles, flow}}` (validado, 400
  con campo). `renderAgentCards(roles)` repinta las cards del Proyecto y el
  filtro de logs. `renderFlowRoleOptions()` sincroniza los selects de rol.

## Backend

- Tipos: `orchestrator/tasks/*` (plan|refinar|implementar|probar|revisar|libre).
- Ejecutor: `runPipeline` (ver [[orquestador-v2]] y `orchestrator/pipeline.js`):
  orden libre, loops `fix`+reintento (`iterations[]`), `onError`, artefactos
  genéricos + mapeo legacy.
- Condiciones: `qa.passed|noCriticalBugs|filesWritten|always` (`loopConditionMet`).
- Skills: nombres en el rol → frontmatter del `.md` (`export-agents.js`);
  `GET /api/skills` lista descubiertas; `setup.js` avisa si faltan.
- Validador: mission ≥10 en personalizados, skill `^[a-z0-9-]+$`, loop max 1–10,
  roles del flow existentes.

## Relaciones

- [[dashboard]] (cards + filtro), [[team-config]] (normalizadores),
  [[personas]] (system prompts), [[motor-opencode]] (skills en opencode).

## Dónde mirar / cambiar

- Nueva condición de loop → `loopConditionMet` + `LOOP_CONDITIONS` + validador + UI.
- Nuevo tipo de tarea → `orchestrator/tasks/<id>.js` + `TASK_IDS` + UI.
