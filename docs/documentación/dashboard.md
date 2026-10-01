---
tags: [modulo, frontend]
src: index.html
---

# dashboard

- **Ruta**: `index.html` (raíz, ~3490 líneas; lo sirve `GET /`, ver `server/routes/static.js`)
- Servido en `http://127.0.0.1:3000`. No abrir con doble clic (ver `MSG_DEBES_ABRIR_LOCALHOST`).

## Logs (FASE 6: topes por todas partes)

- Servidor: `GET /api/state?logs=N&since=ISO` (`limitStateLogs` en `server/helpers.js`).
  Defecto `500`, `0`=todos, tope `5000`. Responde `_logsTotal` y `_logsLimited`.
- Cliente: `MAX_CLIENT_LOGS=2000` en `allLogs` (`handleLog` + `hydrateArtifactsAndLogsFromState`
  recortan); DOM podado a 500 nodos por panel (`addTerminalLine`).
- `clearLogs()` vacía vista Y memoria (antes solo un panel).
- `filterLogs()` solo oculta (`display:none`), no borra.

## Seguridad render (FASE 3)

- `escHtml`/`escapeHtml` cubren `&<>"'`; `sprint.goal`, estados y nombres de
  artefacto escapados; `showArtifact` usa `textContent`.
- Mermaid: `securityLevel:'strict'` + allowlist `flowchart|graph` sin HTML/handlers.

## Tiempo real

- WS sin auth (solo localhost): ver `docs/adr/0001-ws-sin-auth-localhost.md` y [[guards]].
- Reconexión con backoff (`connectWS` + `ping` 30 s); `updateFromState` hidrata tras F5.
- Vistas: `/` (completa), `/simple` (compacta `public/index.html`).

## Relaciones

### Depende de

- [[guards]] — `limitStateLogs`, validación de sesiones
- [[state]] — formato de `state.json` que hidrata

## Dónde mirar / cambiar

- Añadir un panel → `updateFromState` + `hydrateArtifactsAndLogsFromState`
- Nuevo endpoint consumido → misma forma que `fetch('/api/state?logs=500')` del INIT
- `public/index.html` (compacta) no tiene estos topes: si se usa, portarlos
