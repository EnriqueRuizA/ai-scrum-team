---
tags: [indice, mapa]
---

# MOC Arquitectura (Fases 0-4)

Mapa vivo del proyecto tras la reestructuracion. El motor de IA es
[[motor-opencode|opencode]] (modelos gratuitos); el proyecto solo
orquesta y visualiza.

## Núcleo nuevo

- [[orquestador-v2|Orquestador v2]] — `orchestrator/index.js`, clase única y completa
- [[pipeline|Pipeline]] — `orchestrator/pipeline.js`, secuencia por sprint
- [[state|Estado atómico]] — `orchestrator/state.js`, tmp+rename, tope de logs
- [[team-config|Equipo]] — `agents/team-config.js` + `agents/factory.js`

## Motor opencode

- [[motor-opencode|Motor opencode]] — modos `run`/`serve`, modelos gratis
- [[opencode-adapter|Adapter]] — `llm/opencode-adapter.js` + `llm/factory.js`
- [[opencode-agent|Agente por rol]] — `agents/opencode-agent.js`
- [[personas|Personas]] — `agents/personas.js` → `.opencode/agent/*.md`

## Servidor y seguridad

- [[guards|Guards]] — `server/guards.js`, `server/state-store.js`
- [[dashboard|Dashboard]] — `index.html`, topes de logs, XSS, tiempo real
- Seguridad (nota clásica): `docs/SECURITY.md` (threat model, reglas 1-8)
- ADR: `docs/adr/0001-ws-sin-auth-localhost.md` (por qué sin auth en local)

## Config y scripts

- `config/project-config.json` (única fuente) + `config/schema.json`
- `setup.js` (health-check), `scripts/smoke-opencode.js`, `scripts/export-agents.js`
- `START.bat` / `STOP.bat` (arranque y parado en Windows)

## Legacy (pendiente [[fases|FASE 5]])

- [[legacy-src|Código muerto src/]] — `src/` + agentes Playwright/Claude a medida
- Notas antiguas de `src/`: [[orchestrator]], [[local_agent]], [[ollama]], [[editor]], [[validator]], [[ragi]], [[logger]]
- Índice antiguo (sin links a propósito): `ClassGraph.md`

## Proceso

- [[fases|Fases del plan]] — estado 0-4 hechas, 5-7 pendientes
- Informe de auditoría: `docs/INFORME-AUDITORIA-2026-09-30.md` (pendiente FASE 7)
- Plan íntegro: `docs/PLAN-REESTRUCTURACION.txt`
