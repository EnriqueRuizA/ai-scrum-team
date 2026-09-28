function resolveHttpAdapterFromLocal(local = {}) {
  const explicit = String(local.httpAdapter || '').trim();
  const baseUrl = String(local.baseUrl || '').trim();

  if (explicit === 'cursor_cloud') return 'cursor_cloud';
  if (explicit === 'openai_compatible') return 'openai_compatible';
  if (explicit === 'ollama') {
    if (baseUrlImpliesOpenAiCompatible(baseUrl)) return 'openai_compatible';
    return 'oll
