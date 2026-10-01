// __tests__/opencode-adapter.test.js - FASE 2: adapter opencode (sin motor real).
const http = require('http');
const {
  OpencodeAdapter,
  collectRunText,
  collectMessageText
} = require('../llm/opencode-adapter');
const { createAdapter } = require('../llm/factory');

describe('collectRunText', () => {
  test('extrae partes text e ignora ruido', () => {
    const stdout = [
      '{"type":"step","part":{"type":"text","text":"Hola "}}',
      'linea no json',
      '{"type":"step","part":{"type":"text","text":"mundo"}}',
      '{"type":"other","n":1}',
      ''
    ].join('\n');
    expect(collectRunText(stdout)).toBe('Hola mundo');
  });

  test('vacio si no hay texto', () => {
    expect(collectRunText('no json\n{"a":1}\n')).toBe('');
  });
});

describe('collectMessageText', () => {
  test('concatena parts text', () => {
    expect(
      collectMessageText({ parts: [{ type: 'text', text: 'a' }, { type: 'tool', text: 1 }, { type: 'text', text: 'b' }] })
    ).toBe('ab');
    expect(collectMessageText({})).toBe('');
    expect(collectMessageText(null)).toBe('');
  });
});

describe('factory', () => {
  test('defectos sensatos y override por config', () => {
    const d = createAdapter({});
    expect(d.mode).toBe('serve');
    expect(d.model).toBe('ollama/llama3.2');
    const c = createAdapter({ agents: { opencode: { mode: 'run', model: 'ollama/qwen3:8b', url: 'http://x:1' } } });
    expect(c.mode).toBe('run');
    expect(c.model).toBe('ollama/qwen3:8b');
    expect(c.url).toBe('http://x:1');
  });
});

describe('run mode (binario falso = node)', () => {
  test('resolveBinary respeta override explicito', async () => {
    const a = new OpencodeAdapter({ mode: 'run', command: 'node' });
    await expect(a.resolveBinary()).resolves.toBe('node');
  });
  test('health() ok con `node --version`', async () => {
    const a = new OpencodeAdapter({ mode: 'run', command: 'node', timeoutMs: 10000 });
    const h = await a.health();
    expect(h.ok).toBe(true);
    expect(h.mode).toBe('run');
    expect(h.version).toMatch(/v\d+\./);
  });

  test("stdin:'ignore' no rompe spawn (regresion cuelgue interactivo)", async () => {
    const { spawnSafe } = require('../utils/exec-safe');
    const r = await spawnSafe('node', ['--version'], { timeoutMs: 10000, stdin: 'ignore' });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/v\d+\./);
  });

  test('health() fallo con binario inexistente y hint util', async () => {
    const a = new OpencodeAdapter({ mode: 'run', command: 'opencode-no-existe-xyz', timeoutMs: 10000 });
    const h = await a.health();
    expect(h.ok).toBe(false);
    expect(h.hint).toMatch(/opencode/);
  });

  test('generate() exige prompt', async () => {
    const a = new OpencodeAdapter({ mode: 'run', command: 'node' });
    await expect(a.generate({})).rejects.toThrow(/prompt/);
  });

  test('signal ya abortada rechaza', async () => {
    const a = new OpencodeAdapter({ mode: 'run', command: 'node', timeoutMs: 10000 });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(a.generate({ prompt: 'hola', signal: ctrl.signal })).rejects.toThrow();
  });
});

describe('OpencodeAgent', () => {
  const OpencodeAgent = require('../agents/opencode-agent');

  test('trabaja dentro del outputDir (no la raiz del repo)', async () => {
    const seen = {};
    const fakeAdapter = {
      async generate(opts) {
        Object.assign(seen, opts);
        return { text: '{"ok":true}' };
      }
    };
    const agent = new OpencodeAgent({
      name: 'Dev',
      role: 'developer',
      persona: 'Eres dev.',
      adapter: fakeAdapter,
      dir: '/tmp/session-xxx'
    });
    const events = [];
    agent.on('log', (e) => events.push(e));
    const text = await agent.sendMessage('haz algo', true);
    expect(text).toBe('{"ok":true}');
    expect(seen.dir).toBe('/tmp/session-xxx');
    expect(seen.prompt).toMatch('Eres dev.');
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('serve mode (stub HTTP)', () => {
  let server;
  let url;
  let seen = {};

  beforeAll((done) => {
    seen = {};
    server = http
      .createServer((req, res) => {
        let body = '';
        req.on('data', (d) => {
          body += d;
        });
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          if (req.url === '/global/health') return res.end(JSON.stringify({ healthy: true, version: '9.9.9-test' }));
          if (req.url === '/session' && req.method === 'POST') {
            seen.sessionBody = JSON.parse(body || '{}');
            return res.end(JSON.stringify({ id: 'sess-test' }));
          }
          if (req.url === '/session/sess-test/message' && req.method === 'POST') {
            seen.messageBody = JSON.parse(body || '{}');
            return res.end(JSON.stringify({ info: {}, parts: [{ type: 'text', text: '{"ok":true}' }] }));
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'nope' }));
        });
      })
      .listen(0, '127.0.0.1', () => {
        url = `http://127.0.0.1:${server.address().port}`;
        done();
      });
  });

  afterAll((done) => {
    server.close(done);
  });

  test('health() ok contra stub', async () => {
    const a = new OpencodeAdapter({ mode: 'serve', url, timeoutMs: 5000 });
    const h = await a.health();
    expect(h).toEqual({ ok: true, mode: 'serve', version: '9.9.9-test' });
  });

  test('generate() crea sesion y extrae texto', async () => {
    const a = new OpencodeAdapter({ mode: 'serve', url, model: 'ollama/t', timeoutMs: 5000 });
    const { text } = await a.generate({ prompt: 'hola', title: 't' });
    expect(text).toBe('{"ok":true}');
    expect(seen.messageBody.parts).toEqual([{ type: 'text', text: 'hola' }]);
    expect(seen.messageBody.model).toBe('ollama/t');
  });

  test('health() fallo con URL muerta y hint util', async () => {
    const a = new OpencodeAdapter({ mode: 'serve', url: 'http://127.0.0.1:1', timeoutMs: 2000 });
    const h = await a.health();
    expect(h.ok).toBe(false);
    expect(h.hint).toMatch(/opencode serve/);
  });
});
