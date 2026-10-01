// lib/llm-provider-presets.js - FASE 4: presets de proveedor legacy.
// Fijado contra __tests__/llm-provider-presets.unit.test.js (el fichero estaba
// incompleto: sin exports y con helpers indefinidos -> ReferenceError en runtime).
// Codigo legacy (FASE 5 lo elimina con la migracion total a opencode).

const PRESETS = {
  ollama_local: {
    id: 'ollama_local',
    label: 'Ollama local',
    httpAdapter: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.2',
    apiKeyMode: 'none'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    httpAdapter: 'openai_compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    apiKeyMode: 'bearer'
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    httpAdapter: 'openai_compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyMode: 'bearer'
  },
  cursor_cloud: {
    id: 'cursor_cloud',
    label: 'Cursor Cloud API',
    httpAdapter: 'cursor_cloud',
    defaultBaseUrl: 'https://api.cursor.com',
    defaultModel: '',
    apiKeyMode: 'basic'
  }
};

/** true si la URL apunta a un endpoint OpenAI-compatible (sufijo /v1). */
function baseUrlImpliesOpenAiCompatible(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.pathname === '/v1' || parsed.pathname.endsWith('/v1');
  } catch (e) {
    return /\/v1$/.test(u);
  }
}

function getPreset(id) {
  if (!id || typeof id !== 'string') return null;
  const p = PRESETS[id];
  return p ? { ...p } : null;
}

/** Lista saneada para el dashboard (sin secretos; solo metadatos). */
function listPresetsForApi() {
  return Object.values(PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    httpAdapter: p.httpAdapter,
    defaultBaseUrl: p.defaultBaseUrl,
    defaultModel: p.defaultModel,
    apiKeyMode: p.apiKeyMode
  }));
}

/** Infiere preset desde la URL (solo casos obvios; null si no hay match). */
function inferPresetFromUrl(baseUrl) {
  const u = String(baseUrl || '').trim();
  if (!u) return null;
  if (u.includes('api.cursor.com')) return 'cursor_cloud';
  if (baseUrlImpliesOpenAiCompatible(u)) return 'openai_compatible';
  return null;
}

function resolveHttpAdapterFromLocal(local = {}) {
  const explicit = String(local.httpAdapter || '').trim();
  const baseUrl = String(local.baseUrl || '').trim();
  const presetId = String(local.providerPreset || local.llmConnectionPreset || '').trim();

  if (explicit === 'cursor_cloud') return 'cursor_cloud';
  if (explicit === 'openai_compatible') return 'openai_compatible';
  if (explicit === 'ollama') {
    if (baseUrlImpliesOpenAiCompatible(baseUrl)) return 'openai_compatible';
    return 'ollama';
  }

  // Sin httpAdapter explicito: el preset manda...
  if (presetId) {
    const preset = getPreset(presetId);
    if (preset) {
      // ...pero una URL /v1 fuerza openai_compatible (evita /api/tags 404).
      if (baseUrlImpliesOpenAiCompatible(baseUrl)) return 'openai_compatible';
      return preset.httpAdapter;
    }
  }

  // ...y si no, intentar inferir desde la URL.
  const inferred = inferPresetFromUrl(baseUrl);
  if (inferred) return inferred;

  // Si no se puede inferir, usar predeterminado
  return 'ollama';
}

module.exports = {
  PRESETS,
  baseUrlImpliesOpenAiCompatible,
  getPreset,
  listPresetsForApi,
  inferPresetFromUrl,
  resolveHttpAdapterFromLocal
};
