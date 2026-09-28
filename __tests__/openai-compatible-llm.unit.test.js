const { normalizeV1Base } = require('../lib/openai-compatible-llm');

describe('lib/openai-compatible-llm', () => {
  test('normalizeV1Base añade /v1 si falta', () => {
    expect(normalizeV1Base('https://api.openai.com')).toBe('https://api.openai.com/v1');
  });

  test('normalizeV1Base respeta …/v1 y …/openai/v1', () => {
    expect(normalizeV1Base('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
    expect(normalizeV1Base('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1');
  });
});
