// utils/config-validator.js - FASE 2: valida project-config.json sin dependencias.
// Validador dirigido por config/schema.json (subset: required, type, enum,
// min/max, minItems). Devuelve { ok, errors[] } con path del campo.

const VALID_ROLES = ['productOwner', 'developer', 'qaTester', 'scrumMaster'];
const TASK_IDS = ['plan', 'refinar', 'implementar', 'probar', 'revisar', 'libre'];
const LOOP_UNTIL = ['qa.passed', 'noCriticalBugs', 'filesWritten', 'always'];
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateTeam(team, errors) {
  // U1: team es legacy y opcional (el modelo es roles+flow). Si existe, se valida.
  if (team === undefined) return;
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

/** Registro de modelos (ids elegibles por roles y motor). */
function validateModels(models, errors) {
  if (models === undefined) return [];
  if (!Array.isArray(models)) {
    errors.push('agents.models: debe ser array');
    return [];
  }
  const ids = [];
  const seen = new Set();
  models.forEach((m, i) => {
    const p = `agents.models[${i}]`;
    if (!isObject(m) || typeof m.id !== 'string' || !m.id.trim()) {
      errors.push(`${p}.id: string no vacio requerido (formato proveedor/modelo)`);
      return;
    }
    if (seen.has(m.id)) errors.push(`${p}.id: duplicado (${m.id})`);
    seen.add(m.id);
    ids.push(m.id);
    if (m.label !== undefined && typeof m.label !== 'string') {
      errors.push(`${p}.label: debe ser string`);
    }
  });
  return ids;
}
/** U1: valida roles libres (id unico, mission salvo clasicos, skills validas). */
function validateRoles(roles, errors, modelIds) {
  if (roles === undefined) return;
  if (!Array.isArray(roles) || roles.length === 0) {
    errors.push('agents.roles: array no vacio requerido');
    return;
  }
  const seen = new Set();
  roles.forEach((r, i) => {
    const p = `agents.roles[${i}]`;
    if (!isObject(r)) {
      errors.push(`${p}: debe ser objeto`);
      return;
    }
    if (typeof r.id !== 'string' || !r.id.trim()) {
      errors.push(`${p}.id: string no vacio requerido`);
      return;
    }
    if (seen.has(r.id)) errors.push(`${p}.id: duplicado (${r.id})`);
    seen.add(r.id);
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') {
      errors.push(`${p}.enabled: debe ser boolean`);
    }
    if (r.model !== undefined && typeof r.model !== 'string') {
      errors.push(`${p}.model: debe ser string (proveedor/modelo)`);
    } else if (typeof r.model === 'string' && r.model.trim() && modelIds.length > 0 && !modelIds.includes(r.model.trim())) {
      errors.push(`${p}.model: no esta en agents.models (${r.model.trim()})`);
    }
    if (r.variant !== undefined && typeof r.variant !== 'string') {
      errors.push(`${p}.variant: debe ser string (p.ej. xhigh)`);
    }
    const mission = String(r.mission || '').trim();
    if (!VALID_ROLES.includes(r.id) && mission.length < 10) {
      errors.push(`${p}.mission: minimo 10 caracteres para roles personalizados`);
    }
    if (r.skills !== undefined) {
      if (!Array.isArray(r.skills) || r.skills.some((s) => typeof s !== 'string' || !SKILL_NAME_RE.test(s))) {
        errors.push(`${p}.skills: array de nombres validos (minusculas-guiones)`);
      }
    }
    if (r.files !== undefined && (!Array.isArray(r.files) || r.files.some((f) => typeof f !== 'string'))) {
      errors.push(`${p}.files: debe ser array de strings`);
    }
  });
  if (!roles.some((r) => isObject(r) && r.enabled !== false)) {
    errors.push('agents.roles: al menos un rol habilitado');
  }
}

/** U1: valida flow (roles existentes, tareas conocidas, loops con max). */
function validateFlow(flow, roles, errors) {
  if (flow === undefined) return;
  if (!Array.isArray(flow) || flow.length === 0) {
    errors.push('agents.flow: array no vacio requerido');
    return;
  }
  const ids = new Set((roles || []).filter(isObject).map((r) => r.id));
  flow.forEach((s, i) => {
    const p = `agents.flow[${i}]`;
    if (!isObject(s)) {
      errors.push(`${p}: debe ser objeto`);
      return;
    }
    if (typeof s.role !== 'string' || !ids.has(s.role)) {
      errors.push(`${p}.role: rol inexistente (${JSON.stringify(s.role)})`);
    }
    if (!TASK_IDS.includes(s.task)) {
      errors.push(`${p}.task: desconocida (${JSON.stringify(s.task)}; validas: ${TASK_IDS.join(', ')})`);
    }
    if (s.onError !== undefined && !['abort', 'continue'].includes(s.onError)) {
      errors.push(`${p}.onError: abort | continue`);
    }
    if (s.loop !== undefined) {
      if (!isObject(s.loop)) {
        errors.push(`${p}.loop: debe ser objeto`);
        return;
      }
      if (!LOOP_UNTIL.includes(s.loop.until)) {
        errors.push(`${p}.loop.until: una de ${LOOP_UNTIL.join(', ')}`);
      }
      if (!Number.isInteger(s.loop.max) || s.loop.max < 1 || s.loop.max > 10) {
        errors.push(`${p}.loop.max: entero entre 1 y 10`);
      }
      if (s.loop.fix !== undefined) {
        if (!isObject(s.loop.fix)) {
          errors.push(`${p}.loop.fix: debe ser objeto`);
        } else {
          if (typeof s.loop.fix.role !== 'string' || !ids.has(s.loop.fix.role)) {
            errors.push(`${p}.loop.fix.role: rol inexistente`);
          }
          if (!TASK_IDS.includes(s.loop.fix.task)) {
            errors.push(`${p}.loop.fix.task: tarea desconocida`);
          }
        }
      }
    }
  });
}

function validateOpencode(oc, errors, modelIds) {
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
  } else if (typeof oc.model === 'string' && oc.model.trim() && modelIds.length > 0 && !modelIds.includes(oc.model.trim())) {
    errors.push(`agents.opencode.model: no esta en agents.models (${oc.model.trim()})`);
  }
  if (oc.variant !== undefined && typeof oc.variant !== 'string') {
    errors.push('agents.opencode.variant: debe ser string (p.ej. xhigh)');
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
  const modelIds = validateModels(config.agents?.models, errors);
  validateRoles(config.agents?.roles, errors, modelIds);
  validateFlow(config.agents?.flow, config.agents?.roles, errors);
  validateOpencode(config.agents?.opencode, errors, modelIds);

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
