---
tags: [clase, ficheros, legacy]
src: src/file/editor.js (ELIMINADO en FASE 5, ver [[legacy-src]])
---

# editor

- **Ruta**: `src/file/editor.js`
- **Clase**: `FileEditor`

## Miembros

- `constructor(baseDir = process.cwd())`
- `read(file)` → `Promise<string>`
- `write(file, content)` → `Promise<string>` — crea dirs con `ensureDir`
- `patch(file, replacer)` → `Promise<string>` — read + `replacer(txt)` + write
- `delete(file)` → `Promise<void>`

## Relaciones

### Depende de

- [[logger]] — trazas `debug`/`info`/`error`
- `fs-extra`, `path` (externos, sin nota)

### Usado por

- [[local_agent|LocalAgent]] — lo instancia como `this.editor`; acción `write` en `handleResponse()`

## Dónde mirar / cambiar

- Cambios de I/O de ficheros (paths, encoding, permisos) → aquí.
