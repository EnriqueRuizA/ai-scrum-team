// __tests__/server.guards.test.js - FASE 3: traversal, allowlists y pollution.
const path = require('path');
const {
  validateSessionId,
  validateArtifactName,
  safeJoin,
  isSafeKey,
  sanitizeKeys,
  escHtml
} = require('../server/guards');
const { limitStateLogs, DEFAULT_STATE_LOGS, MAX_STATE_LOGS } = require('../server/helpers');

describe('validateSessionId', () => {
  test('acepta ids validos', () => {
    expect(validateSessionId('session-abc123')).toBe(true);
    expect(validateSessionId('session-a-b-c-1')).toBe(true);
  });
  test('rechaza traversal y rarezas', () => {
    for (const bad of [
      '../config/credentials',
      '..%2F..%2Fconfig',
      'session-../../x',
      'session-',
      'SESSION-abc',
      '',
      null,
      undefined,
      123,
      'session-' + 'a'.repeat(65)
    ]) {
      expect(validateSessionId(bad)).toBe(false);
    }
  });
});

describe('validateArtifactName', () => {
  test('acepta nombres normales', () => {
    expect(validateArtifactName('sprint-1-plan')).toBe(true);
    expect(validateArtifactName('final-code')).toBe(true);
  });
  test('rechaza traversal y extension inyectada', () => {
    expect(validateArtifactName('../../x')).toBe(false);
    expect(validateArtifactName('a/b')).toBe(false);
    expect(validateArtifactName('.json')).toBe(false);
  });
});

describe('safeJoin', () => {
  test('une dentro de base', () => {
    const base = path.join('outputs');
    const p = safeJoin(base, 'session-abc', 'state.json');
    expect(p.endsWith(path.join('session-abc', 'state.json'))).toBe(true);
  });
  test('lanza ante traversal aunque el prefijo coincida', () => {
    expect(() => safeJoin('./outputs', '..', 'config', 'x.json')).toThrow();
    expect(() => safeJoin('./outputs', 'session-abc', '..', '..', 'x')).toThrow();
    expect(() => safeJoin('./outputs', '/etc/passwd')).toThrow();
  });
});

describe('anti prototype-pollution', () => {
  test('isSafeKey filtra peligrosas', () => {
    expect(isSafeKey('__proto__')).toBe(false);
    expect(isSafeKey('constructor')).toBe(false);
    expect(isSafeKey('prototype')).toBe(false);
    expect(isSafeKey('gmail')).toBe(true);
  });
  test('sanitizeKeys las elimina', () => {
    const out = sanitizeKeys(JSON.parse('{"a":1,"__proto__":{"x":1}}'));
    expect(out.a).toBe(1);
    expect({}.x).toBeUndefined();
  });
});

describe('escHtml', () => {
  test('escapa &<>"\'', () => {
    expect(escHtml('<img src=x onerror="a\'b">')).toBe('&lt;img src=x onerror=&quot;a&#39;b&quot;&gt;');
  });
});

describe('limitStateLogs (FASE 6)', () => {
  const mk = (n) =>
    Array.from({ length: n }, (_, i) => ({
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      agent: 't',
      level: 'info',
      message: `m${i}`
    }));

  test('defecto: ultimos 500 con metadatos', () => {
    const out = limitStateLogs({ logs: mk(700) }, {});
    expect(out.logs).toHaveLength(DEFAULT_STATE_LOGS);
    expect(out.logs[0].message).toBe('m200');
    expect(out._logsTotal).toBe(700);
    expect(out._logsLimited).toBe(true);
  });

  test('logs=0 devuelve todos; tope en 5000', () => {
    expect(limitStateLogs({ logs: mk(10) }, { logs: '0' }).logs).toHaveLength(10);
    expect(limitStateLogs({ logs: mk(10) }, { logs: '999999' }).logs).toHaveLength(10);
    expect(limitStateLogs({ logs: mk(10) }, { logs: '3' }).logs.map((e) => e.message)).toEqual(['m7', 'm8', 'm9']);
  });

  test('since filtra por timestamp', () => {
    const out = limitStateLogs({ logs: mk(10) }, { logs: '0', since: '2026-01-01T00:00:05Z' });
    expect(out.logs.map((e) => e.message)).toEqual(['m5', 'm6', 'm7', 'm8', 'm9']);
    expect(out._logsLimited).toBe(true);
  });

  test('valores invalidos no rompen (usan defecto)', () => {
    expect(limitStateLogs({ logs: mk(600) }, { logs: 'abc' }).logs).toHaveLength(500);
    expect(limitStateLogs({ logs: mk(600) }, { logs: '-5' }).logs).toHaveLength(500);
    expect(limitStateLogs(null, {})).toBeNull();
    expect(limitStateLogs({ nologs: true }, {})).toEqual(
      expect.objectContaining({ _logsTotal: 0, _logsLimited: false })
    );
  });

  test('MAX_STATE_LOGS es 5000', () => {
    expect(MAX_STATE_LOGS).toBe(5000);
  });
});
