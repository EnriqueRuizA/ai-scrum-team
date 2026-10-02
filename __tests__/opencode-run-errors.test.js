// __tests__/opencode-run-errors.test.js - Errores de `opencode run` diagnosticables.
jest.mock('../utils/exec-safe', () => ({ spawnSafe: jest.fn() }));

const path = require('path');
const { spawnSafe } = require('../utils/exec-safe');
const { OpencodeAdapter, collectRunSessionID } = require('../llm/opencode-adapter');

function runAdapter() {
  // command != 'opencode': resolveBinary lo devuelve sin spawn.
  return new OpencodeAdapter({ mode: 'run', command: 'opencode-falso', model: 'ollama/x', dir: '/tmp', timeoutMs: 5000 });
}

describe('_generateRun: error con causa (stdout+stderr+modelo)', () => {
  beforeEach(() => spawnSafe.mockReset());

  test('code 1 con stderr vacio incluye el stdout y el modelo', async () => {
    spawnSafe.mockResolvedValue({
      code: 1,
      stdout: '{"type":"error","error":"ollama: modelo no cargado"}',
      stderr: ''
    });
    await expect(runAdapter().generate({ prompt: 'hola' })).rejects.toThrow(
      /opencode run fallo \(code 1, model=ollama\/x\):.*stderr vacio\..*stdout:.*ollama: modelo no cargado/
    );
  });

  test('incluye la cola de stderr cuando existe', async () => {
    spawnSafe.mockResolvedValue({ code: 1, stdout: '', stderr: 'Error: connection refused' });
    await expect(runAdapter().generate({ prompt: 'hola' })).rejects.toThrow(
      /stderr: Error: connection refused.*stdout vacio\./
    );
  });

  test('code 0 con texto JSON devuelve el texto', async () => {
    // collectRunText exige fragmentos con type text explicito.
    spawnSafe.mockResolvedValueOnce({
      code: 0,
      stdout: '{"type":"step","part":{"type":"text","text":"hola mundo"}}\n',
      stderr: ''
    });
    const { text } = await runAdapter().generate({ prompt: 'hola' });
    expect(text).toBe('hola mundo');
  });
});

