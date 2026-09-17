jest.mock('../lib/openai-compatible-llm', () => ({
  requestOpenAICompat: jest.fn()
}));

const { requestOpenAICompat } = require('../lib/openai-compatible-llm');
const { listModels, normalizeCursorApiOrigin } = require('../lib/cursor-cloud-llm');

describe('lib/cursor-cloud-llm', () => {
  beforeEach(() => {
    requestOpenAICompat.mockReset();
  });

  test('normalizeCursorApiOrigin usa host de la URL', () => {
    expect(normalizeCursorApiOrigin('https://api.cursor.com/v0/foo')).toBe('https://api.cursor.com');
  });

  test('listModels llama GET /v0/models y mapea models[]', async () => {
    requestOpenAICompat.mockResolvedValue({
      models: ['claude-4-sonnet-thinking', 'gpt-5.2']
    });
    const r = await listModels('https://api.cursor.com', { authHeaders: { Authorization: 'Basic eDp' } });
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(['claude-4-sonnet-thinking', 'gpt-5.2']);
    expect(requestOpenAICompat).toHaveBeenCalledWith(
      'https://api.cursor.com/v0/models',
      expect.objectContaining({ method: 'GET', errorPrefix: 'Cursor Cloud models' })
    );
  });

  test('listModels ok: false si la petición falla', async () => {
    requestOpenAICompat.mockRejectedValue(new Error('401 boo'));
    const r = await listModels('https://api.cursor.com', { authHeaders: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401 boo/);
  });
});
