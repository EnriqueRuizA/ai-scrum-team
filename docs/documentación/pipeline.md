---
tags: [funcion, orquestacion]
src: orchestrator/pipeline.js
---

# pipeline

- **Ruta**: `orchestrator/pipeline.js`
- **Función**: `runPipeline(ctx)` — secuencia estricta con `await` en cadena (nunca `Promise.all` entre roles)

## Secuencia por sprint

1. `ScrumMaster` planifica (`{sprint:{goal,stories}}`; sprint 1 puede traer `prd/architecture/testPlan`)
2. `ProductOwner` refina historias
3. `Developer` implementa → `extractFilesFromImplementation` → escritura contenida en `final-app/` → `node --check` real + `npm test` si existe → `checks` (con `skipped` honesto, nunca `ok` falso)
4. `QATester` reporta (`{qa:{passed,bugs}}`) → si hay `critical`, una ronda de fix
5. `ScrumMaster` review → registro en `state.sprints` → `saveState()` → parada graciosa si se pidió

## Funciones

- `askAgent(agent, prompt, ctx, opts)` — `sendMessage` con timeout de carrera (`withTimeout`)
- `assertSafeRelPath(rel)` / `writeFilesContained(baseDir, files)` — rechaza `..` y absolutas (FASE 3 endurece vía [[guards]])
- `saveArtifact(outputDir, name, data)` — `artifacts/*.json`

## Relaciones

### Depende de

- `lib/deliverable.js` — extract + checks (sin shell en FASE 3)
- `lib/parse-llm-json.js` — parseo tolerante de respuestas
- [[state]] — vía `ctx.saveState()`

### Usado por

- [[orquestador-v2]] — `runFullProject()`

## Dónde mirar / cambiar

- Prompts de cada paso → aquí (strings inline; ver [[personas]] como fuente de system prompts)
- Añadir un paso (p.ej. `npm install`) → entre implement y checks, con `skipped` si no aplica