describe('providerEnv: inyeccion al hijo (modo run)', () => {
  let savedEnv;
  beforeEach(() => {
    spawnSafe.mockReset();
    savedEnv = process.env.OPENCODE_CONFIG_CONTENT;
    delete process.env.OPENCODE_CONFIG_CONTENT;
  });
  afterEach(() => {
    if (savedEnv !== undefined) process.env.OPENCODE_CONFIG_CONTENT = savedEnv;
  });

  function okOnce() {
    spawnSafe.mockResolvedValueOnce({
      code: 0,
      stdout: '{"type":"step","part":{"type":"text","text":"ok"}}\n',
      stderr: ''
    });
  }

  test('inyecta OPENCODE_CONFIG_CONTENT con el provider del template', async () => {
    okOnce();
    const a = new OpencodeAdapter({ mode: 'run', command: 'opencode-falso', model: 'ollama/m', dir: '/tmp' });
    await a.generate({ prompt: 'hola' });
    const injected = spawnSafe.mock.calls[0][2].env.OPENCODE_CONFIG_CONTENT;
    expect(typeof injected).toBe('string');
    const parsed = JSON.parse(injected);
    expect(parsed.provider.ollama.npm).toBe('@ai-sdk/openai-compatible');
    expect(parsed.provider.ollama.options.baseURL).toBe('http://127.0.0.1:11434/v1');
    expect(parsed.model).toBeUndefined(); // el flag --model manda
  });

  test('respeta OPENCODE_CONFIG_CONTENT ya existente (extraEnv)', async () => {
    okOnce();
    const a = new OpencodeAdapter({
      mode: 'run',
      command: 'opencode-falso',
      model: 'ollama/m',
      dir: '/tmp',
      env: { OPENCODE_CONFIG_CONTENT: '{"provider":{"x":{}}}' }
    });
    await a.generate({ prompt: 'hola' });
    expect(spawnSafe.mock.calls[0][2].env.OPENCODE_CONFIG_CONTENT).toBe('{"provider":{"x":{}}}');
  });

  test('sin template no inyecta nada', async () => {
    okOnce();
    const a = new OpencodeAdapter({
      mode: 'run',
      command: 'opencode-falso',
      model: 'ollama/m',
      dir: '/tmp',
      providerTemplate: null
    });
    await a.generate({ prompt: 'hola' });
    expect(spawnSafe.mock.calls[0][2].env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });

  test('template inexistente no rompe (comportamiento antiguo)', async () => {
    okOnce();
    const a = new OpencodeAdapter({
      mode: 'run',
      command: 'opencode-falso',
      model: 'ollama/m',
      dir: '/tmp',
      providerTemplate: '/ruta/que/no/existe.json'
    });
    await a.generate({ prompt: 'hola' });
    expect(spawnSafe.mock.calls[0][2].env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

describe('sesion reutilizada (una por agente, sin duplicadas)', () => {
  beforeEach(() => spawnSafe.mockReset());

  function runEvent(sessionID, text) {
    return [
      `{"type":"step_start","sessionID":"${sessionID}"}`,
      `{"type":"text","part":{"type":"text","text":"${text}"}}`
    ].join('\n');
  }

  test('collectRunSessionID extrae el primero', () => {
    expect(collectRunSessionID(runEvent('ses_abc', 'hola'))).toBe('ses_abc');
    expect(collectRunSessionID('no json\n{"a":1}\n')).toBeNull();
    expect(collectRunSessionID('')).toBeNull();
  });

  test('buildRunArgs: sin sessionID no hay --session; con el, continua', () => {
    const a = new OpencodeAdapter({ mode: 'run', model: 'm', dir: '/tmp' });
    expect(a.buildRunArgs({ prompt: 'h' })).not.toContain('--session');
    const args = a.buildRunArgs({ prompt: 'h', sessionID: 'ses_1' });
    expect(args).toContain('--session');
    expect(args[args.indexOf('--session') + 1]).toBe('ses_1');
  });

  test('generate devuelve sessionID y la 2a llamada continua', async () => {
    const a = new OpencodeAdapter({ mode: 'run', command: 'opencode-falso', model: 'm', dir: '/tmp', timeoutMs: 5000 });
    spawnSafe.mockResolvedValueOnce({ code: 0, stdout: runEvent('ses_9', 'uno'), stderr: '' });
    const r1 = await a.generate({ prompt: 'hola', title: 't' });
    expect(r1.sessionID).toBe('ses_9');
    expect(spawnSafe.mock.calls[0][1]).not.toContain('--session');
    spawnSafe.mockResolvedValueOnce({ code: 0, stdout: runEvent('ses_9', 'dos'), stderr: '' });
    const r2 = await a.generate({ prompt: 'otra', title: 't', sessionID: r1.sessionID });
    expect(r2.sessionID).toBe('ses_9');
    const args2 = spawnSafe.mock.calls[1][1];
    expect(args2[args2.indexOf('--session') + 1]).toBe('ses_9');
  });

  test('OpencodeAgent: una sesion por agente, titulo con proyecto, reset explicito', async () => {
    const OpencodeAgent = require('../agents/opencode-agent');
    const seen = [];
    const fakeAdapter = {
      async generate(opts) {
        seen.push({ ...opts });
        return { text: 'ok', sessionID: 'ses_agent_1' };
      }
    };
    const agent = new OpencodeAgent({
      name: 'Dev',
      role: 'developer',
      persona: 'x',
      adapter: fakeAdapter,
      dir: '/tmp/session-abc'
    });
    await agent.sendMessage('primero', true);
    await agent.sendMessage('segundo');
    expect(seen).toHaveLength(2);
    expect(seen[0].sessionID).toBeUndefined();
    expect(seen[1].sessionID).toBe('ses_agent_1');
    expect(seen[0].title).toBe('developer [session-abc]');
    expect(agent.sessionID).toBe('ses_agent_1');
    await agent.startNewConversation();
    expect(agent.sessionID).toBeNull();
  });

  test('serve: reutiliza la sesion sin crear otra (fetch mock)', async () => {
    const calls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push(String(url));
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (String(url).endsWith('/session')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ id: 'sess-1' }) };
      if (String(url).includes('/session/sess-1/message')) {
        if (body.title) throw new Error('no debe recrear sesion con title');
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ parts: [{ type: 'text', text: 'ok' }] }) };
      }
      throw new Error('URL inesperada ' + url);
    };
    try {
      const a = new OpencodeAdapter({ mode: 'serve', url: 'http://127.0.0.1:9', model: 'm', timeoutMs: 5000 });
      const r1 = await a.generate({ prompt: 'hola', title: 'dev' });
      expect(r1.sessionID).toBe('sess-1');
      const r2 = await a.generate({ prompt: 'otra', sessionID: r1.sessionID });
      expect(r2.sessionID).toBe('sess-1');
      expect(calls.filter((u) => u.endsWith('/session'))).toHaveLength(1);
      expect(calls.filter((u) => u.includes('/message'))).toHaveLength(2);
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe('buildRunArgs: dir determinista', () => {
  test('absoluta se respeta tal cual', () => {
    const a = new OpencodeAdapter({ mode: 'run', model: 'm', dir: '/tmp/base' });
    const args = a.buildRunArgs({ prompt: 'h' });
    expect(args[args.indexOf('--dir') + 1]).toBe('/tmp/base');
  });

  test('relativa se resuelve a absoluta (no depende del cwd futuro)', () => {
    const a = new OpencodeAdapter({ mode: 'run', model: 'm', dir: '/tmp/base' });
    const args = a.buildRunArgs({ prompt: 'h', dir: path.join('outputs', 'session-abc') });
    expect(args[args.indexOf('--dir') + 1]).toBe(path.resolve(path.join('outputs', 'session-abc')));
  });
});
