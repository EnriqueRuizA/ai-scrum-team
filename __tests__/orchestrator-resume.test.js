// __tests__/orchestrator-resume.test.js - Sesiones como proyectos activos.
const ScrumMasterOrchestrator = require('../orchestrator');

function savedError() {
  return {
    sessionId: 'abc-123',
    status: 'error',
    currentSprint: 0,
    maxSprints: 5,
    sprints: [],
    artifacts: {
      prd: null,
      architecture: null,
      testPlan: null,
      sprintPlan: null,
      implementations: [],
      qaReports: [],
      finalCode: null
    },
    logs: [
      { timestamp: '2026-10-02T15:38:08.828Z', agent: 'Carlos (Scrum Master)', level: 'info', message: 'Enviando mensaje (2275 chars)...' },
      { timestamp: '2026-10-02T15:38:11.029Z', agent: 'ScrumMaster', level: 'error', message: 'Paso 0 (scrumMaster/plan) fallo: opencode run fallo (code 1)' }
    ],
    errors: [{ timestamp: '2026-10-02T15:38:11.029Z', agent: 'ScrumMaster', message: 'opencode run fallo (code 1)' }],
    runPaused: false
  };
}

const CONFIG = {
  scrum: { maxSprints: 5 },
  agents: { backend: 'local', opencode: { mode: 'run', model: 'ollama/m' } }
};

describe('ScrumMasterOrchestrator.resume', () => {
  test('adopta el estado guardado y queda listo para continuar', () => {
    const o = ScrumMasterOrchestrator.resume({
      savedState: savedError(),
      outputDir: './outputs/session-abc',
      config: CONFIG,
      credentials: {}
    });
    expect(o.sessionId).toBe('abc-123');
    expect(o.outputDir).toBe('./outputs/session-abc');
    expect(o.state.status).toBe('ready');
    expect(o.state.logs).toHaveLength(2);
    expect(o.state.errors).toHaveLength(1);
    expect(o.state.currentSprint).toBe(0);
  });

  test('conserva sprints ya hechos', () => {
    const saved = savedError();
    saved.currentSprint = 2;
    saved.sprints = [{ n: 1 }, { n: 2 }];
    const o = ScrumMasterOrchestrator.resume({
      savedState: saved,
      outputDir: './outputs/session-abc',
      config: CONFIG,
      credentials: {}
    });
    expect(o.state.sprints).toHaveLength(2);
    expect(o.state.currentSprint).toBe(2);
  });

  test('usa maxSprints del estado si la config no lo trae', () => {
    const o = ScrumMasterOrchestrator.resume({
      savedState: savedError(),
      outputDir: './outputs/session-abc',
      config: {},
      credentials: {}
    });
    expect(o.state.maxSprints).toBe(5);
  });

  test('rechaza estado invalido', () => {
    expect(() =>
      ScrumMasterOrchestrator.resume({ savedState: null, outputDir: 'x', config: {}, credentials: {} })
    ).toThrow(/invalido/);
  });

  test('runFullProject rechaza la sesion ya completa sin tocar agentes', async () => {
    const saved = savedError();
    saved.currentSprint = 5;
    saved.sprints = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }];
    const o = ScrumMasterOrchestrator.resume({
      savedState: saved,
      outputDir: './outputs/session-abc',
      config: CONFIG,
      credentials: {}
    });
    await expect(o.runFullProject()).rejects.toThrow(/ya complet/);
  });
});
