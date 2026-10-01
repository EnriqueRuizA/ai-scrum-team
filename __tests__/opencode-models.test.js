// __tests__/opencode-models.test.js - parseo de `opencode models --verbose`.
const { parseModelsVerbose } = require('../llm/opencode-models');

const FIXTURE = [
  'opencode/muse-spark-1.3-contributor-free',
  '{',
  '  "id": "muse-spark-1.3-contributor-free",',
  '  "name": "Muse Spark",',
  '  "variants": {',
  '    "minimal": { "reasoningEffort": "minimal" },',
  '    "xhigh": { "reasoningEffort": "xhigh" }',
  '  }',
  '}',
  'opencode/big-pickle',
  '{',
  '  "id": "big-pickle",',
  '  "variants": {}',
  '}',
  'ollama/qwen3.5:9b',
  '{',
  '  "id": "qwen3.5:9b",',
  '  "variants": { "none": { "reasoningEffort": "none" } }',
  '}',
  'linea-basura-sin-formato',
  'opencode/roto',
  '{ no es json'
].join('\n');

describe('parseModelsVerbose', () => {
  test('extrae ids, providers y variantes (none = sin variantes)', () => {
    const out = parseModelsVerbose(FIXTURE);
    expect(out).toHaveLength(3);
    const spark = out.find((m) => m.id === 'opencode/muse-spark-1.3-contributor-free');
    expect(spark.provider).toBe('opencode');
    expect(spark.name).toBe('Muse Spark');
    expect(spark.variants).toEqual(['minimal', 'xhigh']);
    expect(out.find((m) => m.id === 'opencode/big-pickle').variants).toEqual([]);
    expect(out.find((m) => m.id === 'ollama/qwen3.5:9b').variants).toEqual([]);
  });

  test('vacio y basura devuelven []', () => {
    expect(parseModelsVerbose('')).toEqual([]);
    expect(parseModelsVerbose(null)).toEqual([]);
    expect(parseModelsVerbose('sin formato\n')).toEqual([]);
  });
});
