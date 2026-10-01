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
