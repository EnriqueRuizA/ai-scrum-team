---
tags: [clase, llm]
src: src/llm/ollama.js
---

# ollama

- **Ruta**: `src/llm/ollama.js`
- **Clase**: `OllamaClient`

## Miembros

- `constructor({ baseUrl, apiKey })`
- `generate({ model, messages, stream, timeout })` → `Promise<object>` — POST a `/api/generate`
- `embeddings({ model, inputs })` → `Promise<object>` — POST a `/api/embeddings`

## Relaciones

### Depende de

- [[logger]] — registra errores de `generate` / `embeddings`
- `fetch` (API nativa, sin nota)

### Usado por

- [[local_agent|LocalAgent]] — lo instancia como `this.llm`

## Dónde mirar / cambiar

- Cambios de endpoint, timeout o auth del LLM → aquí.
- Cambios de prompts o de qué modelo se usa → [[local_agent|LocalAgent]].
