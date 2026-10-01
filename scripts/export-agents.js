// scripts/export-agents.js - FASE 2: genera .opencode/agent/*.md desde agents/personas.js.
// Uso: node scripts/export-agents.js [destino]  (defecto: .opencode/agent)
// El destino real del usuario (.opencode/) NO se commitea; opencode.example/ si.

const fs = require('fs-extra');
const path = require('path');
const { ROLES, personaFor } = require('../agents/personas');

const DESCRIPTIONS = {
  scrumMaster: 'Scrum Master: planifica sprints y hace review. Responde SOLO JSON.',
  productOwner: 'Product Owner: refina historias y criterios de aceptacion. Responde SOLO JSON.',
  developer: 'Developer: implementa codigo completo. Responde SOLO JSON con files[].',
  qaTester: 'QA Tester: prueba entregas y reporta bugs. Responde SOLO JSON.'
};

async function main() {
  const dest = process.argv[2] || path.join('.opencode', 'agent');
  const config = await fs.readJson('./config/project-config.json').catch(() => ({}));
  await fs.ensureDir(dest);
  for (const role of ROLES) {
    const body = personaFor(role, config);
    const md = `---\ndescription: ${DESCRIPTIONS[role]}\nmode: subagent\n---\n\n${body}\n`;
    const out = path.join(dest, `${role}.md`);
    await fs.writeFile(out, md, 'utf8');
    console.log(`  ✓ ${out}`);
  }
  console.log('Agentes exportados. No commitees .opencode/ (es local).');
}

main().catch((e) => {
  console.error('export-agents fallo:', e.message);
  process.exitCode = 1;
});
