# ⚡ AI SCRUM TEAM ORCHESTRATOR

> Sistema de agentes IA especializados que utilizan **Claude.ai web** para construir automáticamente una aplicación de seguimiento de empleo, orquestados por un Scrum Master con iteraciones ágiles.

## 🏗 Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────┐
│                   DASHBOARD (localhost:3000)              │
│  Real-time WebSocket · Logs · Sprint Board · Artefactos  │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│              SCRUM MASTER ORCHESTRATOR                    │
│  Sprint Planning · Retrospectives · Flow Control         │
└──────┬──────────────┬──────────────┬────────────────────┘
       │              │              │
  ┌────▼────┐   ┌─────▼────┐   ┌────▼─────┐
  │PRODUCT  │   │DEVELOPER │   │QA TESTER │
  │OWNER    │   │ARCHITECT │   │          │
  │         │   │          │   │          │
  │Sarah 📋 │   │Alex  💻  │   │María 🔍  │
  └────┬────┘   └─────┬────┘   └────┬─────┘
       │              │              │
       └──────────────┴──────────────┘
                      │
         ┌────────────▼────────────┐
         │   claude.ai Web (x4)    │
         │   Playwright Browser    │
         └─────────────────────────┘
```

## 🎯 La App que Construye el Equipo

**JobTracker Pro** - Seguimiento completo de búsqueda de empleo:
- 📧 Integración Gmail (tracking emails automático y manual)
- 💼 LinkedIn, InfoJobs, Indeed, Tecnoempleo
- 📊 Dashboard de procesos activos con estados
- 🔔 Alertas de nuevas oportunidades no solicitadas
- 📈 Tendencias del mercado laboral y skills más demandadas
- 🔐 Auth local segura con cifrado de credenciales

## 📁 Estructura del Proyecto

```
ai-scrum-team/
├── server.js              # Express + WebSocket server
├── orchestrator.js        # Scrum Master logic
├── agents/
│   ├── base-agent.js      # Automatización Playwright → Claude.ai
│   ├── product-owner.js   # Agente Sarah (PO)
│   └── developer-qa.js    # Agentes Alex (Dev) + María (QA)
├── prompts/
│   └── index.js           # Personas y prompts de cada agente
├── config/
│   ├── credentials.json   # ⚠️ Credenciales locales (no subir a git)
│   └── project-config.json
├── outputs/               # Artefactos generados (auto)
│   └── session-XXXX/
│       ├── artifacts/     # PRD, arquitectura, tests, código
│       ├── final-app/     # Aplicación final generada
│       └── state.json
├── sessions/              # Sesiones Playwright guardadas
└── public/
    └── index.html         # Dashboard en tiempo real
```

## 🚀 Instalación

📘 **Guía detallada de uso** (definir proyecto, flujo de agentes, Ollama vs Claude, API, salidas): [`docs/GUIA-USO.md`](docs/GUIA-USO.md)

### Requisitos
- Node.js >= 18.0.0
- npm >= 8.0.0
- Cuenta en [claude.ai](https://claude.ai) (plan gratuito funciona)

### Pasos

```bash
# 1. Clonar/copiar el proyecto
cd ai-scrum-team

# 2. Instalar dependencias
npm install

# 3. Setup inicial (instala Chromium)
npm run setup

# 4. Configurar credenciales (VER ABAJO)

# 5. Iniciar
npm start
# → Abre http://localhost:3000
```

## 🤖 IA local con RAG (Ollama)

Puedes usar **IA en local** con **RAG** (Retrieval Augmented Generation) para que los agentes editen código y creen proyectos sin depender de Claude.ai ni del navegador.

### Requisitos
- [Ollama](https://ollama.com) instalado y en ejecución (`ollama serve`).
- Modelo de lenguaje, por ejemplo: `ollama pull llama3.2`
- Modelo de embeddings para RAG: `ollama pull nomic-embed-text`

### Configuración

En `config/project-config.json`:

```json
"agents": {
  "backend": "local",
  "local": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2",
    "embedModel": "nomic-embed-text",
    "rag": {
      "enabled": true,
      "indexPaths": ["./outputs", "./prompts"],
      "topK": 5
    }
  }
}
```

- **backend**: `"claude"` (web con Playwright) o `"local"` (Ollama + RAG).
- **local.baseUrl**: URL de Ollama (por defecto `http://localhost:11434`).
- **local.model**: Modelo para generar texto (p. ej. `llama3.2`, `codellama`, `mistral`).
- **local.rag**: Si está habilitado, se indexan las rutas en `indexPaths` (outputs, prompts, código) y se inyecta contexto relevante en cada prompt para mejorar respuestas y edición de código.

