// server/routes/config.js - FASE 5: rutas (extraido de server.js, sin cambios de comportamiento).
const fs = require('fs-extra');
const { sanitizeProjectConfigForClient, mergeCredentialsPatch, mergeProjectConfigPatch } = require('../helpers');
const { authHeadersFromLocalConfig } = require('../../lib/local-llm');
const { listModels } = require('../../lib/unified-local-llm');
function registerConfig(app, _ctx) {
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


  /**
   * Endpoint para actualizar el orden de los agentes.
   * PATCH /api/config/order con body: { "agentsOrder": ["agentA", "agentB", ...] }
   */
  app.patch('/api/config/order', async (req, res) => {
  try {
    const { normalizeTeam, VALID_ROLES } = require('../../agents/team-config');
    const { validateProjectConfig } = require('../../utils/config-validator');
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
    const { normalizeTeam } = require('../../agents/team-config');
    const { validateProjectConfig } = require('../../utils/config-validator');
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

}

module.exports = registerConfig;
