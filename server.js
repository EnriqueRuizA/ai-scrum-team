// server.js - Express server + WebSocket para el dashboard en tiempo real

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs-extra');

const ScrumMasterOrchestrator = require('./orchestrator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static('public'));

// Ruta raíz: servir dashboard principal (index.html)
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  fs.pathExists(indexPath)
    .then(exists => {
      if (exists) {
        return res.sendFile(indexPath);
      }
      return res.status(404).send('Dashboard no encontrado (falta public/index.html)');
    })
    .catch(() => {
      res.status(500).send('Error cargando el dashboard');
    });
});

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

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  console.log('Dashboard conectado. Clientes:', connectedClients.size);
  
  // Enviar estado actual al cliente nuevo
  if (orchestrator) {
    ws.send(JSON.stringify({ 
      type: 'state', 
      data: orchestrator.getState(),
      timestamp: new Date().toISOString()
    }));
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
      safeCredentials[key] = { email: val.email, configured: !!val.password };
    }
    res.json({ config, credentials: safeCredentials });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar credenciales
app.post('/api/credentials', async (req, res) => {
  try {
    const current = await fs.readJson('./config/credentials.json');
    const updated = { ...current, ...req.body };
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
    const updated = { ...current, ...req.body };
    await fs.writeJson('./config/project-config.json', updated, { spaces: 2 });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
      if (!credentials.claude?.email || !credentials.claude?.password) {
        return res.status(400).json({ error: 'Credenciales de Claude.ai no configuradas' });
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

// Pausar/reanudar
app.post('/api/pause', (req, res) => {
  if (!orchestrator) return res.status(400).json({ error: 'No hay proyecto activo' });
  broadcast('paused', {});
  res.json({ success: true });
});

// Obtener estado actual
app.get('/api/state', (req, res) => {
  if (!orchestrator) {
    return res.json({ status: 'idle', sprints: [], logs: [] });
  }
  res.json(orchestrator.getState());
});

// Listar sesiones guardadas
app.get('/api/sessions', async (req, res) => {
  try {
    const outputsDir = './outputs';
    await fs.ensureDir(outputsDir);
    const sessions = await fs.readdir(outputsDir);
    const sessionData = await Promise.all(
      sessions.filter(s => s.startsWith('session-')).map(async (s) => {
        try {
          const statePath = path.join(outputsDir, s, 'state.json');
          const state = await fs.readJson(statePath);
          return { id: s, ...state };
        } catch (e) {
          return { id: s, error: 'No state file' };
        }
      })
    );
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
  const events = ['log', 'status', 'phase', 'sprint_start', 'sprint_update', 
                  'agent_working', 'agent_ready', 'agent_initializing', 'agent_response',
                  'artifact_created', 'action_required', 'delivery', 'error'];
  
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
      outputDir: path.resolve('./outputs')
    });
  } catch (error) {
    broadcast('error', { message: error.message });
    throw error;
  } finally {
    isRunning = false;
    await orchestrator.cleanup();
  }
}

// === INICIAR SERVIDOR ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
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
  
  // Abrir browser automáticamente si está configurado
  const config = require('./config/project-config.json');
  if (config.outputs?.autoOpenDashboard) {
    const open = (url) => {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      require('child_process').exec(`${cmd} ${url}`);
    };
    setTimeout(() => open(`http://localhost:${PORT}`), 1000);
  }
});

module.exports = { app, server };
