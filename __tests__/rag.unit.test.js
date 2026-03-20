const { chunkText, cosineSimilarity } = require('../lib/rag');

describe('lib/rag', () => {
  test('chunkText splits long text into multiple chunks with minimum length', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkText(text, { chunkSize: 200, overlap: 20 });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every(c => typeof c === 'string' && c.length > 20)).toBe(true);
  });

  test('cosineSimilarity is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 8);
  });

  test('cosineSimilarity is 0 when one vector is all zeros', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBeCloseTo(0, 8);
  });
});

