// agents/personas.js - FASE 2: fuente UNICA de las personas del equipo.
// Re-exporta prompts/index.js (sin duplicar). En FASE 5 este modulo sera la
// fuente de scripts/export-agents.js para generar .opencode/agent/*.md.

const {
  SCRUM_MASTER,
  PRODUCT_OWNER,
  DEVELOPER,
  QA_TESTER,
  PROJECT_CONTEXT
} = require('../prompts');

const ROLES = ['scrumMaster', 'productOwner', 'developer', 'qaTester'];

function personaFor(role, config) {
  switch (role) {
    case 'scrumMaster':
      return SCRUM_MASTER(config);
    case 'productOwner':
      return PRODUCT_OWNER(config);
    case 'developer':
      return DEVELOPER(config);
    case 'qaTester':
      return QA_TESTER(config);
    default:
      throw new Error(`Rol desconocido: ${role}`);
  }
}

module.exports = {
  SCRUM_MASTER,
  PRODUCT_OWNER,
  DEVELOPER,
  QA_TESTER,
  PROJECT_CONTEXT,
  ROLES,
  personaFor
};
