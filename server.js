// server.js - Express server + WebSocket para el dashboard en tiempo real

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs-extra');

const ScrumMasterOrchestrator = require('./orchestrator');
const { checkHealth, listModels, verifyOllamaModels, authHeadersFromLocalConfig } = require('./lib/local-llm');
const { buildMermaidFromConfig } = require('./lib/flow-mermaid');

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
  const out = { ...current };
  for (const [key, val] of Object.entries(body || {})) {
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

  app.use(express.json());

  // IMPORTANTE: esta ruta debe ir ANTES de express.static('public').
  // Si no, GET / sirve public/index.html (vista compacta) y nunca ves el dashboard de raíz con Settings/pestañas.
  const sendDashboardRoot = (req, res) => {
    const rootDash = path.join(__dirname, 'index.html');
    const publicDash = path.join(__dirname, 'public', 'index.html');
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
  let isRunning = false;
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
    const config = await fs.readJson('./config/project-config.json');
    const credentials = await fs.readJson('./config/credentials.json');
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
    const current = await fs.readJson('./config/credentials.json');
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
    const current = await fs.readJson('./config/project-config.json');
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

  /** Comprueba modelo de chat y, si RAG activo, modelo de embeddings. */
  app.get('/api/ollama/verify', async (req, res) => {
    try {
      const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
      const fromQuery = typeof req.query.baseUrl === 'string' ? req.query.baseUrl.trim() : '';
      const baseUrl = (fromQuery || current.agents?.local?.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      const model = (typeof req.query.model === 'string' && req.query.model.trim()) || current.agents?.local?.model || 'llama3.2';
      const embedModel =
        (typeof req.query.embedModel === 'string' && req.query.embedModel.trim()) ||
        current.agents?.local?.embedModel ||
        current.agents?.local?.rag?.embedModel ||
        'nomic-embed-text';
      const ragEnabled =
        req.query.rag === '1' ||
        req.query.rag === 'true' ||
        current.agents?.local?.rag?.enabled === true;

      const authHeaders = authHeadersFromLocalConfig(current.agents?.local || {});
      const v = await verifyOllamaModels(baseUrl, model, embedModel, { authHeaders });
      if (!v.ok) {
        return res.status(502).json({
          baseUrl,
          model,
          embedModel,
          ragEnabled,
          ok: false,
          error: v.error,
          hint: '¿Está `ollama serve` en marcha y la URL correcta?'
        });
      }
      res.json({
        baseUrl,
        model,
        embedModel,
        ragEnabled,
        ok: true,
        hasChat: v.hasChat,
        hasEmbed: v.hasEmbed,
        modelNames: v.modelNames,
        hintChat: v.hasChat ? null : `Instala el modelo de chat: ollama pull ${model}`,
        hintEmbed:
          ragEnabled && !v.hasEmbed
            ? `RAG activo: necesitas un modelo de embeddings (aparte del de chat). Ejecuta: ollama pull ${embedModel}`
            : null
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Modelos Ollama instalados (para combo en Settings). Query ?baseUrl= opcional. */
  app.get('/api/ollama/models', async (req, res) => {
    try {
      const current = await fs.readJson('./config/project-config.json');
      const fromQuery = typeof req.query.baseUrl === 'string' ? req.query.baseUrl.trim() : '';
      const fromConfig = current.agents?.local?.baseUrl;
      const baseUrl = (fromQuery || fromConfig || 'http://localhost:11434').replace(/\/$/, '');
      const authHeaders = authHeadersFromLocalConfig(current.agents?.local || {});
      const result = await listModels(baseUrl, { authHeaders });
      if (!result.ok) {
        return res.status(502).json({ error: result.error || 'No se pudo contactar con Ollama', baseUrl, models: [] });
      }
      res.json({ baseUrl, models: result.models });
    } catch (e) {
      res.status(500).json({ error: e.message, models: [] });
    }
  });

// Iniciar el proyecto
  app.post('/api/start', async (req, res) => {
  if (isRunning) {
    return res.status(400).json({ error: 'Ya hay un proyecto en ejecución' });
  }

  try {
    const config = await fs.readJson('./config/project-config.json');
    const useLocal = config.agents?.backend === 'local';
    let credentials = {};
    if (!useLocal) {
      credentials = await fs.readJson('./config/credentials.json');
      if (!credentials.claude?.email || !String(credentials.claude.email).trim()) {
        return res.status(400).json({
          error: 'Credenciales de Claude.ai: indica al menos el email. La contraseña es opcional si usas enlace mágico por correo.'
        });
      }
    } else {
      const baseUrl = config.agents?.local?.baseUrl || 'http://localhost:11434';
      const model = config.agents?.local?.model || 'llama3.2';
      const authHeaders = authHeadersFromLocalConfig(config.agents?.local || {});
      const health = await checkHealth(baseUrl, model, { authHeaders });
      if (!health.ok) {
        return res.status(400).json({
          error: `No se puede conectar con Ollama en ${baseUrl}. Inicia Ollama ("ollama serve") y revisa agents.local.baseUrl. Detalle: ${health.error || 'desconocido'}`
        });
      }
      if (health.modelLoaded === false) {
        return res.status(400).json({
          error: `Ollama está activo pero el modelo "${model}" no está disponible. Ejecuta: ollama pull ${model}`
        });
      }

      const ragOn = config.agents?.local?.rag?.enabled === true;
      if (ragOn) {
        const embedModel =
          config.agents?.local?.embedModel ||
          config.agents?.local?.rag?.embedModel ||
          'nomic-embed-text';
        const v = await verifyOllamaModels(baseUrl, model, embedModel, { authHeaders });
        if (!v.ok) {
          return res.status(400).json({
            error: `No se pudo comprobar modelos Ollama: ${v.error}`
          });
        }
        if (!v.hasEmbed) {
          return res.status(400).json({
            error:
              `RAG está activo (agents.local.rag.enabled) pero falta el modelo de embeddings «${embedModel}» en Ollama. ` +
              `No se “importa” el RAG en Ollama: es un segundo modelo que calcula vectores. En una terminal ejecuta:\n` +
              `  ollama pull ${embedModel}\n` +
              `Luego vuelve a iniciar el proyecto. (Puedes desactivar RAG en Settings si no lo necesitas.)`
          });
        }
      }
    }

    isRunning = true;
    broadcast('status', { status: 'starting' });
    res.json({ success: true, message: 'Proyecto iniciado' });

    // Ejecutar en background
    runProject(config, credentials).catch(err => {
      console.error('Error en proyecto:', err);
      broadcast('error', { message: err.message });
      isRunning = false;
    });

  } catch (e) {
    isRunning = false;
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
    const statePath = path.join('./outputs', req.params.id, 'state.json');
    const state = await fs.readJson(statePath);
    res.json(state);
  } catch (e) {
    res.status(404).json({ error: 'Sesión no encontrada' });
  }
  });

  /** Marcar sesión como "última" para F5 / GET /api/state (sin reanudar el LLM). */
  app.post('/api/session/focus', async (req, res) => {
    try {
      const id = (req.body && (req.body.id || req.body.folder)) || '';
      if (typeof id !== 'string' || !id.startsWith('session-') || id.includes('..')) {
        return res.status(400).json({ error: 'id de carpeta inválido (debe ser session-…)' });
      }
      const statePath = path.join('./outputs', id, 'state.json');
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
    const artifactPath = path.join('./outputs', req.params.session, 'artifacts', `${req.params.name}.json`);
    const artifact = await fs.readJson(artifactPath);
    res.json(artifact);
  } catch (e) {
    res.status(404).json({ error: 'Artefacto no encontrado' });
  }
  });

// Descargar app final generada
  app.get('/api/download/:session', async (req, res) => {
  const appDir = path.join('./outputs', req.params.session, 'final-app');
  const exists = await fs.pathExists(appDir);
  if (!exists) return res.status(404).json({ error: 'App final no encontrada' });
  res.json({ path: appDir, message: `App disponible en: ${path.resolve(appDir)}` });
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
    isRunning = false;
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
  }
  }

  function start(port = 3000) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => resolve(server));
    });
  }

  if (!createServer._shutdownRegistered) {
    createServer._shutdownRegistered = true;
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
    process.on('SIGINT', () => {
      saveOnExit().finally(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
      saveOnExit().finally(() => process.exit(0));
    });
  }

  return { app, server, wss, start };
}

if (require.main === module) {
  let runtimeConfig = {};
  try {
    runtimeConfig = require('./config/project-config.json');
  } catch (e) {}
  const PORT = process.env.PORT || runtimeConfig.outputs?.port || 3000;

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
║  3. Click "Start Project"                     ║
╚═══════════════════════════════════════════════╝
  `);

      const config = require('./config/project-config.json');
      if (config.outputs?.autoOpenDashboard) {
        const open = (url) => {
          const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          require('child_process').exec(`${cmd} ${url}`);
        };
        setTimeout(() => open(`http://localhost:${PORT}`), 1000);
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
