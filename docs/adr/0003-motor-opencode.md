# ADR 0003 — opencode como único motor de IA

Fecha: 2026-10-01. Estado: aceptado.

## Contexto

El proyecto tenía tres capas de LLM a medida (`lib/local-llm.js`,
`lib/unified-local-llm.js`, `lib/openai-compatible-llm.js`,
`lib/cursor-cloud-llm.js`), RAG propio, agentes Playwright→Claude.ai y un
orquestador truncado. Gran parte no funcionaba (ver informe de auditoría
2026-09-30) y ataba el proyecto a APIs de pago.

## Decisión

opencode es el único motor (`llm/opencode-adapter.js`): modos `run`
(`opencode run --format json`, sin proceso previo) y `serve` (HTTP
persistente). Modelos gratuitos: Ollama local y `opencode/*-free`
(verificado muse-spark sin login). Lo de pago sigue disponible como
proveedor en opencode, sin código nuestro.

## Consecuencias

- Se borró toda la capa `lib/*` de LLM/RAG y los agentes de navegador como
  motor (queda el backend `claude` legacy solo por fichero, sin UI).
- `variant` (p.ej. `xhigh`) viaja como flag/campo; el catálogo
  (`opencode models --verbose`, caché 5 min) expone modificadores por modelo.
- Skills de opencode (`.opencode/skills/*/SKILL.md`) en vez de RAG propio.
- Si opencode desaparece o cambia su CLI, solo se reescribe el adapter
  (interfaz `generate()/health()` + `buildRunArgs()` testeado).

## Alternativas descartadas

- Mantener capa propia multi-proveedor: duplicaba lo que opencode ya hace
  (modelos, auth, skills, sesiones) con más bugs y más mantenimiento.
- Ollama directo por HTTP: pierde skills, sesiones y modelos cloud.
