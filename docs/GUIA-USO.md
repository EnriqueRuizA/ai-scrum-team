# Guía detallada de uso — AI Scrum Team Orchestrator

Este documento explica **cómo usar el programa** para definir un proyecto, configurar el flujo de agentes y ejecutar el orquestador hasta obtener artefactos y (si aplica) código generado.

---

## 1. Qué hace la aplicación

El **orquestador (Scrum Master)** coordina varios agentes especializados:

| Agente | Rol |
|--------|-----|
| **Product Owner (Sarah)** | Genera el PRD y valida entregables |
| **Developer (Alex)** | Diseña arquitectura e implementa sprints |
| **QA (María)** | Plan de pruebas, reportes y verificación |
| **Scrum Master (Carlos)** | Planificación de sprints, retrospectivas, entrega final |

Hay **dos backends** para la IA:

- **`claude`**: los agentes usan **Claude.ai en el navegador** vía Playwright (como mínimo el **email** de Claude; la contraseña es opcional si tu cuenta usa solo **enlace mágico por correo**).
- **`local`**: los agentes usan **Ollama** (y opcionalmente **RAG**) sin abrir el navegador.

El flujo global es:

1. **Fase 1 — Discovery & planning**: PRD → arquitectura → plan de pruebas → planificación de sprints.
2. **Fase 2 — Sprints**: por cada sprint, planning → implementación → QA → (bugs críticos) fixes → review → retrospectiva.
3. **Fase 3 — Entrega final**: escribe la app generada en `outputs/session-XXXX/final-app/` si hay código final parseable.

Todo lo relevante se guarda bajo **`outputs/session-<id>/`** (`artifacts/`, `state.json`, `final-app/`).

---

## 2. Requisitos previos

| Componente | Obligatorio |
|------------|-------------|
| **Node.js** ≥ 18 | Sí |
| **npm** | Sí |
| **Dependencias** (`npm install`) | Sí |
| **Playwright Chromium** (`npm run setup`) | Sí si usas backend **`claude`** |
| **Cuenta Claude.ai + credenciales** | Solo si `agents.backend` = **`claude`** |
| **Ollama** + modelo + embeddings | Solo si `agents.backend` = **`local`** y RAG activo |

### PowerShell en Windows

Si `npm` falla por política de ejecución, usa:

```bat
cmd /c "npm start"
```

o:

```powershell
npm.cmd test
```

---

## 3. Instalación inicial (una vez)

En la carpeta del proyecto:

```bash
npm install
npm run setup
```

`setup` crea carpetas (`outputs`, `sessions`, `logs`) e instala Chromium para Playwright.

---

## 4. Arrancar y parar el servidor

| Acción | Cómo |
|--------|------|
| Iniciar | `START.bat` o `npm start` |
| Parar | `STOP.bat` o **Ctrl+C** en la consola donde corre el servidor |

- Si el **puerto ya está en uso** (por defecto `3000`), `START.bat` puede indicar que ya hay un servidor; no abras dos instancias en el mismo puerto.
- El puerto se lee de `config/project-config.json` → `outputs.port` (o variable de entorno `PORT` si la usas).

**Dashboard:** `http://localhost:<puerto>` (por defecto `http://localhost:3000`).

- **F5 / recargar:** el panel vuelve a pedir `GET /api/state` y el WebSocket envía el estado al conectar. Los **logs** y **artefactos** se reconstruyen desde `outputs/session-XXXX/state.json` (y el puntero `outputs/.last-dashboard-session.json` que se actualiza en cada `saveState`). Si **reinicias solo el servidor** Node, también se recupera la última sesión guardada en disco.
- **Parar el servidor (Ctrl+C):** se intenta **guardar `state.json`** antes de salir. En el dashboard, **Sesiones en disco** + **Cargar en panel** lista `outputs/session-*` (por fecha) y restaura la vista; **POST /api/session/focus** deja esa sesión como predeterminada para el próximo F5.
- **Pausa / parada:** en el panel lateral, **Pausa** (`POST /api/run/pause`) hace que el flujo **espere entre pasos** (no interrumpe una respuesta del modelo ya en curso). **Reanudar** (`POST /api/run/resume`). **Stop tras sprint** (`POST /api/run/stop-after-step`) termina al **acabar el sprint actual** (o un hito de discovery) y guarda estado (`status: stopped`). **No existe reanudar el mismo run** tras parar el proceso Node: la recuperación es **vista + artefactos** o un **nuevo** “Iniciar proyecto”.
- **Informes QA:** en artefactos tipo QA, la pestaña **Lectura** muestra recomendación, casos de prueba y bugs con **colores** (severidad y PASS/FAIL).

