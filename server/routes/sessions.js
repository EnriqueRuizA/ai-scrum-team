// server/routes/sessions.js - FASE 5: rutas (extraido de server.js, sin cambios de comportamiento).
const fs = require('fs-extra');
const path = require('path');
const { loadDashboardStateFromDisk, limitStateLogs } = require('../helpers');

/**
 * Resumen gestionable de una sesion (para la tabla Proyectos del dashboard).
 * projectName: del state (sesiones nuevas) o del snapshot de config (antiguas).
 */
async function sessionSummary(outputsDir, id, state, mtimeMs, activeRun) {
  let projectName = (state && state.projectName) || null;
  if (!projectName) {
    try {
      const snap = await fs.readJson(path.join(outputsDir, id, 'config.snapshot.json'));
      if (snap && snap.project && typeof snap.project.name === 'string') {
        projectName = snap.project.name;
      }
    } catch (e) {
      // Sin snapshot (sesion muy antigua): sin nombre de proyecto.
    }
  }
  const sprints = (state && Array.isArray(state.sprints) && state.sprints) || [];
  const art = (state && state.artifacts) || {};
  return {
    id,
    mtimeMs: mtimeMs || 0,
    projectName,
    status: (state && state.status) || '?',
    currentSprint: (state && state.currentSprint) || 0,
    maxSprints: (state && state.maxSprints) || 0,
    sprintsDone: sprints.length,
    artifactsCount:
      (Array.isArray(art.implementations) ? art.implementations.length : 0) +
      (Array.isArray(art.qaReports) ? art.qaReports.length : 0) +
      (art.prd ? 1 : 0),
    errorsCount: (state && Array.isArray(state.errors) && state.errors.length) || 0,
    _activeRun: activeRun === true
  };
}
function registerSessions(app, ctx) {
  const { state, runLock, broadcast, resumeProject } = ctx;
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

// Listar sesiones guardadas (la primera es el proyecto en ejecucion, si lo hay).
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
            ...state,
            summary: await sessionSummary(outputsDir, s, state, st ? st.mtimeMs : 0, false)
          };
        } catch (e) {
          return { id: s, error: 'No state file', mtimeMs: 0 };
        }
      })
    );
    // El run en vivo es un proyecto activo: va primero y con marca explicita.
    // (En disco puede haber una copia desactualizada de la misma carpeta.)
    if (state.orchestrator) {
      try {
        const liveFolder = path.basename(state.orchestrator.outputDir);
        const liveState = state.orchestrator.getState();
        const idx = sessionData.findIndex((s) => s && s.id === liveFolder);
        if (idx >= 0) sessionData.splice(idx, 1);
        sessionData.unshift({
          id: liveFolder,
          mtimeMs: Date.now(),
          ...liveState,
          _activeRun: true,
          summary: await sessionSummary(outputsDir, liveFolder, liveState, Date.now(), true)
        });
      } catch (e) {
        // Si el vivo no se puede serializar, la lista de disco sigue valiendo.
      }
    }
    sessionData.sort((a, b) => {
      if (a._activeRun && !b._activeRun) return -1;
      if (b._activeRun && !a._activeRun) return 1;
      return (b.mtimeMs || 0) - (a.mtimeMs || 0);
    });
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

  /**
   * Reanudar una sesion guardada como proyecto activo: conserva logs,
   * artefactos y sprints hechos; continua desde el siguiente sprint.
   * Usa el snapshot de config de la sesion (o la config actual si es antigua).
   */
  app.post('/api/sessions/:id/resume', async (req, res) => {
    if (!runLock.tryAcquire({ endpoint: '/api/sessions/:id/resume' })) {
      return res.status(409).json({ error: 'Ya hay un proyecto en ejecución', run: runLock.getInfo() });
    }
    // Falla liberando el lock: sin esto, un 400/409 dejaba el servidor
    // bloqueado (409 para siempre) hasta reiniciar.
    const fail = (code, body) => {
      runLock.release();
      return res.status(code).json(body);
    };
    try {
      const { validateSessionId, safeJoin } = require('../guards');
      if (!validateSessionId(req.params.id)) {
        return fail(400, { error: 'id de sesión inválido' });
      }
      if (state.orchestrator) {
        return fail(409, { error: 'Ya hay un proyecto en ejecución' });
      }
      const outputDir = path.join('./outputs', req.params.id);
      const statePath = safeJoin('./outputs', req.params.id, 'state.json');
      if (!(await fs.pathExists(statePath))) {
        return fail(404, { error: 'No existe state.json en esa sesión' });
      }
      const savedState = await fs.readJson(statePath);
      // Config efectiva: snapshot de la sesion si existe, si no la actual.
      let config = await fs.readJson(path.join(outputDir, 'config.snapshot.json')).catch(() => null);
      if (!config || typeof config !== 'object') {
        config = await fs.readJson('./config/project-config.json');
      }
      const maxSprints = config.scrum?.maxSprints || savedState.maxSprints || 3;
      const done = savedState.currentSprint || (Array.isArray(savedState.sprints) ? savedState.sprints.length : 0) || 0;
      if (done >= maxSprints) {
        return fail(400, { error: `La sesión ya completó los ${maxSprints} sprints (nada que reanudar).` });
      }
      // Credenciales solo si el backend las exige (Claude navegador).
      const useLocal = config.agents?.backend === 'local';
      let credentials = {};
      if (!useLocal && !config.agents?.opencode) {
        credentials = await fs.readJson('./config/credentials.json').catch(() => ({}));
        if (!credentials.claude?.email || !String(credentials.claude.email).trim()) {
          return fail(400, {
            error: 'Credenciales de Claude.ai: indica al menos el email. La contraseña es opcional si usas enlace mágico por correo.'
          });
        }
      } else if (config.agents?.opencode) {
        const { createAdapter } = require('../../llm/factory');
        const ocHealth = await createAdapter(config).health();
        if (!ocHealth.ok) {
          return fail(400, {
            error: `Motor opencode no disponible (${ocHealth.mode}): ${ocHealth.error}. ${ocHealth.hint || ''}`
          });
        }
      }

      broadcast('status', { status: 'starting' });
      res.json({ success: true, message: `Sesión ${req.params.id} reanudada desde el sprint ${done + 1}`, resumeFrom: done + 1 });

      resumeProject({ savedState, outputDir, config, credentials }).catch((err) => {
        console.error('Error reanudando proyecto:', err);
        broadcast('error', { message: err.message });
      });
    } catch (e) {
      runLock.release();
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Borrar un proyecto guardado (carpeta outputs/session-… completa).
   * No permite borrar el proyecto en ejecucion. Si era la sesion enfocada
   * (puntero del dashboard), el puntero se limpia.
   */
  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      const { validateSessionId, safeJoin } = require('../guards');
      if (!validateSessionId(req.params.id)) {
        return res.status(400).json({ error: 'id de sesión inválido' });
      }
      if (state.orchestrator && path.basename(state.orchestrator.outputDir) === req.params.id) {
        return res.status(409).json({ error: 'No se puede borrar el proyecto en ejecución' });
      }
      const dir = safeJoin('./outputs', req.params.id);
      if (!(await fs.pathExists(dir))) {
        return res.status(404).json({ error: 'Sesión no encontrada' });
      }
      await fs.remove(dir);
      // Si el dashboard apuntaba a esta sesion, limpia el puntero.
      try {
        const pointerPath = path.join('./outputs', '.last-dashboard-session.json');
        const ptr = await fs.readJson(pointerPath).catch(() => null);
        if (ptr && (ptr.outputFolder === req.params.id || ptr.folder === req.params.id)) {
          await fs.remove(pointerPath);
        }
      } catch (e) {
        // Limpieza del puntero best-effort: el borrado ya se hizo.
      }
      res.json({ success: true, id: req.params.id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

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
