const {
  hintAfterListModelsFailure,
  misconfiguredCrsrKeyWithOpenAiCompatible
} = require('../lib/llm-auth-hints');

describe('lib/llm-auth-hints', () => {
  test('hint cuando crsr_ + api.openai.com + 401', () => {
    const h = hintAfterListModelsFailure(
      'OpenAI-compat models failed (401): Incorrect API key provided: crsr_xxx',
      'https://api.openai.com/v1',
      'crsr_abc123',
      'openai_compatible'
    );
    expect(h).toBeTruthy();
    expect(h).toMatch(/crsr_/i);
    expect(h).toMatch(/Cursor Cloud API|\/v0\/models|Basic/i);
    expect(h).toMatch(/api\.openai\.com|OpenAI/i);
  });

  test('sin hint para clave sk- en OpenAI', () => {
    expect(
      hintAfterListModelsFailure(
        'OpenAI-compat models failed (401): Incorrect API key',
        'https://api.openai.com/v1',
        'sk-fake',
        'openai_compatible'
      )
    ).toBeNull();
  });

  test('sin hint para crsr_ en URL que no es OpenAI', () => {
    expect(
      hintAfterListModelsFailure(
        'OpenAI-compat models failed (401): bad',
        'https://api.example.com/v1',
        'crsr_abc',
        'openai_compatible'
      )
    ).toBeNull();
  });

  test('misconfiguredCrsrKeyWithOpenAiCompatible: crsr_ + adaptador openai_compatible', () => {
    const r = misconfiguredCrsrKeyWithOpenAiCompatible({
      providerPreset: 'openai',
      httpAdapter: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'crsr_abc'
    });
    expect(r).toBeTruthy();
    expect(r.error).toMatch(/crsr_/i);
    expect(r.hint).toMatch(/Cursor Cloud API|api\.cursor\.com/i);
  });

  test('misconfiguredCrsrKeyWithOpenAiCompatible: null si preset cursor_cloud', () => {
    expect(
      misconfiguredCrsrKeyWithOpenAiCompatible({
        providerPreset: 'cursor_cloud',
        httpAdapter: 'cursor_cloud',
        baseUrl: 'https://api.cursor.com',
        apiKey: 'crsr_abc'
      })
    ).toBeNull();
  });
});
