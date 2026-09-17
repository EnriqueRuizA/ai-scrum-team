const {
  resolveHttpAdapterFromLocal,
  getPreset,
  baseUrlImpliesOpenAiCompatible
} = require('../lib/llm-provider-presets');

describe('lib/llm-provider-presets', () => {
  test('baseUrlImpliesOpenAiCompatible detecta sufijo /v1', () => {
    expect(baseUrlImpliesOpenAiCompatible('https://api.openai.com/v1')).toBe(true);
    expect(baseUrlImpliesOpenAiCompatible('https://api.openai.com/v1/')).toBe(true);
    expect(baseUrlImpliesOpenAiCompatible('http://localhost:11434')).toBe(false);
  });

  test('resolveHttpAdapterFromLocal usa httpAdapter explícito', () => {
    expect(resolveHttpAdapterFromLocal({ httpAdapter: 'openai_compatible' })).toBe('openai_compatible');
    expect(resolveHttpAdapterFromLocal({ httpAdapter: 'cursor_cloud' })).toBe('cursor_cloud');
    expect(resolveHttpAdapterFromLocal({ httpAdapter: 'ollama' })).toBe('ollama');
  });

  test('resolveHttpAdapterFromLocal: preset cursor_cloud', () => {
    expect(resolveHttpAdapterFromLocal({ providerPreset: 'cursor_cloud' })).toBe('cursor_cloud');
    expect(getPreset('cursor_cloud')?.httpAdapter).toBe('cursor_cloud');
    expect(getPreset('cursor_cloud')?.apiKeyMode).toBe('basic');
  });

  test('resolveHttpAdapterFromLocal: ollama + URL …/v1 fuerza openai_compatible (evita /api/tags 404)', () => {
    expect(
      resolveHttpAdapterFromLocal({
        httpAdapter: 'ollama',
        baseUrl: 'https://api.openai.com/v1'
      })
    ).toBe('openai_compatible');
    expect(
      resolveHttpAdapterFromLocal({
        providerPreset: 'ollama_local',
        baseUrl: 'https://api.openai.com/v1'
      })
    ).toBe('openai_compatible');
  });

  test('resolveHttpAdapterFromLocal deriva de providerPreset', () => {
    expect(resolveHttpAdapterFromLocal({ providerPreset: 'openai' })).toBe('openai_compatible');
    expect(resolveHttpAdapterFromLocal({ providerPreset: 'ollama_local' })).toBe('ollama');
  });

  test('getPreset', () => {
    expect(getPreset('deepseek')?.defaultModel).toBe('deepseek-chat');
  });
});
