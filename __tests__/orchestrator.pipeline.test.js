// __tests__/orchestrator.pipeline.test.js - U1: ejecutor generico con mocks.
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { runPipeline, assertSafeRelPath, loopConditionMet } = require('../orchestrator/pipeline');

function mockAgent(role, handler) {
  const calls = [];
  return {
    role,
    name: role,
    calls,
    on() {},
    async initialize() {},
    async close() {},
    async sendMessage(prompt) {
      calls.push(prompt);
      return typeof handler === 'function' ? handler(prompt, calls.length) : handler;
    }
  };
}

const ROLES = [
  { id: 'sm', label: 'SM', mission: '', model: '', skills: [], enabled: true },
  { id: 'po', label: 'PO', mission: '', model: '', skills: [], enabled: true },
  { id: 'dev', label: 'Dev', mission: '', model: '', skills: [], enabled: true },
  { id: 'qa', label: 'QA', mission: '', model: '', skills: [], enabled: true }
];

const FLOW = [
  { role: 'sm', task: 'plan' },
  { role: 'po', task: 'refinar' },
  { role: 'dev', task: 'implementar' },
  { role: 'qa', task: 'probar' },
  { role: 'sm', task: 'revisar' }
];

function scriptFor() {
  return {
    sm: (prompt) =>
      prompt.includes('Cierra el sprint')
        ? '{"review":{"done":true,"summary":"ok","next":"seguir"}}'
        : '{"sprint":{"goal":"g1","stories":[{"id":"S-1","title":"t","acceptance":"a"}]}}',
    po: '{"stories":[{"id":"S-1","title":"t2","acceptance":"a2"}]}',
    dev: '{"implementation":{"files":[{"path":"app/index.js","code":"module.exports=1;"}],"notes":"n"}}',
    qa: '{"qa":{"passed":true,"bugs":[]}}'
  };
}

function makeCtx(outputDir, order, opts = {}) {
  const script = scriptFor();
  const agents = {};
  for (const r of ROLES) agents[r.id] = mockAgent(r.id, script[r.id]);
  const state = {
    sessionId: 'test',
    status: 'running',
    currentSprint: 0,
    maxSprints: 1,
    sprints: [],
    artifacts: { prd: null, architecture: null, testPlan: null, sprintPlan: null, implementations: [], qaReports: [], finalCode: null },
    logs: [],
    errors: [],
    runPaused: false
  };
  let steps = 0;
  return {
    config: { scrum: { maxSprints: 1 }, agents: { timeout: 5000 } },
    roles: opts.roles || ROLES,
    flow: opts.flow || FLOW,
    agents,
    outputDir,
    state,
    log: () => {},
    emit: (e) => {
      order.push(e);
    },
    waitWhilePaused: async () => {},
    checkGracefulStopAfterStep: async () => {
      steps += 1;
      return steps >= (opts.stopAfter || Infinity);
    },
    saveState: async () => {}
  };
}

