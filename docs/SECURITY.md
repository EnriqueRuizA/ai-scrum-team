# Seguridad — ai-scrum-team (FASE 3)

## Modelo de amenaza

- App de **un solo usuario en localhost**. El servidor escucha en
  `127.0.0.1` por defecto (`AI_SCRUM_BIND=0.0.0.0` solo si sabes lo que haces).
- **Sin autenticacion** en API ni WebSocket: cualquiera con acceso a la maquina
  (o a la LAN si cambias el bind) puede lanzar proyectos y leer artefactos.
  No exponer a internet sin un reverse-proxy con auth delante.
- El contenido del LLM se trata como **no confiable**: se sanea antes de tocar
  disco, DOM o procesos.

## Reglas implementadas

1. **Sin secretos en el repo.** `**/credentials.json`, `.env`, `*.log`,
   `outputs/`, `sessions/` estan en `.gitignore`. `npm run check:secrets`
   falla si se trackea algo prohibido. La auth de proveedores LLM vive en
   opencode (`~/.local/share/opencode/auth.json`), nunca en este proyecto.
2. **Path traversal bloqueado.** `server/guards.js`: `validateSessionId()`
   (`^session-[A-Za-z0-9-]{1,64}$`), `validateArtifactName()` y `safeJoin()`
   con containment. Aplicado en `/api/sessions/:id`,
   `/api/artifact/:session/:name`, `/api/download/:session`,
   `/api/session/focus`. La escritura de ficheros del pipeline
   (`orchestrator/pipeline.js`, `lib/deliverable.js`) rechaza `..` y absolutas.
3. **Anti prototype-pollution.** `POST /api/credentials` filtra
   `__proto__`/`constructor`/`prototype`.
4. **Higiene HTTP.** `helmet` (sin CSP porque el dashboard usa inline),
   `express.json({limit:'100kb'})`, rate-limit (10/min en `/api/start`,
   120/min en resto de POST/PATCH), puerto validado como entero, bind local.
5. **Sin ejecucion con shell.** Todo spawn usa `shell:false` con args
   validados (`utils/exec-safe.js`, `lib/deliverable.js` con `execFile`).
   El auto-open del dashboard solo interpola un puerto entero validado.
6. **Sin OK falsos.** `runRealProjectChecks` y dir sin `.js` devuelven
   `skipped`, nunca `ok:true`.
7. **XSS.** `escHtml`/`escapeHtml` escapan `&<>"'`; `sprint.goal`, estados y
   nombres de artefacto se escapan antes de `innerHTML`; Mermaid en
   `securityLevel:'strict'` + allowlist `flowchart|graph` sin HTML/handlers.
8. **Motor opencode.** El prompt viaja como argumento/JSON, nunca interpolado.
   `stdin:'ignore'` en headless (falla rapido, no cuelga). El modelo trabaja
   en `outputs/session-XXX`, no en la raiz del repo. `auto:false` por defecto
   (opencode no aprueba herramientas solo).

## Que hacer si hay incidente

1. `STOP.bat` (y `STOP.bat --with-engine` si levantaste el serve desde START).
2. Rota las claves expuestas (Gmail App Password, LinkedIn, Indeed...).
3. Si commiteaste secretos: `git rm --cached <fichero>` + commit + rotacion.
   (Sin remoto publico no hace falta reescribir historial; con remoto
   publico, avisa para coordinar `filter-repo` + force-push.)
