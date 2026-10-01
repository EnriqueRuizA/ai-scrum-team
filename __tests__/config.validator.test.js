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

describe('validateProjectConfig U1 (roles/flow)', () => {
  const base = () => ({
    scrum: { maxSprints: 2 },
    agents: {
      backend: 'local',
      team: [{ id: 'sm', role: 'scrumMaster', enabled: true }],
      roles: [
        { id: 'dev', label: 'Dev', mission: 'Escribe codigo de calidad', model: '', skills: ['mis-docs'], enabled: true },
        { id: 'qa', label: 'QA', mission: 'Prueba todo lo generado', skills: [], enabled: true }
      ],
      flow: [
        { role: 'dev', task: 'implementar' },
        { role: 'qa', task: 'probar', loop: { until: 'qa.passed', max: 2, fix: { role: 'dev', task: 'implementar' } } }
      ],
      opencode: { mode: 'run', model: 'ollama/qwen3.5:9b' }
    },
    outputs: { port: 3000 }
  });

  test('roles+flow validos pasan', () => {
    expect(validateProjectConfig(base()).ok).toBe(true);
  });

  test('detecta id duplicado, mission corta, skill invalida, loop roto', () => {
    const c = base();
    c.agents.roles = [
      { id: 'dev', label: 'A', mission: 'corta', skills: ['MAL_NOMBRE'], enabled: true },
      { id: 'dev', label: 'B', mission: 'Otra mision valida aqui', enabled: true }
    ];
    c.agents.flow = [
      { role: 'dev', task: 'inventada' },
      { role: 'fantasma', task: 'plan' },
      { role: 'dev', task: 'probar', loop: { until: 'nunca', max: 99 } }
    ];
    const r = validateProjectConfig(c);
    expect(r.ok).toBe(false);
    const j = r.errors.join('\n');
    for (const needle of [
      'agents.roles[0].mission',
      'agents.roles[0].skills',
      'agents.roles[1].id: duplicado',
      'agents.flow[0].task',
      'agents.flow[1].role',
      'agents.flow[2].loop.until',
      'agents.flow[2].loop.max'
    ]) {
      expect(j).toMatch(needle);
    }
  });

  test('roles vacios y flow vacio fallan; ausentes se toleran', () => {
    expect(validateProjectConfig({ agents: { roles: [], flow: [] } }).ok).toBe(false);
    expect(validateProjectConfig({ agents: {} }).ok).toBe(true);
  });

  test('registro de modelos: duplicados, ids vacios y referencias', () => {
    const c = {
      agents: {
        roles: [{ id: 'a', label: 'A', mission: 'Mision valida larga', model: 'x/y', skills: [], enabled: true }],
        flow: [{ role: 'a', task: 'libre' }],
        models: [{ id: 'x/y', label: 'XY' }, { id: 'x/y' }, { id: '' }],
        opencode: { mode: 'run', model: 'no/existe' }
      }
    };
    const r = validateProjectConfig(c);
    expect(r.ok).toBe(false);
    const j = r.errors.join('\n');
    expect(j).toMatch('agents.models[1].id: duplicado');
    expect(j).toMatch('agents.models[2].id');
    expect(j).toMatch('agents.opencode.model: no esta en agents.models');
    const ok = validateProjectConfig({
      agents: {
        roles: [{ id: 'a', label: 'A', mission: 'Mision valida larga', model: '', skills: [], enabled: true }],
        flow: [{ role: 'a', task: 'libre' }],
        models: [{ id: 'x/y' }],
        opencode: { mode: 'run', model: 'x/y' }
      }
    });
    expect(ok.errors).toEqual([]);
    expect(ok.ok).toBe(true);
  });
});
