// server/app.js - FASE 5: ensamblaje del servidor (extraido de server.js).
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const ScrumMasterOrchestrator = require('../orchestrator');
const { RunLock } = require('./state-store');
const { attachWs } = require('./ws');
const registerStatic = require('./routes/static');
const registerConfig = require('./routes/config');
const registerSessions = require('./routes/sessions');
const registerEngine = require('./routes/engine');
const registerRun = require('./routes/run');

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
  const state = { orchestrator: null };
  const runLock = new RunLock();
  const { broadcast } = attachWs(wss, state);

  async function runProject(config, credentials) {
  state.orchestrator = new ScrumMasterOrchestrator(config, credentials);
  wireOrchestratorEvents(state.orchestrator);

  try {
    await state.orchestrator.initialize();
    await state.orchestrator.runFullProject();
    broadcast('completed', {
      sessionId: state.orchestrator.state.sessionId,
      outputDir: path.resolve(state.orchestrator.outputDir),
      sessionFolder: path.basename(state.orchestrator.outputDir)
    });
  } catch (error) {
    broadcast('error', { message: error.message });
    throw error;
  } finally {
    runLock.release();
    if (state.orchestrator) {
      try {
        await state.orchestrator.saveState();
      } catch (e) {
        console.error('[run] saveState en finally:', e.message);
      }
    }
    if (state.orchestrator) {
      try {
        await state.orchestrator.cleanup();
      } catch (e) {
        console.error('[run] cleanup:', e.message);
      }
    }
    state.orchestrator = null;
  }
  }

  /**
   * Reanuda una sesion guardada como proyecto activo: conserva logs,
   * artefactos y sprints hechos; ejecuta desde el siguiente sprint.
   * Misma gestion de eventos/lock/limpieza que runProject.
   */
  async function resumeProject({ savedState, outputDir, config, credentials }) {
    state.orchestrator = ScrumMasterOrchestrator.resume({ savedState, outputDir, config, credentials });
    wireOrchestratorEvents(state.orchestrator);

    try {
      await state.orchestrator.initialize();
      await state.orchestrator.runFullProject();
      broadcast('completed', {
        sessionId: state.orchestrator.state.sessionId,
        outputDir: path.resolve(state.orchestrator.outputDir),
        sessionFolder: path.basename(state.orchestrator.outputDir)
      });
    } catch (error) {
      broadcast('error', { message: error.message });
      throw error;
    } finally {
      runLock.release();
      if (state.orchestrator) {
        try {
          await state.orchestrator.saveState();
        } catch (e) {
          console.error('[resume] saveState en finally:', e.message);
        }
      }
      if (state.orchestrator) {
        try {
          await state.orchestrator.cleanup();
        } catch (e) {
          console.error('[resume] cleanup:', e.message);
        }
      }
      state.orchestrator = null;
    }
  }

  function wireOrchestratorEvents(orchestrator) {
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
    'exchange', // U-conversaciones: prompt+respuesta completos por llamada
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
  }


  const ctx = { broadcast, runLock, state, runProject, resumeProject };
  registerShutdownSaver(async () => {
    if (state.orchestrator) {
      try {
        await state.orchestrator.saveState();
        console.log('[ai-scrum] Estado guardado en disco (cierre del servidor).');
      } catch (e) {
        console.error('[ai-scrum] No se pudo guardar el estado:', e.message);
      }
    }
  });
  registerStatic(app, ctx);
  registerConfig(app, ctx);
  registerSessions(app, ctx);
  registerEngine(app, ctx);
  registerRun(app, ctx);

  function start(port = 3000, host = process.env.AI_SCRUM_BIND || '127.0.0.1') {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server));
    });
  }

  return { app, server, wss, start };
}

// Registro de guardados al cerrar: una suscripcion por proceso.
const shutdownRegistry = new Set();
function registerShutdownSaver(fn) {
  shutdownRegistry.add(fn);
  return () => shutdownRegistry.delete(fn);
}
if (!shutdownRegistry._hooked) {
  shutdownRegistry._hooked = true;
  const saveAllAndExit = (signal) => {
    const pending = [...shutdownRegistry].map((fn) => {
      try {
        return fn();
      } catch (e) {
        console.error('[ai-scrum] saveOnExit (' + signal + '):', e.message);
        return Promise.resolve();
      }
    });
    Promise.all(pending).finally(() => process.exit(0));
  };
  process.on('SIGINT', () => saveAllAndExit('SIGINT'));
  process.on('SIGTERM', () => saveAllAndExit('SIGTERM'));
}

module.exports = { createServer, registerShutdownSaver };
