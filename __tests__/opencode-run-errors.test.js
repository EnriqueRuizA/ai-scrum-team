// __tests__/opencode-run-errors.test.js - Errores de `opencode run` diagnosticables.
jest.mock('../utils/exec-safe', () => ({ spawnSafe: jest.fn() }));

const path = require('path');
const { spawnSafe } = require('../utils/exec-safe');
const { OpencodeAdapter } = require('../llm/opencode-adapter');

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