> **Importante:** No abras el `index.html` con doble clic (`file://`). Sin el servidor Node, **no hay** `/api/config`, **no se guarda** la configuración y el WebSocket quedará en **DISCONNECTED**. Usa siempre la URL que imprime la consola al arrancar.

En **Settings** del panel completo (`/`): puedes elegir **backend** (Ollama vs Claude), la **URL de Ollama** y un **combo de modelos locales** cargado desde el servidor (`GET /api/ollama/models`). Al ejecutar el proyecto, una **barra de carga** bajo el encabezado indica cuando el orquestador está **esperando respuesta del modelo** (eventos WebSocket `agent_sending` / `agent_response` y mensajes en log).

### Flujo visual y equipo (`agents.team`)

- Pestaña **Flujo**: diagrama **Mermaid** generado desde `config/project-config.json` (`GET /api/flow/diagram`), según roles **activos** y `scrum.maxSprints`.
- En **Settings → Equipo**: activa/desactiva roles, edita el nombre visible, **añade** filas con roles que falten o **quita** filas (no puedes eliminar la fila del **Scrum Master**; debe quedar al menos un SM **activo** al guardar). Roles válidos: `productOwner`, `developer`, `qaTester`, `scrumMaster`.
- **RAG (importante):** **no existe “importar RAG” dentro de Ollama.** El proyecto lee ficheros de tu disco (`agents.local.rag.indexPaths`), trocea el texto y llama a la API de Ollama **`/api/embeddings`** usando un **segundo modelo** (embeddings), distinto del de chat. Por defecto suele ser **`nomic-embed-text`**: si no lo tienes, verás `404 model not found`. Solución en terminal: `ollama pull nomic-embed-text` (o el nombre que pongas en `agents.local.embedModel`). En **Settings** hay casilla **Activar RAG**, campo **Modelo de embeddings** y botón **Comprobar chat + embeddings** (`GET /api/ollama/verify`). Al **Iniciar proyecto**, si RAG está activo y falta el modelo de embeddings, el servidor devuelve error claro antes de arrancar el flujo.
- **RAG — contexto:** tras PRD, arquitectura y plan de pruebas, el orquestador **inyecta** resúmenes en el índice (`injectArtifactRag`). Ajusta `agents.local.rag.indexPaths` (p. ej. `.`, `./lib`, `./prompts`) para ampliar contexto.
- **Entrega real**: con **Copia working-app tras cada sprint** los ficheros del JSON de implementación se escriben en `outputs/session-…/working-app/`. Si **Comprobaciones reales cada sprint** está activo, el orquestador ejecuta ahí **`npm install`**, **`node --check`** en `.js` y **`npm test`** (según `package.json`), y pasa el **informe** al QA para que no sea solo revisión “a ojo”. Opciones en `outputs`: **`requireFilesEachSprint`** (rechazar sprint sin `files[]`), **`implementationRetryMax`** (reintentos al developer si 0 ficheros), **`failSprintIfChecksFail`** (no aprobar si fallan npm/sintaxis/test). Al terminar el flujo: **`final-app/`** + README y las mismas comprobaciones de entrega si las tienes activadas.
- **`pipeline.ragArtifactMaxChars`**: tamaño máximo del texto inyectado por artefacto (por defecto 100000).

### Dos interfaces en el repo (por qué “no es la misma vista”)

- **Panel completo (recomendado):** `http://localhost:<puerto>/` — `index.html` en la **raíz** del proyecto (pestañas Dashboard, Agentes, Sprints, Artefactos, Logs y **Settings**).
- **Vista compacta:** `http://localhost:<puerto>/simple` — el HTML que está en `public/` (solo tarjetas “Proyecto actual” + “Actividad reciente”).
- Si entras a `http://localhost:<puerto>/index.html`, el servidor **redirige** a `/` para que siempre veas el panel completo y no la vista compacta por error.

