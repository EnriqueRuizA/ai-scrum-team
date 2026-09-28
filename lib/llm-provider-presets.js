function resolveHttpAdapterFromLocal(local = {}) {
  const explicit = String(local.httpAdapter || '').trim();
  const baseUrl = String(local.baseUrl || '').trim();

  if (explicit === 'cursor_cloud') return 'cursor_cloud';
  if (explicit === 'openai_compatible') return 'openai_compatible';
  if (explicit === 'ollama') {
    if (baseUrlImpliesOpenAiCompatible(baseUrl)) return 'openai_compatible';
    return 'ollama';
  }

  // Si no se especifica explícitamente, intentar inferir desde la URL
  const inferred = inferPresetFromUrl(baseUrl);
  if (inferred) return inferred;

  // Si no se puede inferir, usar predeterminado
  return 'ollama';
}
