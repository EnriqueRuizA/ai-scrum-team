---
tags: [indice, legacy]
---

# legacy-src

Código muerto pendiente de eliminar en [[fases|FASE 5]]. **No construir encima.**
Las notas antiguas (`[[orchestrator]]`, [[local_agent]], [[ollama]], [[editor]],
[[validator]], [[ragi]], [[logger]]) describen estos ficheros y siguen siendo
válidas como arqueología, pero el runtime ya no los usa:

- `src/orchestrator/orchestrator.js` — orquestador duplicado (solo lo usa un test humo ya borrado)
- `src/agent/local.js` — nunca funcionó (`config.local` inexistente, `agentModel` indefinida)
- `src/llm/ollama.js`, `src/llm/ragi.js` — payload de `/api/chat` contra `/api/generate`; `fetch{timeout}` ignorado
- `src/file/editor.js`, `src/file/validator.js` — escritura sin contención + `execSync` interpolado
- `agents/base-agent.js`, `agents/product-owner.js`, `agents/developer-qa.js`, `agents/local-rag-agent.js` — backend Claude/Playwright y RAG a medida (sustituidos por [[motor-opencode]])
- `lib/local-llm.js`, `lib/unified-local-llm.js`, `lib/openai-compatible-llm.js`, `lib/cursor-cloud-llm.js`, `lib/rag.js`, ... — capa LLM a medida (sustituida por [[opencode-adapter]])

Excepción: `lib/deliverable.js`, `lib/parse-llm-json.js` y `lib/default-team.js`
siguen vivos (los usan [[pipeline]] y [[team-config]]).