---

## 5. Definir “qué proyecto” construyen los agentes

La definición del producto vive en **`config/project-config.json`**. Los campos que más influyen en el flujo son:

### 5.1 Identidad del proyecto

```json
"project": {
  "name": "Nombre del producto",
  "description": "Descripción clara de lo que debe construirse. Los agentes la usan en prompts.",
  "version": "0.1.0"
}
```

- **`description`**: es la entrada principal al PO para el PRD y al Dev para la arquitectura. Cuanto más concreta, mejor.

### 5.2 Alcance y stack “objetivo”

```json
"target": {
  "features": [ "lista de capacidades deseadas" ],
  "techStack": {
    "frontend": "...",
    "backend": "...",
    "database": "...",
    "integrations": [ "..." ]
  }
}
```

Esto alimenta los **prompts** de los agentes (personas en `prompts/index.js`).

### 5.3 Scrum

```json
"scrum": {
  "sprintDurationDays": 1,
  "maxSprints": 5,
  "autoAdvance": true,
  "reviewBeforeAdvance": true
}
```

- **`maxSprints`**: número máximo de iteraciones de desarrollo (cada una con implementación + QA + retrospectiva).

### 5.4 Salida y puerto

```json
"outputs": {
  "saveArtifacts": true,
  "autoOpenDashboard": true,
  "port": 3000
}
```

- **`saveArtifacts`**: si es `true`, se guardan artefactos JSON en `outputs/.../artifacts/`.
- **`autoOpenDashboard`**: al arrancar, intenta abrir el navegador (puede desactivarse).

Puedes editar este JSON a mano o, si implementas un panel “Settings” que llame a `POST /api/config`, desde ahí (el servidor ya soporta ese endpoint).

---

## 6. Elegir backend de agentes: `local` vs `claude`

En **`config/project-config.json`**:

```json
"agents": {
  "backend": "local",
  ...
}
```

o

```json
"agents": { "backend": "claude", ... }
```

### 6.1 Modo `local` (Ollama)

```json
"agents": {
  "backend": "local",
  "timeout": 180000,
  "sessionDir": "./sessions",
  "local": {
    "baseUrl": "http://localhost:11434",
    "llmConnectionPreset": "ollama_local",
    "llmConnectionLabel": "",
    "model": "nombre-del-modelo-en-ollama",
    "generateTimeoutMs": 1200000,
    "embedModel": "nomic-embed-text",
    "rag": {
      "enabled": true,
      "indexPaths": ["./outputs", "./prompts"],
      "topK": 5
    }
  }
}
```

- **`agents.timeout`**: se usa sobre todo en el flujo **Claude** (esperas en el navegador). **No** limita bien a Ollama.
- **`agents.local.llmConnectionPreset`**: `ollama_local` | `remote_api` | `custom` — no cambia la URL; sirve para **que coincida con la realidad** y salga claro en logs. Si lo omites, se infiere por host (localhost → local).
- **`agents.local.llmConnectionLabel`**: texto libre (p. ej. «Cursor», «OpenRouter») que verás en **cada llamada al modelo** y en el resumen al iniciar el proyecto.
- **`agents.local.generateTimeoutMs`** (opcional): tiempo máximo en milisegundos para cada llamada a Ollama (`/api/generate`). Si no lo pones, el código usa **900000** (15 min). Con modelos grandes (p. ej. 32B) en CPU, sube a **1200000–1800000** (20–30 min) si ves *Timeout esperando respuesta del modelo local*.

**Si ves `fetch failed`, `HeadersTimeoutError` o `UND_ERR_HEADERS_TIMEOUT`:** venían del **`fetch` de Node (undici)**, que limita cabeceras/cuerpo (~300 s). Las rutas a Ollama (`/api/generate`, `/api/embeddings`, `/api/tags`) usan **HTTP nativo**. Opcional: **`agents.local.embedTimeoutMs`** para embeddings/RAG (por defecto interno 10 min si no lo defines).

**Pasos:**

