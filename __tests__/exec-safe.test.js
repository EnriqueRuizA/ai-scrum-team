// __tests__/exec-safe.test.js - FASE 4: spawn sin shell.
const { spawnSafe } = require('../utils/exec-safe');

describe('spawnSafe', () => {
  test('ejecuta y captura stdout/stderr/code', async () => {
    const r = await spawnSafe('node', ['--version'], { timeoutMs: 10000 });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/v\d+\./);
  });

  test('rechaza comando vacio y args no-string', async () => {
    await expect(spawnSafe('', ['x'])).rejects.toThrow(/vacio/);
    await expect(spawnSafe('node', [123])).rejects.toThrow(/strings/);
  });

  test('timeout mata y reporta EXEC_TIMEOUT', async () => {
    const start = Date.now();
    await expect(
      spawnSafe('node', ['-e', 'setTimeout(()=>{}, 60000)'], { timeoutMs: 800 })
    ).rejects.toMatchObject({ code: 'EXEC_TIMEOUT' });
    expect(Date.now() - start).toBeLessThan(15000);
  });

  test('abort externo cancela', async () => {
    const ctrl = new AbortController();
    const p = spawnSafe('node', ['-e', 'setTimeout(()=>{}, 60000)'], { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/abort/);
  });

  test('binario inexistente rechaza (no cuelga)', async () => {
    await expect(spawnSafe('binario-que-no-existe-xyz', [], { timeoutMs: 5000 })).rejects.toThrow();
  });

  test("stdin:'ignore' aceptado", async () => {
    const r = await spawnSafe('node', ['--version'], { timeoutMs: 10000, stdin: 'ignore' });
    expect(r.code).toBe(0);
  });
});
