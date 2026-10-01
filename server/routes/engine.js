// server/routes/engine.js - FASE 5: rutas (extraido de server.js, sin cambios de comportamiento).
const fs = require('fs-extra');
const { authHeadersFromLocalConfig, rawApiKeyFromLocalConfig } = require('../../lib/local-llm');
const { hintAfterListModelsFailure, misconfiguredCrsrKeyWithOpenAiCompatible } = require('../../lib/llm-auth-hints');
const { listModels } = require('../../lib/unified-local-llm');
const { listPresetsForApi, resolveHttpAdapterFromLocal } = require('../../lib/llm-provider-presets');
const { verifyLlmModels } = require('../../lib/unified-local-llm');
const { mergeLocalForOllamaTest, listModelsEndpointLabel } = require('../helpers');
function registerEngine(app, _ctx) {
  /** Catalogo de modelos de opencode (`opencode models`: locales + cloud).
   * ?verbose=1 anade `variants[]` por modelo (con cache de 5 min). */
  app.get('/api/engine/opencode-models', async (req, res) => {
    try {
      const detailed = req.query.verbose === '1' || req.query.verbose === 'true';
      if (detailed) {
        const { listCatalog } = require('../../llm/opencode-models');
        const models = await listCatalog();
        return res.json({
          models: models.map((m) => ({
            id: m.id,
            label: `${m.id} (${m.provider === 'ollama' ? 'Ollama local' : m.provider === 'opencode' ? 'opencode cloud' : m.provider})`,
            variants: m.variants
          }))
        });
      }
      const { OpencodeAdapter } = require('../../llm/opencode-adapter');
      const { spawnSafe } = require('../../utils/exec-safe');
      const adapter = new OpencodeAdapter({ mode: 'run' });
      let bin;
      try {
        bin = await adapter.resolveBinary();
      } catch (e) {
        return res.json({ models: [], hint: 'opencode no instalado.' });
      }
      const r = await spawnSafe(bin, ['models'], { timeoutMs: 30000, stdin: 'ignore' });
      if (r.code !== 0) return res.json({ models: [], hint: (r.stderr || '').trim().slice(0, 200) });
      const models = r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && l.includes('/') && !l.startsWith('#'))
        .map((id) => {
          const provider = id.split('/')[0];
          const kind = provider === 'ollama' ? 'Ollama local' : provider === 'opencode' ? 'opencode cloud' : provider;
          return { id, label: `${id} (${kind})`, variants: [] };
        });
      res.json({ models });
    } catch (e) {
      res.json({ models: [], hint: e.message });
    }
  });

  /** Modelos instalados en Ollama local (`ollama list`) para importar al registro. */
  app.get('/api/engine/ollama-models', async (req, res) => {
    try {
      const { spawnSafe } = require('../../utils/exec-safe');
      const r = await spawnSafe('ollama', ['list'], { timeoutMs: 20000, stdin: 'ignore' });
      if (r.code !== 0) {
        return res.json({
          models: [],
          hint: 'Ollama no responde. ¿Esta `ollama serve` en marcha?'
        });
      }
      const models = r.stdout
        .split('\n')
        .slice(1)
        .map((l) => (l.trim().split(/\s+/)[0] || '').trim())
        .filter((n) => n && n !== 'NAME')
        .map((name) => ({ id: `ollama/${name}`, label: `${name} (Ollama local)` }));
      res.json({ models });
    } catch (e) {
      res.json({ models: [], hint: `No se pudo ejecutar ollama list: ${e.message}` });
    }
  });

  /** Skills descubiertas en el workspace (para el desplegable de roles). */
  app.get('/api/skills', async (req, res) => {
    try {
      const { discoverSkills } = require('../../utils/skills');
      res.json({ skills: await discoverSkills(process.cwd()) });
    } catch (e) {
      res.status(500).json({ error: e.message, skills: [] });
    }
  });

  /** Estado del motor opencode (UX: pill + preflight del dashboard). Sin secretos. */
  app.get('/api/engine/health', async (req, res) => {
    try {
      const config = await fs.readJson('./config/project-config.json').catch(() => ({}));
      const oc = (config.agents && config.agents.opencode) || {};
      const { createAdapter } = require('../../llm/factory');
      const h = await createAdapter(config).health();
      res.json({
        ok: h.ok === true,
        mode: oc.mode || 'serve',
        model: oc.model || 'ollama/llama3.2',
        variant: oc.variant || '',
        url: oc.url || 'http://127.0.0.1:4096',
        version: h.version || null,
        error: h.error || null,
        hint: h.hint || null
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /** Plantillas de proveedor (OpenAI, DeepSeek, Ollama…) para el dashboard. */
  app.get('/api/llm/provider-presets', (req, res) => {
    try {
      res.json({ presets: listPresetsForApi() });
    } catch (e) {
      res.status(500).json({ error: e.message, presets: [] });
    }
  });

  /** Comprueba modelo de chat y, si RAG activo, modelo de embeddings. */
  app.get('/api/ollama/verify', async (req, res) => {
    try {
      const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
      const localCfg = current.agents?.local || {};
      const fromQuery = typeof req.query.baseUrl === 'string' ? req.query.baseUrl.trim() : '';
      const baseUrl = (fromQuery || localCfg.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      const model = (typeof req.query.model === 'string' && req.query.model.trim()) || localCfg.model || 'llama3.2';
      const embedModel =
        (typeof req.query.embedModel === 'string' && req.query.embedModel.trim()) ||
        localCfg.embedModel ||
        localCfg.rag?.embedModel ||
        'nomic-embed-text';
      const ragEnabled =
        req.query.rag === '1' ||
        req.query.rag === 'true' ||
        localCfg.rag?.enabled === true;

      const httpAdapter = resolveHttpAdapterFromLocal(localCfg);
      const authHeaders = authHeadersFromLocalConfig(localCfg);
      const v = await verifyLlmModels(baseUrl, model, embedModel, { authHeaders, local: localCfg });
      if (!v.ok) {
        return res.status(502).json({
          baseUrl,
          model,
          embedModel,
          ragEnabled,
          httpAdapter,
          ok: false,
          error: v.error,
          hint:
            httpAdapter === 'openai_compatible'
              ? '¿URL base correcta (…/v1), API key y acceso a red?'
              : '¿Está `ollama serve` en marcha y la URL correcta?'
        });
      }
      res.json({
        baseUrl,
        model,
        embedModel,
        ragEnabled,
        httpAdapter,
        ok: true,
        hasChat: v.hasChat,
        hasEmbed: v.hasEmbed,
        modelNames: v.modelNames,
        hintChat: v.hasChat
          ? null
          : httpAdapter === 'openai_compatible'
            ? `El proveedor no lista el modelo de chat «${model}». Revisa el id exacto en su documentación.`
            : `Instala el modelo de chat: ollama pull ${model}`,
        hintEmbed:
          ragEnabled && !v.hasEmbed
            ? httpAdapter === 'openai_compatible'
              ? `RAG: no aparece el modelo de embeddings «${embedModel}» en la lista del proveedor.`
              : `RAG activo: necesitas un modelo de embeddings (aparte del de chat). Ejecuta: ollama pull ${embedModel}`
            : null
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Prueba conexión y API key (Ollama /api/tags, OpenAI /v1/models, Cursor Cloud /v0/models).
   * Body opcional: { local: { ... } } mezclado con project-config (apiKey vacío = no cambia la guardada).
   */
  app.post('/api/ollama/test-auth', async (req, res) => {
    try {
      const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
      const fileLocal = current.agents?.local || {};
      const patch = req.body?.local && typeof req.body.local === 'object' ? req.body.local : {};
      const local = mergeLocalForOllamaTest(fileLocal, patch);

      let baseUrl =
        typeof req.body?.baseUrl === 'string' && req.body.baseUrl.trim()
          ? req.body.baseUrl.trim()
          : (local.baseUrl || 'http://localhost:11434').trim();
      baseUrl = baseUrl.replace(/\/$/, '');

      const httpAdapter = resolveHttpAdapterFromLocal(local);
      const crsrMix = misconfiguredCrsrKeyWithOpenAiCompatible(local);
      if (crsrMix) {
        const ah = authHeadersFromLocalConfig(local);
        const names = Object.keys(ah);
        return res.status(400).json({
          ok: false,
          baseUrl,
          httpAdapter,
          listEndpoint: listModelsEndpointLabel(httpAdapter),
          authConfigured: names.length > 0,
          authHeaderNames: names,
          models: [],
          error: crsrMix.error,
          hint: crsrMix.hint
        });
      }

      const authHeaders = authHeadersFromLocalConfig(local);
      const authHeaderNames = Object.keys(authHeaders);
      const result = await listModels(baseUrl, { authHeaders, local });

      const listEndpoint = listModelsEndpointLabel(httpAdapter);

      if (!result.ok) {
        const rawKey = rawApiKeyFromLocalConfig(local);
        const cursorOpenAiHint = hintAfterListModelsFailure(
          result.error,
          baseUrl,
          rawKey,
          httpAdapter
        );
        const defaultHint =
          authHeaderNames.length === 0 &&
          (httpAdapter === 'openai_compatible' || httpAdapter === 'cursor_cloud')
            ? 'Las APIs cloud suelen exigir API key: rellena el campo o apiKeyEnv / OPENAI_API_KEY / CURSOR_API_KEY.'
            : authHeaderNames.length === 0
              ? 'No se envió API key: rellena el campo, define apiKeyEnv o variables AI_SCRUM_LOCAL_API_KEY / OLLAMA_API_KEY.'
              : 'Revisa URL base, la clave y el modo (Bearer, Basic para Cursor API, X-API-Key o personalizada).';
        return res.status(502).json({
          ok: false,
          baseUrl,
          httpAdapter,
          listEndpoint: listModelsEndpointLabel(httpAdapter),
          authConfigured: authHeaderNames.length > 0,
          authHeaderNames,
          models: [],
          error: result.error,
          hint: cursorOpenAiHint || defaultHint
        });
      }

      const models = result.models || [];
      res.json({
        ok: true,
        baseUrl,
        httpAdapter,
        authConfigured: authHeaderNames.length > 0,
        authHeaderNames,
        modelCount: models.length,
        models,
        modelsPreview: models.slice(0, 30),
        message: `Conexión OK: ${listEndpoint} respondió (${models.length} modelo(s)).`
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /** Modelos instalados (Ollama /api/tags, OpenAI /v1/models, Cursor /v0/models). Query ?baseUrl= opcional. */
  app.get('/api/ollama/models', async (req, res) => {
    try {
      const current = await fs.readJson('./config/project-config.json');
      const localCfg = current.agents?.local || {};
      const fromQuery = typeof req.query.baseUrl === 'string' ? req.query.baseUrl.trim() : '';
      const fromConfig = localCfg.baseUrl;
      const baseUrl = (fromQuery || fromConfig || 'http://localhost:11434').replace(/\/$/, '');
      const httpAdapter = resolveHttpAdapterFromLocal(localCfg);
      const crsrMix = misconfiguredCrsrKeyWithOpenAiCompatible(localCfg);
      if (crsrMix) {
        const ah = authHeadersFromLocalConfig(localCfg);
        const names = Object.keys(ah);
        return res.status(400).json({
          error: crsrMix.error,
          baseUrl,
          httpAdapter,
          listEndpoint: listModelsEndpointLabel(httpAdapter),
          authConfigured: names.length > 0,
          models: [],
          hint: crsrMix.hint
        });
      }
      const authHeaders = authHeadersFromLocalConfig(localCfg);
      const authHeaderNames = Object.keys(authHeaders);
      const result = await listModels(baseUrl, { authHeaders, local: localCfg });
      if (!result.ok) {
        const rawKey = rawApiKeyFromLocalConfig(localCfg);
        const cursorOpenAiHint = hintAfterListModelsFailure(
          result.error,
          baseUrl,
          rawKey,
          httpAdapter
        );
        const defaultHint =
          authHeaderNames.length === 0 &&
          (httpAdapter === 'openai_compatible' || httpAdapter === 'cursor_cloud')
            ? 'Las APIs cloud exigen API key: guárdala en Settings, define apiKeyEnv o OPENAI_API_KEY / CURSOR_API_KEY en el entorno donde corre el servidor.'
            : authHeaderNames.length === 0
              ? 'No se envió API key: rellena el campo en Settings, apiKeyEnv o AI_SCRUM_LOCAL_API_KEY / OLLAMA_API_KEY.'
              : null;
        const hint = cursorOpenAiHint || defaultHint;
        return res.status(502).json({
          error: result.error || 'No se pudo listar modelos',
          baseUrl,
          httpAdapter,
          listEndpoint: listModelsEndpointLabel(httpAdapter),
          authConfigured: authHeaderNames.length > 0,
          models: [],
          ...(hint ? { hint } : {})
        });
      }
      res.json({ baseUrl, httpAdapter, models: result.models });
    } catch (e) {
      res.status(500).json({ error: e.message, models: [] });
    }
  });

}

module.exports = registerEngine;
