// __tests__/orchestrator.pipeline.test.js - FASE 1: pipeline secuencial con agentes mock.
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { runPipeline, assertSafeRelPath } = require('../orchestrator/pipeline');

function mockAgent(role, script) {
  const calls = [];
  return {
    role,
    name: role,
    calls,
    on() {},
    async initialize() {},
    async close() {},
    async sendMessage(prompt) {
      calls.push(prompt.slice(0, 60));
      const fn = script[role];
      if (typeof fn === 'function') return fn(prompt, calls.length);
      return fn;
    }
  };
}

function makeCtx(outputDir, order, stopAfter = Infinity) {
  const agents = {
    scrumMaster: mockAgent('scrumMaster', {
      scrumMaster: (prompt) =>
        prompt.includes('Cierra el sprint')
          ? '{"review":{"done":true,"summary":"ok","next":"seguir"}}'
          : '{"sprint":{"goal":"g1","stories":[{"id":"S-1","title":"t","acceptance":"a"}]}}'
    }),
    productOwner: mockAgent('productOwner', {
      productOwner: '{"stories":[{"id":"S-1","title":"t2","acceptance":"a2"}]}'
    }),
    developer: mockAgent('developer', {
      developer: '{"implementation":{"files":[{"path":"app/index.js","code":"module.exports=1;"}],"notes":"n"}}'
    }),
    qaTester: mockAgent('qaTester', {
      qaTester: '{"qa":{"passed":true,"bugs":[]}}'
    })
  };
  const state = {
    sessionId: 'test', status: 'running', currentSprint: 0, maxSprints: 1,
    sprints: [],
    artifacts: { prd: null, architecture: null, testPlan: null, sprintPlan: null, implementations: [], qaReports: [], finalCode: null },
    logs: [], errors: [], runPaused: false
  };
  let steps = 0;
  return {
    config: { scrum: { maxSprints: 1 }, agents: { timeout: 5000 } },
    team: [],
    agents,
    outputDir,
    state,
    enabledRoles: new Set(['scrumMaster', 'productOwner', 'developer', 'qaTester']),
    log: () => {},
    emit: (e) => { order.push(e); },
    waitWhilePaused: async () => {},
    checkGracefulStopAfterStep: async () => {
      steps += 1;
      return steps >= stopAfter;
    },
    saveState: async () => {}
  };
}

describe('runPipeline', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipe-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  test('ejecuta plan->PO->dev->QA->review en orden y genera artefactos', async () => {
    const order = [];
    const ctx = makeCtx(dir, order);
    const callOrder = [];
    for (const a of Object.values(ctx.agents)) {
      const orig = a.sendMessage.bind(a);
      a.sendMessage = async (p) => {
        callOrder.push(a.role);
        return orig(p);
      };
    }
    const res = await runPipeline(ctx);

    expect(res.stopped).toBe(false);
    // planning, refine, implement, qa, review
    expect(callOrder).toEqual(['scrumMaster', 'productOwner', 'developer', 'qaTester', 'scrumMaster']);
    expect(ctx.state.sprints).toHaveLength(1);
    expect(ctx.state.currentSprint).toBe(1);
    expect(ctx.state.artifacts.implementations).toHaveLength(1);
    expect(ctx.state.artifacts.qaReports).toHaveLength(1);
    expect(ctx.state.artifacts.finalCode.files).toContain(path.join('app', 'index.js'));

    for (const name of ['sprint-1-plan', 'sprint-1-implementation', 'sprint-1-qa', 'final-code']) {
      expect(await fs.pathExists(path.join(dir, 'artifacts', `${name}.json`))).toBe(true);
    }
    expect(await fs.pathExists(path.join(dir, 'final-app', 'app', 'index.js'))).toBe(true);
    expect(order).toContain('sprint_start');
  });

  test('respeta la parada tras el sprint', async () => {
    const order = [];
    const ctx = makeCtx(dir, order, 1);
    const res = await runPipeline(ctx);
    expect(res.stopped).toBe(true);
  });

  test('sin agentes no falla: usa valores por defecto', async () => {
    const order = [];
    const ctx = makeCtx(dir, order);
    ctx.agents = {};
    ctx.enabledRoles = new Set();
    const res = await runPipeline(ctx);
    expect(res.stopped).toBe(false);
    expect(ctx.state.sprints).toHaveLength(1);
  });
});

describe('assertSafeRelPath', () => {
  test('rechaza traversal y absolutas', () => {
    expect(() => assertSafeRelPath('../../etc/passwd')).toThrow();
    expect(() => assertSafeRelPath('/etc/passwd')).toThrow();
    expect(() => assertSafeRelPath('')).toThrow();
    expect(assertSafeRelPath('app/index.js')).toBe('app/index.js');
  });
});
