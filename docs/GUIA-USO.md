# Guía de uso — AI Scrum Team Orchestrator

Cómo definir roles, flujo y motor, y ejecutar proyectos hasta obtener
artefactos y código. Referencia rápida: [`README.md`](../README.md).

## 1. Qué hace

El orquestador ejecuta tu **flow** (pasos rol+tarea con loops) con el motor
**opencode** (modelos gratuitos), sprint a sprint:

1. Por cada sprint (1 … `maxSprints`): se ejecutan los pasos del flow en orden
   (p.ej. plan → refinar → implementar → probar con loop de fix → revisar).
2. Cada llamada al modelo guarda su **prompt + respuesta** (vista Conversación)
   y sus ficheros en `final-app/`.
3. Todo queda en `outputs/session-XXXXXXXX/` (`artifacts/`, `state.json`).

## 2. Requisitos

- Node.js >= 20, `npm ci`
- `opencode` instalado + un modelo: Ollama local (`ollama pull qwen3.5:9b`)
  o cloud free (`opencode/*-free`, ver botón «Cargar nube opencode»)

## 3. Arranque

| Acción | Cómo |
|--------|------|
| Iniciar | `START.bat` (preflight + dashboard) o `npm start` |
| Parar | `STOP.bat` (`--with-engine` para parar también el serve) |

Dashboard: `http://127.0.0.1:3000` (nunca abras `index.html` con doble clic).
Tres pestañas: **Proyecto**, **Agentes**, **Ajustes**.

## 4. Flujo típico

1. Mira el pill **Motor** (OK = listo; si no, sigue su hint).
2. En **Agentes**: revisa roles (misión, modelo, skills) y flow (orden, loops).
   Pulsa **Guardar equipo y flujo**.
3. En **Ajustes**: proyecto, sprints y motor (modo/modelo/variante). Guardar.
4. En **Proyecto**: **Iniciar**. Sigue sprints, artefactos y Conversación en vivo.
5. **Pausa** espera entre pasos; **Stop tras sprint** cierra ordenado y guarda.
   No se puede reanudar un run parado: lanza otro o recupera la vista desde
   Sesiones en disco (solo vista, no continúa el trabajo).

## 5. Roles, flow, skills, modelos

En `config/project-config.json` (todo editable desde la UI):

- `agents.roles[]`: `{id, label, mission, extra?, model?, variant?, skills[], enabled}`.
  Sin ids reservados; los 4 clásicos son el default. `mission` obligatoria
  (≥10 chars) salvo clásicos (usan su persona detallada si está vacía).
- `agents.flow[]`: `{role, task, loop?, onError?}`. Tareas: plan, refinar,
  implementar, probar, revisar, libre. Loops: `until` (qa.passed,
  noCriticalBugs, filesWritten, always) + `max` (1–10, tope duro) + `fix?`.
- `agents.models[]`: registro `{id, label}` (locales `ollama/…`, cloud
  `opencode/…`, `ollama-cloud/…`). Botones: «Cargar de Ollama»
  (`ollama list`) y «Cargar nube opencode». Roles y motor referencian por id
  (el validador caza typos).
- `agents.opencode`: `{mode: run|serve, model, variant?, url, timeoutMs, auto}`.
  `variant` (p.ej. `xhigh`) global + por rol; la UI sugiere las de cada modelo
  (catálogo `opencode models --verbose`, caché 5 min).
- Skills: nombres en el rol; deben existir en `.opencode/skills/<n>/SKILL.md`
  (`setup.js` avisa; al guardar se advierte sin bloquear).

## 6. Motor y auth

Sin credenciales en el proyecto. Ollama local no pide nada; cloud de opencode
puede pedir `opencode auth login`; Ollama Cloud además `ollama pull
<modelo>-cloud`. `setup.js` (`START.bat` lo ejecuta) verifica config, motor y
modelo con hints accionables.

## 7. Resultados

```
outputs/
  session-xxxxxxxx/
    state.json     # estado + logs (topados)
    artifacts/     # sprint-N-step-I-rol-tarea.json (con exchanges), checks...
    final-app/     # código generado
```

- `GET /api/state?logs=N&since=ISO` (defecto 500, tope 5000).
- `GET /api/steps/:session` (conversaciones por paso, para la vista).
- `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/session/focus`.
- `GET /api/engine/health`, `GET /api/engine/ollama-models`,
  `GET /api/engine/opencode-models[?verbose=1]`, `GET /api/skills`.
- `POST /api/config` (valida, 400 con campo), `GET /api/config`.
- WebSocket: `{type, data, timestamp}` (`log`, `exchange`, `sprint_update`…).

## 8. Personalizar

- Personas: `agents/personas.js` (clásicos) o `mission`+`extra` por rol.
- Tareas: `orchestrator/tasks/*.js` (prompt + parse).
- Ejecutor: `orchestrator/pipeline.js`. Servidor: `server/` por rutas.
- Tras cambiar código: reinicia el servidor (`STOP.bat` + `START.bat`).

## 9. Tests

```bash
npm test          # Jest, 140 tests, sin motor real
npm run lint
npm run check:secrets
npm run smoke     # sprint mínimo contra motor real (manual)
```

## 10. Problemas

Ver [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). Resumen: puerto ocupado →
`STOP.bat`; `No se esperaba .` → era un bug de `START.bat`, ya corregido
(nunca paréntesis en `echo` dentro de bloques); run lento → usa `serve`;
modelo ausente → pill/hint o `ollama pull`.
