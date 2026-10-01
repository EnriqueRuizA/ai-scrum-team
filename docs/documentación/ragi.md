---
tags: [funcion, llm, rag, legacy]
src: src/llm/ragi.js (ELIMINADO en FASE 5, ver [[legacy-src]])
---

# ragi

- **Ruta**: `src/llm/ragi.js`
- **Exportado**: `cosineSimilarity(a, b)` → `number`

## Descripción

Calcula similitud coseno entre dos vectores. Función pura, sin dependencias.

## Relaciones

### Depende de

- Nada (sin imports)

### Usado por

- [[local_agent|LocalAgent]] — lo importa como `{ RAG }` (`require('../llm/ragi.js')`)

> ⚠️ Discrepancia detectada: [[local_agent|LocalAgent]] hace `require { RAG }` y usa `new RAG({...})` con métodos `build()` / `query()`, pero este fichero **solo exporta `cosineSimilarity`**. Falta la clase `RAG` o el fichero real está en `lib/rag.js` (pendiente de analizar — ver nota `ClassGraph`).

## Dónde mirar / cambiar

- Lógica de similitud / embeddings → aquí.
- Implementación real del RAG (`build`, `query`, `indexPaths`, `topK`) → pendiente: analizar `lib/rag.js`.
