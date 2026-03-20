const { checkHealth } = require('../lib/local-llm');

describe('lib/local-llm', () => {
  test('checkHealth returns ok:false when /api/tags fails', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(checkHealth('http://localhost:11434', 'llama3.2')).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('ECONNREFUSED') })
    );
    global.fetch = originalFetch;
  });

  test('checkHealth returns modelLoaded:false when model missing', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'mistral:latest' }] })
    });
    await expect(checkHealth('http://localhost:11434', 'llama3.2')).resolves.toEqual(
      expect.objectContaining({ ok: true, modelLoaded: false })
    );
    global.fetch = originalFetch;
  });
});

