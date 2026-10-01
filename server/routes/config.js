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

// Actualizar configuración del proyecto (UX: valida y devuelve errores de campo)
  app.post('/api/config', async (req, res) => {
  try {
    const { normalizeTeam } = require('../../agents/team-config');
    const { validateProjectConfig } = require('../../utils/config-validator');
    await fs.ensureDir('./config');
    const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
    const updated = mergeProjectConfigPatch(current, req.body);
    // Autocompleta el equipo (defecto) antes de validar: el dashboard envia
    // parciales y el fichero heredado puede no tener team.
    if (updated.agents) updated.agents.team = normalizeTeam(updated);
    const v = validateProjectConfig(updated);
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });
    await fs.writeJson('./config/project-config.json', updated, { spaces: 2 });
    res.json({ success: true });
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
   * Endpoint para configurar el modelo de un rol.
   * PATCH /api/config/agents/{id}/model con body: { "model": "ollama/qwen3.5:9b" }
   */
  app.patch('/api/config/agents/:id/model', async (req, res) => {
  try {
    const { normalizeRoles, roleById } = require('../../agents/team-config');
    const { validateProjectConfig } = require('../../utils/config-validator');
    const agentId = decodeURIComponent(req.params.id);
    const { model } = req.body;

    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'model debe ser una cadena válida' });
    }

    // U1: el modelo por rol vive en agents.roles[].model
    // (formato proveedor/modelo de opencode).
    const current = await fs.readJson('./config/project-config.json').catch(() => ({}));
    const roles = normalizeRoles(current);
    const member = roleById(roles, agentId);
    if (!member) {
      return res.status(404).json({ error: `Agente «${agentId}» no encontrado` });
    }
    member.model = model.trim();

    const updated = { ...current, agents: { ...current.agents, roles } };
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
