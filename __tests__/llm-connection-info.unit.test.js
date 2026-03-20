const {
  buildLlmConnectionInfo,
  inferPresetFromUrl,
  formatLlmConnectionLogBlock,
  formatLlmRequestOneLiner
} = require('../lib/llm-connection-info');

describe('lib/llm-connection-info', () => {
  test('inferPresetFromUrl: localhost → ollama_local', () => {
    expect(inferPresetFromUrl('http://localhost:11434')).toBe('ollama_local');
    expect(inferPresetFromUrl('http://127.0.0.1:11434')).toBe('ollama_local');
  });

  test('inferPresetFromUrl: dominio público → remote_api', () => {
    expect(inferPresetFromUrl('https://api.openai.com/v1')).toBe('remote_api');
  });

  test('buildLlmConnectionInfo respeta preset guardado aunque URL sea localhost', () => {
    const i = buildLlmConnectionInfo({
      baseUrl: 'http://localhost:11434',
      llmConnectionPreset: 'remote_api',
      llmConnectionLabel: 'Mi proxy'
    });
    expect(i.preset).toBe('remote_api');
    expect(i.userLabel).toBe('Mi proxy');
    expect(i.host).toBe('localhost:11434');
  });

  test('formatLlmConnectionLogBlock incluye modelo y auth', () => {
    const info = buildLlmConnectionInfo({ baseUrl: 'https://x.test/', llmConnectionLabel: 'T' });
    const s = formatLlmConnectionLogBlock(info, {}, {
      model: 'm1',
      embedModel: 'e1',
      ragEnabled: true,
      authConfigured: true
    });
    expect(s).toContain('m1');
    expect(s).toContain('e1');
    expect(s).toContain('sí');
    expect(s).toContain('x.test');
  });

  test('formatLlmRequestOneLiner usa etiqueta de usuario si existe', () => {
    const info = buildLlmConnectionInfo({
      baseUrl: 'https://api.example.com',
      llmConnectionPreset: 'remote_api',
      llmConnectionLabel: 'Cursor'
    });
    expect(formatLlmRequestOneLiner(info, 'gpt-x')).toContain('Cursor');
    expect(formatLlmRequestOneLiner(info, 'gpt-x')).toContain('api.example.com');
  });
});
