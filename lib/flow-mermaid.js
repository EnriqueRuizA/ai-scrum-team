// lib/flow-mermaid.js — Diagrama Mermaid del pipeline (según equipo habilitado)

const { normalizeTeam, getEnabledRoles } = require('./default-team');

function esc(s) {
  return String(s).replace(/"/g, "'").replace(/\[/g, '(').replace(/\]/g, ')');
}

/**
 * @param {object} config - project-config completo
 * @returns {string} definición Mermaid flowchart
 */
function buildMermaidFromConfig(config) {
  const team = normalizeTeam(config);
  const on = getEnabledRoles(team);
  const maxS = Math.min(Math.max(1, config?.scrum?.maxSprints || 5), 20);
  const L = (role) => {
    const m = team.find((t) => t.role === role);
    return esc((m && m.label) || role);
  };

  const lines = ['flowchart TD', '  START((Inicio))'];

  if (on.has('productOwner')) lines.push(`  PO["📋 ${L('productOwner')}"]`);
  if (on.has('developer')) lines.push(`  DEV["💻 ${L('developer')}"]`);
  if (on.has('qaTester')) lines.push(`  QA["🧪 ${L('qaTester')}"]`);
  if (on.has('scrumMaster')) lines.push(`  SM["🧭 ${L('scrumMaster')}"]`);

  lines.push('  subgraph Sprints["Cada sprint"]');
  lines.push('    SP[Plan]');
  lines.push('    IMPL[Código → disco]');
  lines.push('    TST[QA]');
  lines.push('    RT[Retro]');
  lines.push('  end');
  lines.push('  FA["final-app + README"]');
  lines.push('  SMK["Humo: node --check · npm test"]');
  lines.push(`  DEC{"¿Más sprints? (máx ${maxS})"}`);

  let prev = 'START';
  const order = [
    ['productOwner', 'PO'],
    ['developer', 'DEV'],
    ['qaTester', 'QA'],
    ['scrumMaster', 'SM']
  ];
  for (const [role, id] of order) {
    if (on.has(role)) {
      lines.push(`  ${prev} --> ${id}`);
      prev = id;
    }
  }
  lines.push(`  ${prev} --> SP`);
  lines.push('  SP --> IMPL --> TST --> RT');
  lines.push('  RT --> DEC');
  lines.push('  DEC -->|Sí| SP');
  lines.push('  DEC -->|No| FA');
  lines.push('  FA --> SMK');

  return lines.join('\n');
}

module.exports = { buildMermaidFromConfig };
