// agents/team-config.js - U1: fuente UNICA de roles + flow.
// Modelo nuevo: agents.roles[] + agents.flow[]. Lo antiguo (agents.team,
// VALID_ROLES fijos) se mantiene para compatibilidad hasta U2.

const {
  VALID_ROLES,
  DEFAULT_LABELS,
  defaultTeam,
  normalizeTeam,
  isRoleEnabled,
  getEnabledRoles
} = require('../lib/default-team');

const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LOOP_CONDITIONS = ['qa.passed', 'noCriticalBugs', 'filesWritten', 'always'];

const CLASSIC_IDS = ['scrumMaster', 'productOwner', 'developer', 'qaTester'];

function defaultRoles() {
  return [
    { id: 'scrumMaster', label: 'Carlos (Scrum Master)', mission: '', model: '', skills: [], enabled: true },
    { id: 'productOwner', label: 'Sarah (Product Owner)', mission: '', model: '', skills: [], enabled: true },
    { id: 'developer', label: 'Alex (Developer)', mission: '', model: '', skills: [], enabled: true },
    { id: 'qaTester', label: 'María (QA)', mission: '', model: '', skills: [], enabled: true }
  ];
}

function defaultFlow() {
  return [
    { role: 'scrumMaster', task: 'plan' },
    { role: 'productOwner', task: 'refinar' },
    { role: 'developer', task: 'implementar' },
    {
      role: 'qaTester',
      task: 'probar',
      loop: { until: 'qa.passed', max: 3, fix: { role: 'developer', task: 'implementar' } }
    },
    { role: 'scrumMaster', task: 'revisar' }
  ];
}

/** Normaliza roles: ids unicos, mission obligatoria salvo ids clasicos. */
function normalizeRoles(config) {
  const raw = config?.agents?.roles;
  const list = Array.isArray(raw) && raw.length > 0 ? raw : defaultRoles();
  const out = [];
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: String(r.label || id).trim(),
      mission: String(r.mission || ''),
      extra: String(r.extra || ''),
      model: String(r.model || ''),
      skills: Array.isArray(r.skills) ? r.skills.filter((s) => typeof s === 'string') : [],
      files: Array.isArray(r.files) ? r.files.filter((f) => typeof f === 'string') : [],
      enabled: r.enabled !== false
    });
  }
  return out.length > 0 ? out : defaultRoles();
}

function normalizeFlow(config) {
  const raw = config?.agents?.flow;
  const list = Array.isArray(raw) && raw.length > 0 ? raw : defaultFlow();
  return list.filter((s) => s && typeof s === 'object' && typeof s.role === 'string');
}

function roleById(roles, id) {
  return roles.find((r) => r.id === id) || null;
}

function enabledRoles(roles) {
  return new Set(roles.filter((r) => r.enabled !== false).map((r) => r.id));
}

module.exports = {
  VALID_ROLES,
  DEFAULT_LABELS,
  defaultTeam,
  normalizeTeam,
  isRoleEnabled,
  getEnabledRoles,
  SKILL_NAME_RE,
  LOOP_CONDITIONS,
  CLASSIC_IDS,
  defaultRoles,
  defaultFlow,
  normalizeRoles,
  normalizeFlow,
  roleById,
  enabledRoles
};