1. Instala y ejecuta Ollama (`ollama serve`).
2. Descarga el modelo que pongas en **`model`**: `ollama pull <modelo>`.
3. Si RAG está activo, descarga embeddings: `ollama pull nomic-embed-text` (o el que indiques en `embedModel`).
4. El servidor, al iniciar el proyecto, comprueba que Ollama responde y que el modelo existe; si no, verás un error claro en el dashboard o en la respuesta de `POST /api/start`.

**No necesitas** credenciales de Claude en este modo.

#### API key (proxy, Ollama en la nube, proveedor compatible)

Si el endpoint en **`agents.local.baseUrl`** exige autenticación, puedes configurarla así (el dashboard en **Settings** tiene los mismos campos; la clave **no** se devuelve en `GET /api/config`, solo `hasApiKey`):

| Campo | Descripción |
|--------|-------------|
| **`apiKey`** | Clave en el JSON (evita subirla a git; mejor variable de entorno). |
| **`apiKeyEnv`** | Nombre de variable de entorno (p. ej. `OPENAI_API_KEY`); **tiene prioridad** sobre `apiKey` del fichero. |
| **`apiKeyMode`** | `bearer` → `Authorization: Bearer <clave>` (OpenAI, muchas APIs). `x-api-key` → cabecera `X-API-Key`. `custom` → usa `apiKeyHeader` + `apiKeyPrefix`. |
| *(env global)* | Sin tocar el config: `AI_SCRUM_LOCAL_API_KEY` u `OLLAMA_API_KEY`. |

Las peticiones a **`/api/generate`**, **`/api/embeddings`** y **`/api/tags`** llevan esas cabeceras. El backend sigue siendo el **API estilo Ollama** (no es un cliente genérico OpenAI `chat/completions`).

### 6.2 Modo `claude` (Claude.ai + Playwright)

```json
"agents": {
  "backend": "claude",
  "headless": false,
  "slowMo": 100,
  "timeout": 180000,
  "sessionDir": "./sessions",
  "shareSession": true,
  "userDataDir": ""
}
```

**Pasos:**

1. Configura **`config/credentials.json`** con **`claude.email`** (obligatorio). **`claude.password`** solo si tu flujo de Claude lo pide tras el email; si solo recibes **enlace mágico**, déjala vacía u omítela. También puedes usar `POST /api/credentials` desde Settings.
2. Ejecuta `npm run setup` para tener Chromium.
3. La primera vez puede pedirte **2FA** o verificación en el navegador que abre Playwright.

Opciones útiles:

- **`shareSession: true`**: un solo navegador compartido (menos ventanas).
- **`headless: false`**: ver el navegador (recomendado al depurar login).
- **`userDataDir`**: perfil persistente de Chrome/Chromium para conservar sesión (ruta vacía = no usar perfil fijo).

---

## 7. Credenciales (`config/credentials.json`)

El fichero incluye slots para Claude, Gmail, portales de empleo, etc. Con backend **`claude`**, el servidor exige **solo el email de Claude**. La contraseña es opcional: muchas cuentas entran con **confirmación por correo** (magic link). El agente rellena el email en la web y espera hasta **5 minutos** a que completes el enlace y/o el login en el navegador que abre Playwright.

**Seguridad:** no subas este archivo a git; mantenlo solo en local.

---

## 8. Uso del dashboard (flujo típico)

1. Arranca el servidor (`START.bat` o `npm start`).
2. Abre el dashboard en el navegador.
3. El cliente carga **`GET /api/config`** y muestra nombre del proyecto y `maxSprints`.
4. Pulsa **“Iniciar proyecto”** → **`POST /api/start`**.
5. Los eventos llegan por **WebSocket** (logs, estado, errores, `completed`).

Si el inicio falla (Ollama caído, modelo inexistente, credenciales Claude faltantes, otro proyecto ya en ejecución), el mensaje aparece en el panel de actividad.

**Nota:** el hint del dashboard menciona credenciales Claude; en modo **`local`** no son necesarias para arrancar.

---

## 9. Flujo interno de agentes (qué ocurre en cada fase)

### Fase 1 — Discovery

1. **PO** → `createPRD(project.description)` → artefacto PRD.
2. **Dev** → `designArchitecture(prd)` → artefacto arquitectura.
3. **QA** → `createTestPlan(prd, architecture)` → plan de pruebas.
4. **Scrum Master** → planifica todos los sprints a partir de PRD + arquitectura.

