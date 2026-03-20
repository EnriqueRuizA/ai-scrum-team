// lib/default-team.js — Equipo por defecto y normalización desde project-config

const VALID_ROLES = ['productOwner', 'developer', 'qaTester', 'scrumMaster'];

const DEFAULT_LABELS = {
  productOwner: 'Sarah (Product Owner)',
  developer: 'Alex (Developer)',
  qaTester: 'María (QA)',
  scrumMaster: 'Carlos (Scrum Master)'
};

function defaultTeam() {
  return VALID_ROLES.map((role) => ({
    id: role,
    role,
    enabled: true,
    label: DEFAULT_LABELS[role] || role
  }));
}

/**
 * @param {object} config - project-config raíz
 * @returns {Array<{ id: string, role: string, enabled: boolean, label: string }>}
 */
function normalizeTeam(config) {
  const raw = config?.agents?.team;
  if (Array.isArray(raw) && raw.length > 0) {
    const out = [];
    for (const t of raw) {
      if (!t || typeof t !== 'object') continue;
      const role = String(t.role || '').trim();
      if (!VALID_ROLES.includes(role)) continue;
      out.push({
        id: String(t.id || role).trim() || role,
        role,
        enabled: t.enabled !== false,
        label: String(t.label || DEFAULT_LABELS[role] || role).trim()
      });
    }
    // Asegura al menos una entrada por rol conocido si el array quedó vacío tras filtrar
    if (out.length === 0) return defaultTeam();
    return out;
  }
  return defaultTeam();
}

function isRoleEnabled(team, role) {
  const m = team.find((t) => t.role === role);
  return m ? m.enabled !== false : true;
}

function getEnabledRoles(team) {
  return new Set(team.filter((t) => t.enabled !== false).map((t) => t.role));
}

module.exports = {
  VALID_ROLES,
  DEFAULT_LABELS,
  defaultTeam,
  normalizeTeam,
  isRoleEnabled,
  getEnabledRoles
};
