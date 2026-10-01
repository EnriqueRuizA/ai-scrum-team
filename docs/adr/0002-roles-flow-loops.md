# ADR 0002 — Roles libres + flow con loops (sin roles fijos)

Fecha: 2026-10-01. Estado: aceptado.

## Contexto

El pipeline original tenía 4 roles fijos en orden fijo (plan→PO→dev→QA→review).
El usuario pidió roles personalizables con skills, orden libre y loops
(p.ej. QA→fix hasta pasar).

## Decisión

- `agents.roles[]` (id/label/misión/modelo/variant/skills/enabled) +
  `agents.flow[]` (rol + tarea + loop? + onError?). Sin ids reservados.
- Tareas cerradas (`orchestrator/tasks/*`): plan|refinar|implementar|probar|
  revisar|libre. Cada una construye su prompt y parsea su resultado; `libre`
  no parsea.
- Pipeline = ejecutor genérico (`orchestrator/pipeline.js`): loops con
  `until` (qa.passed|noCriticalBugs|filesWritten|always) + `max` (tope duro 10)
  + `fix?` opcional; cada intento extra queda en `iterations[]`.
- Compatibilidad: se mantienen los artefactos legacy
  (prd/architecture/implementations/qaReports/sprints) mapeados por tarea.
- Skills: solo nombres en el rol; opencode las resuelve
  (`.opencode/skills/*/SKILL.md`); `setup.js` avisa, no bloquea.
- Variant (p.ej. `xhigh`): global (`agents.opencode.variant`) + por rol;
  `run` → flag `--variant`, `serve` → campo del mensaje.

## Consecuencias

- `agents.team` se ignora (queda en el fichero, no se borra). Sin automigración.
- Validador estricto: misión ≥10 en personalizados, modelos contra registro,
  loops con max 1–10, roles del flow existentes.
- Ver `docs/documentación/agentes-flow.md` y nota `dashboard.md` (Conversación).

## Alternativas descartadas

- Tarea = texto libre sin tipos: el pipeline no podría extraer ficheros ni
  evaluar loops; se mantiene `libre` como escape explícito.
- Loops sin tope: riesgo de gasto infinito; `max` obligatorio + `LOOP_MAX_HARD`.
