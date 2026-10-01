// server.js - Express server + WebSocket para el dashboard en tiempo real

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs-extra');

const ScrumMasterOrchestrator = require('./orchestrator');
const { RunLock } = require('./server/state-store');
const { authHeadersFromLocalConfig, rawApiKeyFromLocalConfig } = require('./lib/local-llm');
const {
  hintAfterListModelsFailure,
  misconfiguredCrsrKeyWithOpenAiCompatible
} = require('./lib/llm-auth-hints');
const { listModels, checkHealth, verifyLlmModels } = require('./lib/unified-local-llm');
const { listPresetsForApi, resolveHttpAdapterFromLocal } = require('./lib/llm-provider-presets');
const { buildMermaidFromConfig } = require('./lib/flow-mermaid');

/** Etiqueta del endpoint usado al listar modelos (logs y JSON del dashboard). */
function listModelsEndpointLabel(httpAdapter) {
  if (httpAdapter === 'cursor_cloud') return 'GET /v0/models';
  if (httpAdapter === 'openai_compatible') return 'GET /v1/models';
  return 'GET /api/tags';
}

/** Evita borrar backend Ollama/Claude al guardar solo project/scrum/agents parciales desde el dashboard */
function mergeProjectConfigPatch(current, patch) {
  if (!patch || typeof patch !== 'object') return current;
  const next = { ...current };
  if (patch.project) next.project = { ...(current.project || {}), ...patch.project };
  if (patch.scrum) next.scrum = { ...(current.scrum || {}), ...patch.scrum };
  if (patch.agents) {
    const a = { ...(current.agents || {}), ...patch.agents };
    if (patch.agents.local) {
      a.local = {
        ...(current.agents?.local || {}),
        ...patch.agents.local,
        rag:
          patch.agents.local.rag != null
            ? { ...(current.agents?.local?.rag || {}), ...patch.agents.local.rag }
            : current.agents?.local?.rag
      };
    }
    if (Array.isArray(patch.agents.team)) {
      a.team = patch.agents.team;
    }
    next.agents = a;
  }
  if (patch.pipeline) {
    next.pipeline = { ...(current.pipeline || {}), ...patch.pipeline };
  }
  if (patch.target) {
    next.target = { ...(current.target || {}), ...patch.target };
    if (patch.target.techStack) {
      next.target.techStack = {
        ...(current.target?.techStack || {}),
        ...patch.target.techStack
      };
    }
  }
  if (patch.outputs) next.outputs = { ...(current.outputs || {}), ...patch.outputs };
  return next;
}

/** Última sesión con state.json guardado (F5 o reinicio del servidor sin orquestador en RAM). */
async function loadDashboardStateFromDisk() {
  const pointerPath = path.join('./outputs', '.last-dashboard-session.json');
  if (!(await fs.pathExists(pointerPath))) return null;
  const ptr = await fs.readJson(pointerPath).catch(() => null);
  if (!ptr || typeof ptr !== 'object') return null;
  const folder = ptr.outputFolder || ptr.folder;
  if (
    !folder ||
    typeof folder !== 'string' ||
    folder.includes('..') ||
    path.normalize(folder).includes('..') ||
    !folder.startsWith('session-')
  ) {
    return null;
  }
  const statePath = path.join('./outputs', folder, 'state.json');
  if (!(await fs.pathExists(statePath))) return null;
  const state = await fs.readJson(statePath).catch(() => null);
  if (!state || typeof state !== 'object') return null;
  return {
    ...state,
    _restoredFromDisk: true,
    _activeRun: false,
    _sessionOutputFolder: folder
  };
}

