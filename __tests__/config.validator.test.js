// __tests__/config.validator.test.js - FASE 2: validador sin dependencias.
const { validateProjectConfig } = require('../utils/config-validator');
const { normalizeTeam } = require('../agents/team-config');

const GOOD = {
  scrum: { maxSprints: 3 },
  agents: {
    backend: 'local',
    team: [
      { id: 'po', role: 'productOwner', enabled: true, label: 'PO' },
      { id: 'dev', role: 'developer', enabled: true, label: 'Dev', model: 'ollama/qwen3:8b' },
      { id: 'qa', role: 'qaTester', enabled: false, label: 'QA' },
      { id: 'sm', role: 'scrumMaster', enabled: true, label: 'SM' }
    ],
    opencode: { mode: 'serve', url: 'http://127.0.0.1:4096', model: 'ollama/llama3.2', timeoutMs: 60000, auto: false }
  },
  outputs: { port: 3000 }
};

describe('validateProjectConfig', () => {
  test('config buena pasa (incluida la real del repo)', async () => {
    expect(validateProjectConfig(GOOD).ok).toBe(true);
    const fs = require('fs-extra');
    const real = await fs.readJson('./config/project-config.json');
    const r = validateProjectConfig(real);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('detecta errores con path del campo', () => {
    const bad = {
      scrum: { maxSprints: 99 },
      agents: {
        backend: 'watson',
        team: [{ role: 'ninja', enabled: 'si' }],
        opencode: { mode: 'telepatia', timeoutMs: 5 }
      },
      outputs: { port: 99999 }
    };
    const r = validateProjectConfig(bad);
    expect(r.ok).toBe(false);
    const joined = r.errors.join('\n');
    for (const needle of [
      'agents.team[0].role',
      'agents.team: el Scrum Master',
      'agents.opencode.mode',
      'agents.opencode.timeoutMs',
      'scrum.maxSprints',
      'outputs.port',
      'agents.backend'
    ]) {
      expect(joined).toMatch(needle);
    }
  });
});

describe('normalizeTeam', () => {
  test('filtra roles desconocidos y defaultea si queda vacio', () => {
    const t = normalizeTeam({ agents: { team: [{ role: 'ninja' }] } });
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((m) => ['productOwner', 'developer', 'qaTester', 'scrumMaster'].includes(m.role))).toBe(true);
  });
});