describe('runPipeline (generico)', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipe-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  test('ejecuta el flow en orden y genera artefactos (legacy incluidos)', async () => {
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
    expect(callOrder).toEqual(['sm', 'po', 'dev', 'qa', 'sm']);
    expect(ctx.state.sprints).toHaveLength(1);
    expect(ctx.state.currentSprint).toBe(1);
    expect(ctx.state.artifacts.implementations).toHaveLength(1);
    expect(ctx.state.artifacts.qaReports).toHaveLength(1);
    expect(ctx.state.artifacts.finalCode.files).toContain(path.join('app', 'index.js'));
    expect(await fs.pathExists(path.join(dir, 'final-app', 'app', 'index.js'))).toBe(true);
    expect(order).toContain('sprint_start');
  });

  test('emite exchanges con prompt+respuesta y los guarda en el artefacto', async () => {
    const seen = [];
    const ctx = makeCtx(dir, [], {
      flow: [{ role: 'dev', task: 'implementar' }]
    });
    const origEmit = ctx.emit;
    ctx.emit = (e, d) => {
      if (e === 'exchange') seen.push(d);
      return origEmit(e, d);
    };
    await runPipeline(ctx);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ role: 'dev', task: 'implementar', kind: 'step' });
    expect(seen[0].prompt).toMatch('Implementa el sprint');
    expect(seen[0].response).toMatch('implementation');
    expect(typeof seen[0].ms).toBe('number');
    const file = (await fs.readdir(path.join(dir, 'artifacts'))).find((f) => f.includes('-step-0-dev-implementar'));
    const saved = await fs.readJson(path.join(dir, 'artifacts', file));
    expect(saved.exchange.prompt).toMatch('Implementa el sprint');
    expect(saved.exchange.response).toMatch('implementation');
  });

  test('respeta la parada tras el sprint', async () => {
    const ctx = makeCtx(dir, [], { stopAfter: 1 });
    const res = await runPipeline(ctx);
    expect(res.stopped).toBe(true);
  });

  test('omite roles deshabilitados', async () => {
    const roles = ROLES.map((r) => (r.id === 'po' ? { ...r, enabled: false } : r));
    const ctx = makeCtx(dir, [], { roles });
    const res = await runPipeline(ctx);
    expect(res.stopped).toBe(false);
    expect(ctx.agents.po.calls).toHaveLength(0);
    expect(ctx.state.sprints).toHaveLength(1);
  });

  test('rol inexistente en el flow aborta (onError por defecto)', async () => {
    const ctx = makeCtx(dir, [], { flow: [{ role: 'fantasma', task: 'plan' }] });
    await expect(runPipeline(ctx)).rejects.toThrow(/desconocido/);
  });

  test('onError continue no aborta', async () => {
    const ctx = makeCtx(dir, [], {
      flow: [{ role: 'fantasma', task: 'plan', onError: 'continue' }, { role: 'sm', task: 'revisar' }]
    });
    const res = await runPipeline(ctx);
    expect(res.stopped).toBe(false);
    expect(ctx.state.sprints).toHaveLength(1);
  });

  test('loop QA->fix->QA itera hasta pasar y registra iterations', async () => {
    const order = [];
    const ctx = makeCtx(dir, order, {
      flow: [
        { role: 'dev', task: 'implementar' },
        {
          role: 'qa',
          task: 'probar',
          loop: { until: 'qa.passed', max: 3, fix: { role: 'dev', task: 'implementar' } }
        }
      ]
    });
    let qaCalls = 0;
    ctx.agents.qa.sendMessage = async () => {
      qaCalls += 1;
      return qaCalls === 1
        ? '{"qa":{"passed":false,"bugs":[{"severity":"critical","title":"b","detail":"d"}]}}'
        : '{"qa":{"passed":true,"bugs":[]}}';
    };
    const res = await runPipeline(ctx);
    expect(res.stopped).toBe(false);
    expect(qaCalls).toBe(2); // probar inicial + retry tras el fix
    const qaArtifact = ctx.state.artifacts.qaReports[0];
    expect(qaArtifact.iterations.map((i) => i.kind)).toEqual(['fix', 'retry']);
    expect(qaArtifact.iterations[0].role).toBe('dev');
    expect(ctx.state.artifacts.qaReports[0].passed).toBe(true);
  });

  test('loop agota max y avisa sin abortar', async () => {
    const ctx = makeCtx(dir, [], {
      flow: [
        {
          role: 'qa',
          task: 'probar',
          loop: { until: 'qa.passed', max: 2, fix: { role: 'dev', task: 'implementar' } }
        }
      ]
    });
    ctx.agents.qa.sendMessage = async () =>
      '{"qa":{"passed":false,"bugs":[{"severity":"critical","title":"b","detail":"d"}]}}';
    const res = await runPipeline(ctx);
    expect(res.stopped).toBe(false);
    // 2 rondas x (fix + retry) = 4 entradas
    expect(ctx.state.artifacts.qaReports[0].iterations).toHaveLength(4);
  });

  test('sin roles o sin flow falla claro', async () => {
    const ctx = makeCtx(dir, [], { roles: [] });
    await expect(runPipeline(ctx)).rejects.toThrow(/roles/);
    const ctx2 = makeCtx(dir, [], { flow: [] });
    await expect(runPipeline(ctx2)).rejects.toThrow(/flow/);
  });
});

describe('loopConditionMet', () => {
  test('condiciones basicas', () => {
    expect(loopConditionMet('qa.passed', { lastQa: { passed: true, bugs: [] } })).toBe(true);
    expect(loopConditionMet('qa.passed', { lastQa: { passed: false, bugs: [] } })).toBe(false);
    expect(loopConditionMet('qa.passed', {})).toBe(false);
    expect(loopConditionMet('noCriticalBugs', { lastQa: { bugs: [{ severity: 'minor' }] } })).toBe(true);
    expect(loopConditionMet('noCriticalBugs', { lastQa: { bugs: [{ severity: 'critical' }] } })).toBe(false);
    expect(loopConditionMet('filesWritten', { lastWritten: ['a.js'] })).toBe(true);
    expect(loopConditionMet('filesWritten', { lastWritten: [] })).toBe(false);
    expect(loopConditionMet('always', {})).toBe(false);
    expect(loopConditionMet('inventada', {})).toBe(true);
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
