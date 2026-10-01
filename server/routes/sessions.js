// server/routes/sessions.js - FASE 5: rutas (extraido de server.js, sin cambios de comportamiento).
const fs = require('fs-extra');
const path = require('path');
const { loadDashboardStateFromDisk, limitStateLogs } = require('../helpers');
function registerSessions(app, ctx) {
  const { state } = ctx;
// Estado del dashboard: orquestador en vivo o última sesión en disco.
// FASE 6: ?logs=N (defecto 500, 0=todos, tope 5000) y ?since=ISO (deltas).
  app.get('/api/state', async (req, res) => {
  try {
    if (state.orchestrator) {
      return res.json(limitStateLogs({ ...state.orchestrator.getState(), _activeRun: true }, req.query));
    }
    const restored = await loadDashboardStateFromDisk();
    if (restored) {
      return res.json(limitStateLogs(restored, req.query));
    }
    return res.json(limitStateLogs({
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
    }, req.query));
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

  // U3: endpoints huerfanos eliminados (el dashboard lee artefactos del state):
  // - GET /api/artifact/:session/:name
  // - GET /api/download/:session

  // Conversaciones completas por sesion (prompt+respuesta por paso). Para la
  // vista Conversacion del dashboard (tiempo real via WS `exchange`).
  app.get('/api/steps/:session', async (req, res) => {
    try {
      const { readStepArtifacts } = require('../helpers');
      res.json({ steps: await readStepArtifacts('./outputs', req.params.session) });
    } catch (e) {
      res.status(400).json({ error: e.message, steps: [] });
    }
  });
}

module.exports = registerSessions;
