// scripts/export-agents.js - U1: genera .opencode/agent/*.md desde roles+personas.
// Uso: node scripts/export-agents.js [destino]  (defecto: .opencode/agent)
// El destino real del usuario (.opencode/) NO se commitea; opencode.example/ si.
// Las skills del rol van al frontmatter (permission.skill, formato opencode).

const fs = require('fs-extra');
const path = require('path');
const { buildPersona } = require('../agents/personas');
const { normalizeRoles } = require('../agents/team-config');

function frontmatter(role) {
  const lines = ['---', `description: ${(role.label || role.id).slice(0, 120)}`, 'mode: subagent'];
  if (Array.isArray(role.skills) && role.skills.length > 0) {
    lines.push('permission:');
    lines.push('  skill:');
    for (const s of role.skills) lines.push(`    "${s}": allow`);
  }
  lines.push('---');
  return lines.join('\n');
}

async function main() {
  const dest = process.argv[2] || path.join('.opencode', 'agent');
  const config = await fs.readJson('./config/project-config.json').catch(() => ({}));
  const roles = normalizeRoles(config);
  await fs.ensureDir(dest);
  for (const role of roles) {
    if (role.enabled === false) continue;
    const body = buildPersona(role, config);
    const md = `${frontmatter(role)}\n\n${body}\n`;
    const out = path.join(dest, `${role.id}.md`);
    await fs.writeFile(out, md, 'utf8');
    console.log(`  ✓ ${out}`);
  }
  console.log('Agentes exportados. No commitees .opencode/ (es local).');
}

main().catch((e) => {
  console.error('export-agents fallo:', e.message);
  process.exitCode = 1;
});
