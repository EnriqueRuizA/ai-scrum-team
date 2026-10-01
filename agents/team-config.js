// agents/team-config.js - FASE 1: fuente UNICA de normalizacion del equipo.
// Re-exporta lib/default-team.js para no duplicar logica. En FASE 2/5 los
// consumidores migraran a este modulo y lib/default-team.js quedara como alias.

const {
  VALID_ROLES,
  DEFAULT_LABELS,
  defaultTeam,
  normalizeTeam,
  isRoleEnabled,
  getEnabledRoles
} = require('../lib/default-team');

module.exports = {
  VALID_ROLES,
  DEFAULT_LABELS,
  defaultTeam,
  normalizeTeam,
  isRoleEnabled,
  getEnabledRoles
};
