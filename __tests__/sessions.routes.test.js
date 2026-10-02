// __tests__/sessions.routes.test.js - Gestor de proyectos (resumen + borrado).
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createServer } = require('../server/app');

const ORIG_CWD = process.cwd();
let cwd;
let app;

function stateFixture(over = {}) {
  return {
    sessionId: 'x',
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
    logs: [],
    errors: [{ timestamp: 't', agent: 'a', message: 'm' }],
    runPaused: false,
    ...over
  };
}

beforeAll(() => {
  ({ app } = createServer());
});

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sessroutes-'));
  await fs.ensureDir(path.join(cwd, 'outputs'));
  process.chdir(cwd);
});

afterEach(async () => {
  process.chdir(ORIG_CWD);
  await fs.remove(cwd);
});

describe('GET /api/sessions (resumen gestionable)', () => {
  test('vacio sin sesiones', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('incluye summary con nombre del state', async () => {
    await fs.outputJson('outputs/session-aaa/state.json', stateFixture({ projectName: 'MiProj' }));
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].summary).toMatchObject({
      id: 'session-aaa',
      projectName: 'MiProj',
      status: 'error',
      currentSprint: 0,
      maxSprints: 5,
      sprintsDone: 0,
      errorsCount: 1,
      _activeRun: false
    });
  });

  test('nombre desde snapshot si el state no lo trae', async () => {
    await fs.outputJson('outputs/session-bbb/state.json', stateFixture());
    await fs.outputJson('outputs/session-bbb/config.snapshot.json', { project: { name: 'SnapProj' } });
    const res = await request(app).get('/api/sessions');
    const row = res.body.find((r) => r.id === 'session-bbb');
    expect(row.summary.projectName).toBe('SnapProj');
  });

  test('carpeta sin state.json sale como error', async () => {
    await fs.ensureDir('outputs/session-ccc');
    const res = await request(app).get('/api/sessions');
    const row = res.body.find((r) => r.id === 'session-ccc');
    expect(row.error).toBe('No state file');
  });
});

describe('DELETE /api/sessions/:id', () => {
  test('borra la carpeta y limpia el puntero', async () => {
    await fs.outputJson('outputs/session-aaa/state.json', stateFixture());
    await fs.outputJson('outputs/.last-dashboard-session.json', { outputFolder: 'session-aaa' });
    const res = await request(app).delete('/api/sessions/session-aaa');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 'session-aaa' });
    expect(await fs.pathExists('outputs/session-aaa')).toBe(false);
    expect(await fs.pathExists('outputs/.last-dashboard-session.json')).toBe(false);
  });

  test('segundo borrado es 404; id invalido es 400', async () => {
    await fs.outputJson('outputs/session-aaa/state.json', stateFixture());
    expect((await request(app).delete('/api/sessions/session-aaa')).status).toBe(200);
    expect((await request(app).delete('/api/sessions/session-aaa')).status).toBe(404);
    expect((await request(app).delete('/api/sessions/no-valido')).status).toBe(400);
  });
});

describe('POST /api/sessions/:id/resume (validaciones sin arrancar motor)', () => {
  test('completada no se reanuda', async () => {
    await fs.outputJson('outputs/session-aaa/state.json', stateFixture({ status: 'completed', currentSprint: 5 }));
    await fs.outputJson('config/project-config.json', { scrum: { maxSprints: 5 } });
    const res = await request(app).post('/api/sessions/session-aaa/resume').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/complet/);
  });

  test('inexistente es 404', async () => {
    const res = await request(app).post('/api/sessions/session-zzz/resume').send({});
    expect(res.status).toBe(404);
  });
});
