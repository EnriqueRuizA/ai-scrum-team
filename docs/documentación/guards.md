---
tags: [modulo, seguridad]
src: server/guards.js
---

# guards

- **Ruta**: `server/guards.js` (+ `server/state-store.js`: `RunLock`)
- FASE 3. Detalle operativo en `docs/SECURITY.md` (threat model y reglas 1-8).

## Funciones

- `validateSessionId(id)` — `^session-[A-Za-z0-9-]{1,64}$` (verificado: `..%2F..` → 400)
- `validateArtifactName(name)` — sin `/`, sin `..`, sin empezar por `.`
- `safeJoin(base, ...parts)` — containment: el resuelto debe quedar dentro de `base`
- `isSafeKey/sanitizeKeys` — anti `__proto__`/`constructor`/`prototype`
- `escHtml` — `&<>"'` (el dashboard tiene el suyo; este es para servidor)
- `RunLock.tryAcquire/release/isLocked` — un solo `POST /api/start` en vuelo (409 si ocupado)

## Relaciones

### Usado por

- `server.js` — 4 endpoints (`sessions/:id`, `artifact/:session/:name`, `download/:session`, `session/focus`), merges de config, arranque (`start()` con bind `127.0.0.1` + puerto entero)
- `utils/exec-safe.js` — spawn sin shell (hermano, no dependencia)

## Dónde mirar / cambiar

- Nuevo endpoint con `:id` de sesión → validar + `safeJoin` (copiar el patrón)
- Rate-limit/helmet → `server.js` (FASE 3: 10/min `start`, 120/min escrituras)