Con `backend: "local"` no hace falta configurar credenciales de Claude; el arranque del proyecto funciona sin `config/credentials.json`.

## ⚙️ Configuración de Credenciales (backend Claude)

Edita `config/credentials.json` o usa el panel de Settings en el dashboard:

**Claude.ai:** muchas cuentas solo usan **enlace mágico por email** (sin contraseña). En ese caso pon solo `email` y **no incluyas** `password`, o déjala vacía al guardar desde Settings.

```json
{
  "claude": {
    "email": "tu@email.com",
    "password": "opcional_solo_si_tu_cuenta_lo_pide"
  },
  "gmail": {
    "email": "tu@gmail.com",
    "password": "xxxx xxxx xxxx xxxx"  // App Password, NO la contraseña normal
  },
  "linkedin": { "email": "...", "password": "..." },
  "infojobs": { "email": "...", "password": "..." },
  "indeed": { "email": "...", "password": "..." }
}
```

> **Importante para Gmail**: Necesitas una **App Password** (no tu contraseña habitual).
> Obtenerla en: myaccount.google.com → Seguridad → Contraseñas de aplicaciones

## 🔄 Flujo del Sistema

### Por cada Sprint:

```
1. SCRUM MASTER    → Sprint Planning (define user stories y objetivos)
       ↓
2. PRODUCT OWNER   → Refina historias y criterios de aceptación
       ↓
3. DEVELOPER       → Implementa código completo y funcional
       ↓
4. QA TESTER       → Ejecuta pruebas, reporta bugs
       ↓
5. DEVELOPER       → Corrige bugs críticos (si los hay)
       ↓
6. SCRUM MASTER    → Sprint Review + Retrospectiva → Siguiente sprint
```

### Fases del Proyecto (5 Sprints):
1. **Fundación**: Auth, DB SQLite, estructura base, UI principal
2. **Gmail**: Integración IMAP/API, parsing de emails, tracking
3. **Portales de Empleo**: LinkedIn, InfoJobs, Indeed scraping
4. **Analytics**: Tendencias, skills demand, alertas inteligentes
5. **Pulido**: Tests, optimización, documentación, deployment

## 📊 Dashboard

El dashboard en `http://localhost:3000` muestra en tiempo real:

- **Agentes activos**: Estado y tarea actual de cada agente
- **Sprint Board**: Kanban con estado de cada sprint
- **Terminal**: Logs en tiempo real de todos los agentes
- **Artefactos**: PRD, arquitectura, código generado, reportes QA
- **Settings**: Configuración de credenciales y proyecto

## 💾 Outputs

Todo se guarda en `outputs/session-XXXX/`:
- `artifacts/` - Todos los artefactos en JSON
- `final-app/` - **Código completo de la aplicación generada**
- `state.json` - Estado completo de la sesión

## 🔒 Seguridad

- Las credenciales se guardan SOLO en local (`config/credentials.json`)
- Añade `config/credentials.json` a tu `.gitignore`
- Las sesiones de Playwright se guardan en `sessions/` (solo local)
- No se envía ningún dato a servidores externos salvo a claude.ai

## ⚠️ Notas Importantes

1. **Claude.ai free plan**: El plan gratuito tiene límites de mensajes. Para proyectos largos considera el plan Pro.
2. **Tiempo**: El proyecto completo puede tardar 2-4 horas según la velocidad de respuesta de Claude.
3. **Supervisión**: Se recomienda supervisar las primeras ejecuciones.
4. **Login manual**: Si Claude.ai requiere verificación 2FA, deberás completarlo manualmente en el navegador que se abre.

## 🛠 Comandos Útiles

```bash
npm start              # Inicia el servidor
npm run setup          # Setup inicial / reinstalar browsers
node orchestrator.js   # Ejecutar directamente sin UI
```

---

Made with ⚡ by AI Scrum Team Orchestrator
