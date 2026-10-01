---
tags: [clase, ficheros, legacy]
src: src/file/validator.js (ELIMINADO en FASE 5, ver [[legacy-src]])
---

# validator

- **Ruta**: `src/file/validator.js`
- **Clase**: `Validator` (métodos estáticos)

## Miembros

- `static lint(file)` → `Promise<{ok, error?}>` — ejecuta `npx eslint`
- `static syntax(file)` → `Promise<{ok, error?}>` — `import()` dinámico
- `static test()` → `Promise<{ok, output?, error?}>` — ejecuta `npm test`

## Relaciones

### Depende de

- [[logger]] — registra errores
- `child_process.execSync` (Node, sin nota)

### Usado por

- [[local_agent|LocalAgent]] — vía `Validator.lint()` / `Validator.test()` en `handleResponse()`

## Dónde mirar / cambiar

- Cambiar linter, comando de tests o chequeo de sintaxis → aquí.