/** Fusiona credenciales por plataforma sin sustituir todo el bloque (conserva password si no se envía) */
function mergeCredentialsPatch(current, body) {
  const { isSafeKey } = require('./server/guards');
  const out = { ...current };
  for (const [key, val] of Object.entries(body || {})) {
    if (!isSafeKey(key)) continue; // anti prototype-pollution (__proto__/constructor/prototype)
    if (val != null && typeof val === 'object' && !Array.isArray(val)) {
      const prev = current[key] && typeof current[key] === 'object' ? current[key] : {};
      const merged = { ...prev, ...val };
      if (Object.prototype.hasOwnProperty.call(val, 'password') && (val.password === '' || val.password === null)) {
        delete merged.password;
      }
      out[key] = merged;
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Para POST /api/ollama/test-auth: mezcla agents.local del disco con el cuerpo (valores del formulario).
 * No sobrescribe apiKey del fichero si el formulario envía vacío (significa “usar la guardada”).
 */
function mergeLocalForOllamaTest(fileLocal, patch) {
  const base = { ...(fileLocal || {}) };
  if (!patch || typeof patch !== 'object') return base;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'apiKey' && (v == null || String(v).trim() === '')) continue;
    if (v === undefined) continue;
    base[k] = v;
  }
  return base;
}

/** No exponer apiKey al navegador; indica si habrá cabecera de autenticación (archivo o env). */
function sanitizeProjectConfigForClient(config) {
  const c = JSON.parse(JSON.stringify(config));
  if (c.agents?.local) {
    const loc = c.agents.local;
    const headers = authHeadersFromLocalConfig(loc);
    delete loc.apiKey;
    loc.hasApiKey = Object.keys(headers).length > 0;
  }
  return c;
}

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // FASE 3: higiene HTTP. CSP desactivada (el dashboard usa scripts inline);
  // resto de cabeceras (nosniff, referrer-policy...) activas.
  const helmet = require('helmet');
  const rateLimit = require('express-rate-limit');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '100kb', strict: true }));

  // POST /api/start es caro (lanza un proyecto): 10/min por IP.
  const startLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones de arranque, espera un minuto.' }
  });
  // Resto de escrituras: 120/min por IP. GET sin limite.
  const writeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones, espera un minuto.' }
  });
  app.use('/api/start', startLimiter);
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PATCH') return writeLimiter(req, res, next);
    next();
  });
  // IMPORTANTE: esta ruta debe ir ANTES de express.static('public').
  // Si no, GET / sirve public/index.html (vista compacta) y nunca ves el dashboard de raíz con Settings/pestañas.
  const sendDashboardRoot = (req, res) => {
    const rootDash = path.join(__dirname, 'index.html');
    const publicDash = path.join(__dirname, 'public', 'dashboard-local.html');
    fs.pathExists(rootDash)
      .then((existsRoot) => {
        if (existsRoot) return res.sendFile(rootDash);
        return fs.pathExists(publicDash).then((existsPub) => {
          if (existsPub) return res.sendFile(publicDash);
          return res.status(404).send('Dashboard no encontrado');
        });
      })
      .catch(() => {
        res.status(500).send('Error cargando el dashboard');
      });
  };

  app.get('/', sendDashboardRoot);

  // Sin esto, /index.html serviría public/index.html desde static (vista distinta al panel completo).
  app.get('/index.html', (req, res) => res.redirect(301, '/'));

  // Vista compacta antigua: explícita (evita confundirla con el panel completo)
  app.get('/simple', (req, res) => {
    const publicDash = path.join(__dirname, 'public', 'index.html');
    res.sendFile(publicDash, (err) => {
      if (err) res.status(404).send('Vista simple no encontrada');
    });
  });

  app.use(
    express.static('public', {
      index: false
    })
  );

  // Estado global
  let orchestrator = null;
  const runLock = new RunLock();
  const connectedClients = new Set();

