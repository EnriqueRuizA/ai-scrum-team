// server/routes/sessions.js - FASE 5: rutas (extraido de server.js, sin cambios de comportamiento).
const fs = require('fs-extra');
const path = require('path');
const { loadDashboardStateFromDisk } = require('../helpers');
function registerSessions(app, ctx) {
  const { state } = ctx;
// Estado del dashboard: orquestador en vivo o última sesión en disco (outputs/…/state.json)
  app.get('/api/state', async (req, res) => {
  try {
    if (state.orchestrator) {
      return res.json({ ...state.orchestrator.getState(), _activeRun: true });
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
    const { validateSessionId, safeJoin } = require('../guards');
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
      const { validateSessionId, safeJoin } = require('../guards');
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
    const { validateSessionId, validateArtifactName, safeJoin } = require('../guards');
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
  const { validateSessionId, safeJoin } = require('../guards');
  if (!validateSessionId(req.params.session)) {
    return res.status(400).json({ error: 'id de sesión inválido' });
  }
  const appDir = safeJoin('./outputs', req.params.session, 'final-app');
  const exists = await fs.pathExists(appDir);
  if (!exists) return res.status(404).json({ error: 'App final no encontrada' });
  // No se expone la ruta absoluta (evita enumeracion del FS del servidor).
  res.json({ session: req.params.session, message: 'App generada disponible en el directorio de la sesión.' });
  });
}

module.exports = registerSessions;
