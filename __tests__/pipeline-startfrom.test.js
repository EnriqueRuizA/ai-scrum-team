// __tests__/pipeline-startfrom.test.js - Reanudar salta sprints ya hechos.
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { runPipeline } = require('../orchestrator/pipeline');

function mockAgent(role, text) {
  return {
    role,
    name: role,
    on() {},
    async initialize() {},
    async close() {},
    async sendMessage() {
      return text;
    }
  };
}

const ROLES = [
  { id: 'sm', label: 'SM', mission: '', model: '', skills: [], enabled: true },
  { id: 'dev', label: 'Dev', mission: '', model: '', skills: [], enabled: true }
];
const FLOW = [
  { role: 'sm', task: 'plan' },
  { role: 'dev', task: 'implementar' },
  { role: 'sm', task: 'revisar' }
];

function scriptedAgents(calls) {
  return {
    sm: {
      ...mockAgent('sm'),
      async sendMessage(p) {
        calls.push('sm');
        return p.includes('Cierra el sprint')
          ? '{"review":{"done":true,"summary":"ok","next":"seguir"}}'
          : '{"sprint":{"goal":"g","stories":[]}}';
      }
    },
    dev: {
      ...mockAgent('dev'),
      async sendMessage() {
        calls.push('dev');
        return '{"implementation":{"files":[],"notes":"n"}}';
      }
    }
  };
}

function emptyArtifacts() {
  return {
    prd: null,
    architecture: null,
    testPlan: null,
    sprintPlan: null,
    implementations: [],
    qaReports: [],
    finalCode: null
  };
}

describe('runPipeline con startFrom (resume)', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  test('startFrom=3 de 3 ejecuta solo el sprint 3', async () => {
    const calls = [];
    const sprints = [];
    const state = {
      sessionId: 's',
      status: 'running',
      currentSprint: 2,
      maxSprints: 3,
      sprints: [
        { n: 1, plan: { goal: 'g1', stories: [] }, qa: null, review: null },
        { n: 2, plan: { goal: 'g2', stories: [] }, qa: null, review: null }
      ],
      artifacts: emptyArtifacts(),
      logs: [],
      errors: [],
      runPaused: false
    };
    const res = await runPipeline({
      config: { scrum: { maxSprints: 3 }, agents: { timeout: 5000 } },
      roles: ROLES,
      flow: FLOW,
      agents: scriptedAgents(calls),
      outputDir: dir,
      state,
      startFrom: 3,
      log: () => {},
      emit: (e, d) => {
        if (e === 'sprint_start') sprints.push(d.sprint);
      },
      waitWhilePaused: async () => {},
      checkGracefulStopAfterStep: async () => false,
      saveState: async () => {}
    });
    expect(res.stopped).toBe(false);
    expect(sprints).toEqual([3]);
    expect(calls).toEqual(['sm', 'dev', 'sm']);
    expect(state.sprints).toHaveLength(3);
    expect(state.currentSprint).toBe(3);
  });

  test('sin startFrom empieza en 1 (comportamiento clasico)', async () => {
    const calls = [];
    const sprints = [];
    const state = {
      sessionId: 's',
      status: 'running',
      currentSprint: 0,
      maxSprints: 1,
      sprints: [],
      artifacts: emptyArtifacts(),
      logs: [],
      errors: [],
      runPaused: false
    };
    await runPipeline({
      config: { scrum: { maxSprints: 1 }, agents: { timeout: 5000 } },
      roles: ROLES,
      flow: FLOW,
      agents: scriptedAgents(calls),
      outputDir: dir,
      state,
      log: () => {},
      emit: (e, d) => {
        if (e === 'sprint_start') sprints.push(d.sprint);
      },
      waitWhilePaused: async () => {},
      checkGracefulStopAfterStep: async () => false,
      saveState: async () => {}
    });
    expect(sprints).toEqual([1]);
    expect(state.currentSprint).toBe(1);
  });
});
