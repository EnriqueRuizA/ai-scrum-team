# AI Scrum Team - Dashboard Simplificado para Ollama Local

Un equipo de agentes AI que trabajan juntos usando **solo Ollama (local)** sin necesitar cuentas cloud.

## 🚀 Cómo comenzar

```bat
# 1. Asegúrate de que Ollama esté corriendo
ollama serve

# 2. Instala el modelo por defecto (ya viene configurado)
ollama pull llama3.2

# 3. Instala modelo RAG (opcional)
ollama pull nomic-embed-text

# 4. Abre el dashboard automáticamente al iniciar el servidor
node server.js
```

## 📋 Dashboard simplificado

- **URL de Ollama**: `http://localhost:11434` (personalizable)  
- **Modelo por defecto**: `llama3.2` (configurable en config/agents-config.json)  
- **RAG**: Opcional - indexa tus archivos para búsqueda contextual  

## 🤖 Agentes disponibles

| Rol        | Nombre ejemplo   | Descripción                          |
|------------|------------------|--------------------------------------|
| Product Owner | Sarah           | Gestiona el backlog y prioridades   |
| Developer  | Alex             | Implementa funcionalidades           |
| QA Tester  | María            | Ejecuta pruebas                     |
| Scrum Master | Carlos          | Coordina el equipo y elimina bloqueos|

## 📁 Estructura de archivos

```
├── config/project-config.json        # Configuración del proyecto
├── config/agents-config.json         # Orden de agentes + modelos por agente (nuevo)
├── public/dashboard-local.html       # Dashboard simplificado para Ollama
├── orchestrator.js                   # Lógica del orquestrador
└── server.js                         # Servidor Express + WebSocket
```

## 🆕 Nuevas características

### 1. **Orden de agentes personalizado** (`agentsConfig.json`)

Define el orden en que se ejecutan los agentes:

```json
{
  "agentsOrder": ["productOwner", "developer", "qaTester", "scrumMaster"],
  "defaultModel": "gpt-4o-mini",
  "agents": {
    "productOwner": {},
    "developer": { "model": "gpt-4o" },
    "qaTester": {},
    "scrumMaster": {}
  }
}
```

### 2. **Endpoints de API nuevos**

- `PATCH /api/config/order` - Cambia el orden de agentes  
- `GET /api/config/models` - Lista modelos disponibles  
- `PATCH /api/config/agents/{id}/model` - Configura modelo por agente  

### 3. **Dashboard simplificado**

Solo lo esencial para Ollama:
- Configuración de conexión
- Selección de modelo por defecto
- Activación de RAG (opcional)
- Probar conexión con un clic

## ⚡ Instalación rápida

```bat
# Ollama
curl -fsSL https://ollama.com/install.ps1 | iex

# Modelos
ollama pull llama3.2
ollama pull nomic-embed-text

# Servidor
npm install
node server.js
```

## 📝 Notas

- El sistema usa **primero**: `agentsConfig.model` por agente  
- Luego: `agentConfig.defaultModel`  
- Finalmente: `gpt-4o-mini` (fallback)

- Por defecto se usa el modelo de Ollama configurado en `project-config.json`

---

**Preparado por AI-Scrum Team** 🤖
