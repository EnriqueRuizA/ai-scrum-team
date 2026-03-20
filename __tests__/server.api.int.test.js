const request = require('supertest');

jest.mock('fs-extra', () => {
  const actual = jest.requireActual('fs-extra');
  return {
    ...actual,
    readJson: jest.fn(),
    writeJson: jest.fn(),
    pathExists: jest.fn()
  };
});

jest.mock('../orchestrator', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    getState: jest.fn().mockReturnValue({ status: 'idle', sprints: [], logs: [] }),
    initialize: jest.fn().mockResolvedValue(undefined),
    runFullProject: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
    state: { sessionId: 'test-session' }
  }));
});

jest.mock('../lib/local-llm', () => {
  const actual = jest.requireActual('../lib/local-llm');
  return {
    ...actual,
    checkHealth: jest.fn()
  };
});

const fs = require('fs-extra');
const { checkHealth } = require('../lib/local-llm');
const { createServer } = require('../server');

describe('server API (integration)', () => {
  test('GET /api/config returns config and safe credentials', async () => {
    fs.readJson.mockImplementation(async (p) => {
      if (String(p).includes('project-config.json')) return { project: { name: 'X' }, outputs: { port: 3000 } };
      if (String(p).includes('credentials.json')) return { claude: { email: 'a@b.com', password: 'secret' } };
      throw new Error('unexpected path ' + p);
    });

    const { app } = createServer();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.config.project.name).toBe('X');
    expect(res.body.credentials.claude).toEqual({
      email: 'a@b.com',
      hasPassword: true,
      configured: true
    });
  });

  test('GET /api/config: Claude configured with email only (magic link)', async () => {
    fs.readJson.mockImplementation(async (p) => {
      if (String(p).includes('project-config.json')) return { project: { name: 'X' } };
      if (String(p).includes('credentials.json')) return { claude: { email: 'solo@mail.com', note: 'x' } };
      throw new Error('unexpected path ' + p);
    });
    const { app } = createServer();
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.credentials.claude).toEqual({
      email: 'solo@mail.com',
      hasPassword: false,
      configured: true
    });
  });

  test('POST /api/config deep-merges agents (no borra backend local)', async () => {
    const current = {
      project: { name: 'A', description: 'd', version: '1' },
      scrum: { maxSprints: 5 },
      agents: { backend: 'local', local: { baseUrl: 'http://localhost:11434', model: 'm1', rag: { enabled: true, topK: 5 } } },
      outputs: { port: 3000 }
    };
    fs.readJson.mockImplementation(async (p) => {
      if (String(p).includes('project-config.json')) return JSON.parse(JSON.stringify(current));
      return {};
    });
    fs.writeJson.mockResolvedValue(undefined);
    const { app } = createServer();
    const res = await request(app)
      .post('/api/config')
      .send({ project: { name: 'B' }, agents: { headless: true, shareSession: false } });
    expect(res.status).toBe(200);
    const written = fs.writeJson.mock.calls.find((c) => String(c[0]).includes('project-config'))?.[1];
    expect(written.agents.backend).toBe('local');
    expect(written.agents.local.model).toBe('m1');
    expect(written.agents.headless).toBe(true);
    expect(written.project.name).toBe('B');
    expect(written.project.description).toBe('d');
  });

  test('POST /api/credentials writes merged credentials', async () => {
    fs.readJson.mockResolvedValue({ claude: { email: 'old', password: 'oldpass' } });
    fs.writeJson.mockResolvedValue(undefined);

    const { app } = createServer();
    const res = await request(app).post('/api/credentials').send({ claude: { email: 'new', password: 'newpass' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(fs.writeJson).toHaveBeenCalled();
    const [, written] = fs.writeJson.mock.calls[0];
    expect(written.claude.email).toBe('new');
    expect(written.claude.password).toBe('newpass');
  });

  test('POST /api/start (local) returns 400 if model missing', async () => {
    fs.readJson.mockResolvedValue({
      agents: { backend: 'local', local: { baseUrl: 'http://localhost:11434', model: 'llama3.2' } }
    });
    checkHealth.mockResolvedValue({ ok: true, modelLoaded: false });

    const { app } = createServer();
    const res = await request(app).post('/api/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/modelo "llama3\.2".*ollama pull llama3\.2/i);
  });

  test('POST /api/start (claude) allows email without password', async () => {
    fs.readJson.mockImplementation(async (p) => {
      if (String(p).includes('project-config.json')) {
        return { agents: { backend: 'claude' }, project: { description: 'd' }, scrum: { maxSprints: 1 } };
      }
      if (String(p).includes('credentials.json')) {
        return { claude: { email: 'user@example.com' } };
      }
      throw new Error('unexpected path ' + p);
    });
    const { app } = createServer();
    const res = await request(app).post('/api/start').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/start (local) returns 200 when health OK', async () => {
    fs.readJson.mockResolvedValue({
      project: { description: 'desc' },
      scrum: { maxSprints: 1 },
      agents: { backend: 'local', local: { baseUrl: 'http://localhost:11434', model: 'llama3.2' } }
    });
    checkHealth.mockResolvedValue({ ok: true, modelLoaded: true });

    const { app } = createServer();
    const res = await request(app).post('/api/start').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Proyecto iniciado' });
  });
});