### Fase 2 — Por cada sprint (1 … `maxSprints`)

1. **SM** → plan detallado del sprint.
2. **Dev** → `implementSprint(...)`.
3. **QA** → `testImplementation(...)`.
4. Si hay bugs **CRITICAL** → Dev corrige y QA verifica.
5. Aprobación según recomendación del informe QA.
6. **SM** → retrospectiva.

### Fase 3 — Entrega

- Si hay implementación con ficheros en el JSON esperado, se escribe **`final-app/`** y un README generado por el SM.

---

## 10. Dónde están los resultados

```
outputs/
  session-<primeros 8 chars del uuid>/
    state.json           # estado completo + logs
    artifacts/           # prd.json, architecture.json, sprint-N-*.json, etc.
    final-app/           # código generado (si aplica)
```

Puedes listar sesiones con **`GET /api/sessions`** o inspeccionar carpetas manualmente.

---

## 11. API REST (uso avanzado)

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/api/config` | Config + credenciales “seguras” (sin passwords al cliente) |
| POST | `/api/config` | Actualizar `project-config.json` |
| POST | `/api/credentials` | Fusionar y guardar credenciales |
| POST | `/api/start` | Iniciar orquestación (comprueba Claude u Ollama según backend) |
| GET | `/api/state` | Estado actual del orquestador |
| POST | `/api/pause` | Pausa (broadcast; lógica fina depende de implementación) |
| GET | `/api/sessions` | Listado de sesiones en `outputs/` |
| GET | `/api/sessions/:id` | Cargar `state.json` de una sesión |
| GET | `/api/artifact/:session/:name` | Leer un artefacto JSON |
| GET | `/api/download/:session` | Info de ruta de `final-app` |

**WebSocket:** mismo host/puerto que HTTP; el cliente recibe mensajes `{ type, data, timestamp }`.

---

## 12. Personalizar el “comportamiento” de los agentes

- **Personas y prompts:** `prompts/index.js` (funciones que reciben `config` y generan el system prompt).
- **Lógica de orquestación:** `orchestrator.js` (orden de fases, llamadas a agentes).
- **Automatización web Claude:** `agents/base-agent.js`, `agents/product-owner.js`, `agents/developer-qa.js`.
- **Agentes locales:** `agents/local-agents.js`, `agents/local-rag-agent.js`, `lib/local-llm.js`, `lib/rag.js`.

Tras cambiar prompts u orquestación, reinicia el servidor y vuelve a lanzar un proyecto.

---

## 13. Tests automatizados

```bash
cmd /c "npm test"
```

Ver `jest.config.js` y `__tests__/` para cobertura de API, WebSocket y utilidades.

---

## 14. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| Puerto en uso | Otro `node server.js` | `STOP.bat` o cierra el proceso del puerto |
| Modelo no encontrado (Ollama) | Modelo no instalado o nombre distinto | `ollama pull <modelo>` y alinear `agents.local.model` |
| No conecta a Ollama | Ollama no arranca | `ollama serve`, revisar `agents.local.baseUrl` |
| Credenciales Claude | Backend `claude` sin email | Poner `claude.email` (contraseña no obligatoria si usas magic link) |
| Proyecto muy largo / límites | Plan gratuito Claude | Reducir `maxSprints` o usar modelo local más rápido |

---

## 15. Resumen rápido “crear un proyecto nuevo”

1. Copia/clona el repo y `npm install` + `npm run setup` (si usas Claude).
2. Edita **`config/project-config.json`**: `project.name`, `project.description`, `target`, `scrum.maxSprints`, `agents.backend` y bloque `local` o credenciales Claude.
3. Si es **`local`**: Ollama + `ollama pull` del modelo y del embedding si usas RAG.
4. Si es **`claude`**: rellena al menos **`claude.email`** en `config/credentials.json` (contraseña solo si la usas).
5. `START.bat` → dashboard → **Iniciar proyecto**.
6. Revisa **`outputs/session-.../`** para artefactos y `final-app`.

Si quieres un **segundo producto** distinto de JobTracker, basta con cambiar `project` y `target` en `project-config.json` y volver a ejecutar; el mismo flujo de agentes se aplica a la nueva descripción.
