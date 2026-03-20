const {
  parseLlmJsonResponse,
  extractBalancedObject,
  indexAfterMarkdownFence
} = require('../lib/parse-llm-json');

describe('lib/parse-llm-json', () => {
  test('parsea JSON en bloque ```json con objetos anidados', () => {
    const raw = `Aquí tienes el diseño:

\`\`\`json
{
  "implementation": {
    "architecture": "Microservices",
    "files": [
      { "path": "a.js", "code": "export const x = { y: 1 };" }
    ]
  }
}
\`\`\`
`;
    const p = parseLlmJsonResponse(raw);
    expect(p).not.toBeNull();
    expect(p.implementation.files).toHaveLength(1);
    expect(p.implementation.files[0].path).toBe('a.js');
  });

  test('no se corta en el primer } interno (regex antiguo fallaba)', () => {
    const inner = { outer: { inner: { a: 1 } } };
    const s = JSON.stringify(inner);
    const p = parseLlmJsonResponse(s);
    expect(p).toEqual(inner);
  });

  test('extrae objeto balanceado con llaves en string', () => {
    const str = `{ "code": "if (true) { return 1; }", "ok": true }`;
    const p = parseLlmJsonResponse(str);
    expect(p.ok).toBe(true);
    expect(p.code).toContain('return 1');
  });

  test('indexAfterMarkdownFence salta el encabezado del fence', () => {
    const t = '```json\n{"x":1}\n```';
    const after = indexAfterMarkdownFence(t);
    expect(t.slice(after).trim().startsWith('{')).toBe(true);
  });

  test('extractBalancedObject devuelve null si no hay cierre', () => {
    expect(extractBalancedObject('{ "a": 1 ', 0)).toBeNull();
  });

  test('JSON plano sin fence', () => {
    expect(parseLlmJsonResponse('  {"a": [1,2,3]}  ')).toEqual({ a: [1, 2, 3] });
  });

  test('primer ``` no es JSON: encuentra el bloque ```json siguiente', () => {
    const raw = `Nota:

\`\`\`
echo hello
\`\`\`

Respuesta:

\`\`\`json
{"role":"sm","message":"ok","artifacts":[]}
\`\`\`
`;
    const p = parseLlmJsonResponse(raw);
    expect(p).not.toBeNull();
    expect(p.role).toBe('sm');
    expect(p.artifacts).toEqual([]);
  });

  test('bloque ```json sin cerrar fence: sigue parseando', () => {
    const raw = `Salida:

\`\`\`json
{"x":1,"y":{"z":2}}
`;
    expect(parseLlmJsonResponse(raw)).toEqual({ x: 1, y: { z: 2 } });
  });

  test('coma final en objeto: reparación simple', () => {
    const raw = `\`\`\`json
{"a": 1, "b": 2,}
\`\`\``;
    expect(parseLlmJsonResponse(raw)).toEqual({ a: 1, b: 2 });
  });

  test('array raíz con varios fences', () => {
    const raw = 'texto\n```json\n[1,2,3]\n```';
    expect(parseLlmJsonResponse(raw)).toEqual([1, 2, 3]);
  });

  test('BOM UTF-8 no rompe el parse', () => {
    const bom = '\uFEFF';
    expect(parseLlmJsonResponse(`${bom}{"k":true}`)).toEqual({ k: true });
  });
});
