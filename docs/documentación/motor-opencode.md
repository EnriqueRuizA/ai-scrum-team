---
tags: [concepto, motor, decision]
---

# motor-opencode

**Decisión (D1/T1)**: opencode es el único motor de IA. El proyecto no implementa
llamadas LLM, RAG propio ni scraping: solo orquesta ([[orquestador-v2]]) y
visualiza. Ver `docs/adr/0001-opencode-motor.md` (pendiente FASE 7).

## Modos (`agents.opencode.mode`)

- **`run` (defecto)** — un `opencode run --format json` por llamada. Sin proceso
  previo; cold-boot por paso (~30 s con `ollama/qwen3.5:9b`). Ideal para empezar.
- **`serve`** — HTTP contra `opencode serve` (`/global/health`, `/session`,
  `/session/:id/message`, abort). Sin cold-boot; `START.bat` lo levanta solo
  si no escucha. Ideal para pipelines largos.
- `acp` — evolución futura, no implementado.

## Modelos gratuitos (`agents.opencode.model`, formato `proveedor/modelo`)

- Local Ollama: `ollama/qwen3.5:9b` (defecto verificado), `ollama/llama3.2` (requiere `ollama pull`), `ollama/gpt-oss:20b`...
- Free de opencode: `opencode/*-free` (ver `opencode models`; pueden pedir login).
- De pago (opcional, solo config en opencode, sin código aquí): cualquier proveedor.

## Detalles Windows (verificados a golpes)

- `opencode` en PATH suele ser un shim `.cmd` que `spawn` sin shell **no** puede
  lanzar → `resolveBinary()` busca el `opencode.exe` real (ver [[opencode-adapter]]).
- `stdin:'ignore'` en headless: sin esto opencode espera input y la llamada
  cuelga hasta el timeout (5 min); con esto falla rápido si pide permisos.
- El modelo trabaja en `outputs/session-XXX` (`dir` por llamada), nunca en la raíz.

## Relaciones

- Implementado en [[opencode-adapter]] + `llm/factory.js`
- Consumido por [[opencode-agent]] (un agente por rol)
- Verificado con `npm run smoke` (`scripts/smoke-opencode.js`) y `node setup.js`
