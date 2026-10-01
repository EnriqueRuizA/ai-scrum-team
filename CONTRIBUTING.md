# Contribuir a ai-scrum-team

## Reglas basicas

1. **Nunca commitear secretos**: ni `credentials.json`, ni API keys, ni
   `*.log`, ni temporales. El CI y `npm run check:secrets` lo verifican.
2. **Cada fase del plan = commits `phase-N: ...`** pequenos y reversibles.
3. **No hacer push ni crear PRs sin pedirlo explicitamente.**
4. Antes de cada commit: `npm test` (cuando este verde) y
   `npm run check:secrets`.

## Flujo de trabajo

- Rama principal: `main` (via `origin/main`).
- Commits en espanol o ingles, concisos, estilo repo existente.
- Tag `pre-phase-0` = punto de rollback de la FASE 0.

## Configuracion local (no commitear)

- Auth de proveedores LLM: en opencode (`~/.local/share/opencode/auth.json`)
  o variables de entorno. Nunca en `config/`.
- Puertos/bind: `PORT`, `AI_SCRUM_BIND` (defecto `127.0.0.1`).
