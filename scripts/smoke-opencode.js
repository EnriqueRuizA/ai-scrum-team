// scripts/smoke-opencode.js - FASE 2: sprint minimo REAL contra opencode.
// Requiere: opencode instalado + motor alcanzable (serve) u opencode run.
// Uso: npm run smoke  (lee config/project-config.json, maxSprints=1 forzado).
// No sustituye a `npm test` (Jest, con mocks). Solo verificacion manual/local.

const fs = require('fs-extra');
const { createAdapter } = require('../llm/factory');
const { runPipeline } = require('../orchestrator/pipeline');
const { normalizeTeam, getEnabledRoles } = require('../agents/team-config');
const { StateStore } = require('../orchestrator/state');

function mockAgent(role, text) {
  return {
    role,
    name: `smoke-${role}`,
    on() {},
    async initialize() {},
    async close() {},
    async sendMessage() {
      return text;
    }
  };
}

async function main() {
  const config = await fs.readJson('./config/project-config.json');
  const adapter = createAdapter(config);

  console.log('1/3 Motor...');
  const health = await adapter.health();
  if (!health.ok) {
    console.error(`  ✖ ${health.error}\n    → ${health.hint || ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ opencode OK (modo ${health.mode})`);

  console.log('2/3 Generacion minima (Scrum Planning de juguete)...');
  const { text } = await adapter.generate({
    prompt: 'Responde SOLO con este JSON exacto: {"smoke":"ok"}',
    title: 'smoke-opencode',
    timeoutMs: 120000
  });
  console.log(`  ✓ respuesta (${text.length} chars): ${text.slice(0, 120)}`);

  console.log('3/3 Pipeline con agentes mock (1 sprint, sin motor)...');
  const outputDir = './outputs/smoke-test';
  await fs.remove(outputDir);
  const team = normalizeTeam(config);
  const state = new StateStore(outputDir, 'smoke', 1).state;
  const agents = {
    scrumMaster: mockAgent('scrumMaster', '{"sprint":{"goal":"smoke","stories":[]}}'),
    developer: mockAgent('developer', '{"implementation":{"files":[{"path":"smoke.txt","code":"ok"}],"notes":""}}')
  };
  const logs = [];
  await runPipeline({
    config: { ...config, scrum: { maxSprints: 1 } },
    team,
    agents,
    outputDir,
    state,
    enabledRoles: getEnabledRoles([
      { role: 'scrumMaster', enabled: true },
      { role: 'developer', enabled: true }
    ]),
    log: (m) => logs.push(m),
    emit: () => {},
    waitWhilePaused: async () => {},
    checkGracefulStopAfterStep: async () => false,
    saveState: async () => {}
  });
  const ok =
    state.sprints.length === 1 &&
    (await fs.pathExists(`${outputDir}/final-app/smoke.txt`));
  console.log(ok ? '  ✓ pipeline smoke OK' : '  ✖ pipeline smoke FALLO');
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('smoke fallo:', e.message);
  process.exitCode = 1;
});
