// server/routes/config.js - FASE 5: rutas (extraido de server.js, sin cambios de comportamiento).
const fs = require('fs-extra');
const { sanitizeProjectConfigForClient, mergeCredentialsPatch, mergeProjectConfigPatch } = require('../helpers');
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


  // U3: endpoints huerfanos eliminados (nadie los llamaba):
  // - GET /api/config/models (modelos Ollama-directos; usar GET /api/engine/ollama-models)
  // - PATCH /api/config/agents/:id/model (el modelo va en roles/flow via POST /api/config)

}

module.exports = registerConfig;
