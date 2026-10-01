// utils/config-validator.js - FASE 2: valida project-config.json sin dependencias.
// Validador dirigido por config/schema.json (subset: required, type, enum,
// min/max, minItems). Devuelve { ok, errors[] } con path del campo.

const VALID_ROLES = ['productOwner', 'developer', 'qaTester', 'scrumMaster'];

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateTeam(team, errors) {
  if (!Array.isArray(team) || team.length === 0) {
    errors.push('agents.team: array no vacio requerido');
    return;
  }
  team.forEach((m, i) => {
    const p = `agents.team[${i}]`;
    if (!isObject(m)) {
      errors.push(`${p}: debe ser objeto`);
      return;
    }
    if (!VALID_ROLES.includes(m.role)) {
      errors.push(`${p}.role: rol desconocido (${JSON.stringify(m.role)})`);
    }
    if (m.enabled !== undefined && typeof m.enabled !== 'boolean') {
      errors.push(`${p}.enabled: debe ser boolean`);
    }
    if (m.model !== undefined && typeof m.model !== 'string') {
      errors.push(`${p}.model: debe ser string (formato proveedor/modelo)`);
    }
    if (m.files !== undefined && (!Array.isArray(m.files) || m.files.some((f) => typeof f !== 'string'))) {
      errors.push(`${p}.files: debe ser array de strings`);
    }
  });
  if (!team.some((m) => isObject(m) && m.role === 'scrumMaster' && m.enabled !== false)) {
    errors.push('agents.team: el Scrum Master debe estar habilitado');
  }
}

function validateOpencode(oc, errors) {
  if (oc === undefined) return;
  if (!isObject(oc)) {
    errors.push('agents.opencode: debe ser objeto');
    return;
  }
  if (oc.mode !== undefined && !['serve', 'run'].includes(oc.mode)) {
    errors.push('agents.opencode.mode: serve | run');
  }
  if (oc.url !== undefined && typeof oc.url !== 'string') {
    errors.push('agents.opencode.url: debe ser string');
  }
  if (oc.model !== undefined && typeof oc.model !== 'string') {
    errors.push('agents.opencode.model: debe ser string (proveedor/modelo)');
  }
  if (oc.timeoutMs !== undefined && !(typeof oc.timeoutMs === 'number' && oc.timeoutMs >= 1000)) {
    errors.push('agents.opencode.timeoutMs: numero >= 1000');
  }
  if (oc.auto !== undefined && typeof oc.auto !== 'boolean') {
    errors.push('agents.opencode.auto: debe ser boolean');
  }
}

function validateProjectConfig(config) {
  const errors = [];
  if (!isObject(config)) return { ok: false, errors: ['config raiz: debe ser objeto'] };

  validateTeam(config.agents?.team, errors);
  validateOpencode(config.agents?.opencode, errors);

  const ms = config.scrum?.maxSprints;
  if (ms !== undefined && (!Number.isInteger(ms) || ms < 1 || ms > 20)) {
    errors.push('scrum.maxSprints: entero entre 1 y 20');
  }
  const port = config.outputs?.port;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    errors.push('outputs.port: entero entre 1 y 65535');
  }
  if (config.agents?.backend !== undefined && !['local', 'claude'].includes(config.agents.backend)) {
    errors.push('agents.backend: local | claude');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validateProjectConfig, VALID_ROLES };