// WebSocket - broadcast a todos los clientes
  function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  connectedClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
  }

  wss.on('connection', async (ws) => {
  connectedClients.add(ws);
  console.log('Dashboard conectado. Clientes:', connectedClients.size);

  try {
    let statePayload = null;
    if (orchestrator) {
      statePayload = { ...orchestrator.getState(), _activeRun: true };
    } else {
      statePayload = await loadDashboardStateFromDisk();
    }
    if (statePayload) {
      ws.send(
        JSON.stringify({
          type: 'state',
          data: statePayload,
          timestamp: new Date().toISOString()
        })
      );
    }
  } catch (e) {
    console.error('WS estado inicial:', e.message);
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch (e) {}
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
  });

  // === ENDPOINTS API ===

// Obtener configuración actual
  app.get('/api/config', async (req, res) => {
  try {
    const config = await fs.readJson('./config/project-config.json').catch(() => ({}));
    let credentials = {};
    try {
      const credPath = './config/credentials.json';
      if (await fs.pathExists(credPath)) {
        credentials = await fs.readJson(credPath);
      }
    } catch (e) {
      credentials = {};
    }
    // No enviar contraseñas al frontend
    const safeCredentials = {};
    for (const [key, val] of Object.entries(credentials)) {
      if (key === 'claude') {
        // Claude.ai admite solo email + enlace mágico (sin contraseña).
        safeCredentials[key] = {
          email: val.email,
          hasPassword: !!(val.password && String(val.password).trim()),
          configured: !!(val.email && String(val.email).trim())
        };
      } else {
        safeCredentials[key] = { email: val.email, configured: !!val.password };
      }
    }
    res.json({ config: sanitizeProjectConfigForClient(config), credentials: safeCredentials });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  });

// Actualizar credenciales
  app.post('/api/credentials', async (req, res) => {
  try {
    await fs.ensureDir('./config');
    let current = {};
    const credPath = './config/credentials.json';
    if (await fs.pathExists(credPath)) {
      current = await fs.readJson(credPath).catch(() => ({}));
    }
    const updated = mergeCredentialsPatch(current, req.body);
    await fs.writeJson('./config/credentials.json', updated, { spaces: 2 });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  });

// Actualizar configuración del proyecto
  app.post('/api/config', async (req, res) => {
  try {
    await fs.ensureDir('./config');
    const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
    const updated = mergeProjectConfigPatch(current, req.body);
    await fs.writeJson('./config/project-config.json', updated, { spaces: 2 });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  });

  /** Diagrama Mermaid del flujo (según agents.team y scrum.maxSprints). */
  app.get('/api/flow/diagram', async (req, res) => {
    try {
      const config = await fs.readJson('./config/project-config.json');
      res.json({ mermaid: buildMermaidFromConfig(config) });
    } catch (e) {
      res.status(500).json({ error: e.message, mermaid: 'flowchart TD\n  ERR[Error cargando config]' });
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

// Iniciar el proyecto
  app.post('/api/start', async (req, res) => {
  if (!runLock.tryAcquire({ endpoint: '/api/start' })) {
    return res.status(409).json({ error: 'Ya hay un proyecto en ejecución', run: runLock.getInfo() });
  }

  try {
    const config = await fs.readJson('./config/project-config.json');
    const useLocal = config.agents?.backend === 'local';
    let credentials = {};
    if (!useLocal) {
      credentials = await fs.readJson('./config/credentials.json').catch(() => ({}));
      if (!credentials.claude?.email || !String(credentials.claude.email).trim()) {
        return res.status(400).json({
          error: 'Credenciales de Claude.ai: indica al menos el email. La contraseña es opcional si usas enlace mágico por correo.'
        });
      }
    } else if (config.agents?.opencode) {
      // FASE 2: el motor es opencode (modelos gratuitos). Un solo health-check.
      const { createAdapter } = require('./llm/factory');
      const ocHealth = await createAdapter(config).health();
      if (!ocHealth.ok) {
        return res.status(400).json({
          error: `Motor opencode no disponible (${ocHealth.mode}): ${ocHealth.error}. ${ocHealth.hint || ''}`
        });
      }
    } else {
      const localCfg = config.agents?.local || {};
      const baseUrl = localCfg.baseUrl || 'http://localhost:11434';
      const model = localCfg.model || 'llama3.2';
      const httpAdapter = resolveHttpAdapterFromLocal(localCfg);
      if (httpAdapter === 'cursor_cloud') {
        return res.status(400).json({
          error:
            'La API oficial de Cursor (api.cursor.com) usa Basic Auth y expone GET /v0/models para Cloud Agents; ' +
            'no ofrece /v1/chat/completions para este orquestador. Para «Iniciar proyecto» elige Ollama, un proveedor OpenAI-compatible (p. ej. OpenAI con sk-…) o backend Claude (navegador). ' +
            'Puedes usar la plantilla «Cursor Cloud API» solo para probar la clave y listar modelos en Settings.'
        });
      }
      const authHeaders = authHeadersFromLocalConfig(localCfg);
      const health = await checkHealth(baseUrl, model, { authHeaders, local: localCfg });
      if (!health.ok) {
        const detail = health.error || 'desconocido';
        let errorMsg;
        if (httpAdapter === 'openai_compatible') {
          errorMsg = `No se puede conectar con la API en ${baseUrl}. Revisa URL (…/v1), red y API key. Detalle: ${detail}`;
        } else {
          errorMsg = `No se puede conectar con Ollama en ${baseUrl}. Inicia Ollama ("ollama serve") y revisa agents.local.baseUrl. Detalle: ${detail}`;
        }
        return res.status(400).json({ error: errorMsg });
      }
      if (health.modelLoaded === false) {
        let errorMsg;
        if (httpAdapter === 'openai_compatible') {
          errorMsg = `La API respondió pero no aparece el modelo de chat «${model}» en el listado. Revisa el id en la documentación del proveedor.`;
        } else {
          errorMsg = `Ollama está activo pero el modelo "${model}" no está disponible. Ejecuta: ollama pull ${model}`;
        }
        return res.status(400).json({ error: errorMsg });
      }

      const ragOn = localCfg.rag?.enabled === true;
      if (ragOn) {
        const embedModel =
          localCfg.embedModel || localCfg.rag?.embedModel || 'nomic-embed-text';
        const v = await verifyLlmModels(baseUrl, model, embedModel, { authHeaders, local: localCfg });
        if (!v.ok) {
          return res.status(400).json({
            error: `No se pudo comprobar modelos: ${v.error}`
          });
        }
        if (!v.hasEmbed) {
          return res.status(400).json({
            error:
              httpAdapter === 'openai_compatible'
                ? `RAG activo pero el proveedor no lista el modelo de embeddings «${embedModel}». Cambia embedModel en Settings o desactiva RAG.`
                : `RAG está activo (agents.local.rag.enabled) pero falta el modelo de embeddings «${embedModel}» en Ollama. ` +
                  `No se “importa” el RAG en Ollama: es un segundo modelo que calcula vectores. En una terminal ejecuta:\n` +
                  `  ollama pull ${embedModel}\n` +
                  `Luego vuelve a iniciar el proyecto. (Puedes desactivar RAG en Settings si no lo necesitas.)`
          });
        }
      }
    }

    broadcast('status', { status: 'starting' });
    res.json({ success: true, message: 'Proyecto iniciado' });

    // Ejecutar en background
    runProject(config, credentials).catch(err => {
      console.error('Error en proyecto:', err);
      broadcast('error', { message: err.message });
    });

  } catch (e) {
    runLock.release();
    res.status(500).json({ error: e.message });
  }
  });

// Control de ejecución (pausa entre pasos / parada al terminar sprint o hito de discovery)
  app.post('/api/run/pause', (req, res) => {
    if (!orchestrator) return res.status(400).json({ error: 'No hay proyecto en ejecución' });
    orchestrator.setPaused(true);
    broadcast('run_control', { paused: true });
    res.json({ success: true, paused: true });
  });

  app.post('/api/run/resume', (req, res) => {
    if (!orchestrator) return res.status(400).json({ error: 'No hay proyecto en ejecución' });
    orchestrator.setPaused(false);
    broadcast('run_control', { paused: false });
    res.json({ success: true, paused: false });
  });

  app.post('/api/run/stop-after-step', (req, res) => {
    if (!orchestrator) return res.status(400).json({ error: 'No hay proyecto en ejecución' });
    orchestrator.requestStopAfterCurrentStep();
    broadcast('run_control', { stopPending: true });
    res.json({ success: true, stopPending: true });
  });

  /** Compatibilidad: antiguo POST /api/pause → pausar */
  app.post('/api/pause', (req, res) => {
    if (!orchestrator) return res.status(400).json({ error: 'No hay proyecto activo' });
    orchestrator.setPaused(true);
    broadcast('run_control', { paused: true });
    res.json({ success: true, paused: true });
  });

// Estado del dashboard: orquestador en vivo o última sesión en disco (outputs/…/state.json)
  app.get('/api/state', async (req, res) => {
  try {
    if (orchestrator) {
      return res.json({ ...orchestrator.getState(), _activeRun: true });
    }
    const restored = await loadDashboardStateFromDisk();
    if (restored) {
      return res.json(restored);
    }
    return res.json({
      status: 'idle',
      sessionId: null,
      currentSprint: 0,
      maxSprints: 5,
      sprints: [],
      runPaused: false,
      artifacts: {
        prd: null,
        architecture: null,
        testPlan: null,
        sprintPlan: null,
        implementations: [],
        qaReports: [],
        finalCode: null
      },
      logs: [],
      errors: [],
      _restoredFromDisk: false,
      _activeRun: false
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  });

// Listar sesiones guardadas
  app.get('/api/sessions', async (req, res) => {
  try {
    const outputsDir = './outputs';
    await fs.ensureDir(outputsDir);
    const sessions = await fs.readdir(outputsDir);
    const sessionData = await Promise.all(
      sessions.filter((s) => s.startsWith('session-')).map(async (s) => {
        try {
          const statePath = path.join(outputsDir, s, 'state.json');
          const st = await fs.stat(statePath).catch(() => null);
          const state = await fs.readJson(statePath);
          return {
            id: s,
            mtimeMs: st ? st.mtimeMs : 0,
            ...state
          };
        } catch (e) {
          return { id: s, error: 'No state file', mtimeMs: 0 };
        }
      })
    );
    sessionData.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
    res.json(sessionData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  });

// Cargar sesión anterior
  app.get('/api/sessions/:id', async (req, res) => {
  try {
    const { validateSessionId, safeJoin } = require('./server/guards');
    if (!validateSessionId(req.params.id)) {
      return res.status(400).json({ error: 'id de sesión inválido' });
    }
    const statePath = safeJoin('./outputs', req.params.id, 'state.json');
    const state = await fs.readJson(statePath);
    res.json(state);
  } catch (e) {
    res.status(404).json({ error: 'Sesión no encontrada' });
  }
  });

  /** Marcar sesión como "última" para F5 / GET /api/state (sin reanudar el LLM). */
  app.post('/api/session/focus', async (req, res) => {
    try {
      const { validateSessionId, safeJoin } = require('./server/guards');
      const id = (req.body && (req.body.id || req.body.folder)) || '';
      if (!validateSessionId(id)) {
        return res.status(400).json({ error: 'id de carpeta inválido (debe ser session-…)' });
      }
      const statePath = safeJoin('./outputs', id, 'state.json');
      if (!(await fs.pathExists(statePath))) {
        return res.status(404).json({ error: 'No existe state.json en esa sesión' });
      }
      const state = await fs.readJson(statePath);
      await fs.writeJson(
        path.join('./outputs', '.last-dashboard-session.json'),
        {
          outputFolder: id,
          sessionId: state.sessionId,
          updatedAt: new Date().toISOString(),
          manualPick: true
        },
        { spaces: 2 }
      );
      res.json({ success: true, id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

// Obtener artefacto específico
  app.get('/api/artifact/:session/:name', async (req, res) => {
  try {
    const { validateSessionId, validateArtifactName, safeJoin } = require('./server/guards');
    if (!validateSessionId(req.params.session) || !validateArtifactName(req.params.name)) {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }
    const artifactPath = safeJoin('./outputs', req.params.session, 'artifacts', `${req.params.name}.json`);
    const artifact = await fs.readJson(artifactPath);
    res.json(artifact);
  } catch (e) {
    res.status(404).json({ error: 'Artefacto no encontrado' });
  }
  });

// Descargar app final generada
  app.get('/api/download/:session', async (req, res) => {
  const { validateSessionId, safeJoin } = require('./server/guards');
  if (!validateSessionId(req.params.session)) {
    return res.status(400).json({ error: 'id de sesión inválido' });
  }
  const appDir = safeJoin('./outputs', req.params.session, 'final-app');
  const exists = await fs.pathExists(appDir);
  if (!exists) return res.status(404).json({ error: 'App final no encontrada' });
  // No se expone la ruta absoluta (evita enumeracion del FS del servidor).
  res.json({ session: req.params.session, message: 'App generada disponible en el directorio de la sesión.' });
  });

  /**
   * Endpoint para actualizar el orden de los agentes.
   * PATCH /api/config/order con body: { "agentsOrder": ["agentA", "agentB", ...] }
   */
  app.patch('/api/config/order', async (req, res) => {
  try {
    const { normalizeTeam, VALID_ROLES } = require('./agents/team-config');
    const { validateProjectConfig } = require('./utils/config-validator');
    const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
    const { agentsOrder } = req.body;

    if (!Array.isArray(agentsOrder)) {
      return res.status(400).json({ error: 'agentsOrder debe ser una array' });
    }
    const unknown = agentsOrder.filter((r) => !VALID_ROLES.includes(r));
    if (unknown.length > 0) {
      return res.status(400).json({ error: `Roles desconocidos: ${unknown.join(', ')}` });
    }

    // FASE 2: el orden vive en agents.team (una sola fuente). Se reordena el
    // array poniendo primero los roles pedidos; el resto mantiene su orden.
    const team = normalizeTeam(current);
    const rank = new Map(agentsOrder.map((r, i) => [r, i]));
    team.sort((a, b) => {
      const ra = rank.has(a.role) ? rank.get(a.role) : VALID_ROLES.length;
      const rb = rank.has(b.role) ? rank.get(b.role) : VALID_ROLES.length;
      return ra - rb;
    });

    const updated = {
      ...current,
      agents: {
        ...current.agents,
        team
      }
    };
    const v = validateProjectConfig(updated);
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });

    await fs.writeJson('./config/project-config.json', updated, { spaces: 2 });

    res.json({ success: true, agentsOrder });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  });

  /**
   * Endpoint para obtener la lista de modelos soportados.
   * GET /api/config/models
   */
  app.get('/api/config/models', async (req, res) => {
  try {
    const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
    const localCfg = current.agents?.local || {};
    const baseUrl = (localCfg.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    const authHeaders = authHeadersFromLocalConfig(localCfg);
    
    const result = await listModels(baseUrl, { authHeaders, local: localCfg });
    
    if (!result.ok) {
      return res.status(502).json({
        error: result.error,
        models: [],
        available: []
      });
    }
    
    const models = result.models || [];
    res.json({
      baseUrl,
      models,
      available: models,
      defaultModel: current.agents?.defaultModel || 'gpt-4o-mini'
    });
  } catch (e) {
    res.status(500).json({ error: e.message, models: [], available: [] });
  }
  });

  /**
   * Endpoint para configurar el modelo de un agente específico.
   * PATCH /api/config/agents/{id}/model con body: { "model": "gpt-4o" }
   */
  app.patch('/api/config/agents/:id/model', async (req, res) => {
  try {
    const { normalizeTeam } = require('./agents/team-config');
    const { validateProjectConfig } = require('./utils/config-validator');
    const agentId = decodeURIComponent(req.params.id);
    const { model } = req.body;

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'model debe ser una cadena válida' });
    }

    // FASE 2: el modelo por miembro vive en agents.team[].model
    // (formato proveedor/modelo de opencode, p.ej. ollama/llama3.2).
    const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
    const team = normalizeTeam(current);
    const member = team.find((t) => t.id === agentId || t.role === agentId);
    if (!member) {
      return res.status(404).json({ error: `Agente «${agentId}» no encontrado` });
    }
    member.model = model.trim();

    const updated = { ...current, agents: { ...current.agents, team } };
    const v = validateProjectConfig(updated);
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });

    await fs.writeJson('./config/project-config.json', updated, { spaces: 2 });

    res.json({ success: true, agentId, model: member.model });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
  });

// === LÓGICA DE EJECUCIÓN ===

  async function runProject(config, credentials) {
  orchestrator = new ScrumMasterOrchestrator(config, credentials);
  
  // Conectar todos los eventos al WebSocket
  const events = [
    'log',
    'status',
    'phase',
    'sprint_start',
    'sprint_update',
    'agent_working',
    'agent_ready',
    'agent_initializing',
    'agent_sending',
    'agent_response',
    'artifact_created',
    'action_required',
    'delivery',
    'error',
    'run_control',
    'run_pause_waiting'
  ];
  
  events.forEach(event => {
    orchestrator.on(event, (data) => {
      broadcast(event, data);
    });
  });

  try {
    await orchestrator.initialize();
    await orchestrator.runFullProject();
    broadcast('completed', {
      sessionId: orchestrator.state.sessionId,
      outputDir: path.resolve(orchestrator.outputDir),
      sessionFolder: path.basename(orchestrator.outputDir)
    });
  } catch (error) {
    broadcast('error', { message: error.message });
    throw error;
  } finally {
    runLock.release();
    if (orchestrator) {
      try {
        await orchestrator.saveState();
      } catch (e) {
        console.error('[run] saveState en finally:', e.message);
      }
    }
    if (orchestrator) {
      try {
        await orchestrator.cleanup();
      } catch (e) {
        console.error('[run] cleanup:', e.message);
      }
    }
    orchestrator = null;
  }
  }

  function start(port = 3000, host = process.env.AI_SCRUM_BIND || '127.0.0.1') {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server));
    });
  }

  // Handlers de cierre: uno por instancia (Set), sin flag estatico, para que
  // los tests con varios createServer() no crucen estado entre si.
  const saveOnExit = async () => {
    if (orchestrator) {
      try {
        await orchestrator.saveState();
        console.log('[ai-scrum] Estado guardado en disco (cierre del servidor).');
      } catch (e) {
        console.error('[ai-scrum] No se pudo guardar el estado:', e.message);
      }
    }
  };
  shutdownRegistry.add(saveOnExit);

  return { app, server, wss, start };
}

// Registro de guardados al cerrar: una sola suscripcion a SIGINT/SIGTERM por
// proceso que recorre las instancias vivas (evita el leak del flag estatico).
const shutdownRegistry = new Set();
if (!shutdownRegistry._hooked) {
  shutdownRegistry._hooked = true;
  const saveAllAndExit = (signal) => {
    const pending = [...shutdownRegistry].map((fn) => {
      try {
        return fn();
      } catch (e) {
        console.error(`[ai-scrum] saveOnExit (${signal}):`, e.message);
        return Promise.resolve();
      }
    });
    Promise.all(pending).finally(() => process.exit(0));
  };
  process.on('SIGINT', () => saveAllAndExit('SIGINT'));
  process.on('SIGTERM', () => saveAllAndExit('SIGTERM'));
}

if (require.main === module) {
  let runtimeConfig = {};
  try {
    runtimeConfig = require('./config/project-config.json');
  } catch (e) {}
  // FASE 3: puerto validado como entero (evita inyeccion en el auto-open).
  const rawPort = process.env.PORT || runtimeConfig.outputs?.port || 3000;
  const PORT = Number.parseInt(String(rawPort), 10);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`[ERROR] Puerto invalido: ${String(rawPort).slice(0, 50)}`);
    process.exit(1);
  }

  const { start } = createServer();
  start(PORT)
    .then(() => {
      console.log(`
╔═══════════════════════════════════════════════╗
║         AI SCRUM TEAM ORCHESTRATOR            ║
║                                               ║
║  Dashboard: http://localhost:${PORT}              ║
║                                               ║
║  1. Configura credenciales en Settings        ║
║  2. Ajusta el proyecto si necesitas           ║
║  3. Pulsa «Iniciar proyecto» en el dashboard  ║
╚═══════════════════════════════════════════════╝
  `);

      const config = require('./config/project-config.json');
      if (config.outputs?.autoOpenDashboard) {
        const url = `http://localhost:${PORT}`;
        const open = () => {
          const { exec } = require('child_process');
          if (process.platform === 'win32') {
            exec(`start "" "${url}"`, { windowsHide: true }, () => {});
          } else if (process.platform === 'darwin') {
            exec(`open "${url}"`, () => {});
          } else {
            exec(`xdg-open "${url}"`, () => {});
          }
        };
        setTimeout(open, 1000);
      }
    })
    .catch((err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`\n[ERROR] El puerto ${PORT} ya está en uso.`);
        console.error(`[SOLUCIÓN] Cierra el otro proceso (otro 'node server.js') o cambia "outputs.port" en config/project-config.json.\n`);
        process.exit(1);
      }
      console.error(err);
      process.exit(1);
    });
}

module.exports = { createServer };
