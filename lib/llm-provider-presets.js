/**
 * Plantillas de proveedor (ChatGPT/OpenAI, DeepSeek, Ollama, etc.).
 * `httpAdapter`: qué protocolo HTTP usa el cliente (`ollama` | `openai_compatible` | `cursor_cloud`).
 */

const PRESETS = {
  ollama_local: {
    id: 'ollama_local',
    label: 'Ollama (PC local)',
    description: 'API nativa Ollama en localhost o LAN. Sin API key por defecto.',
    httpAdapter: 'ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.2',
    defaultEmbedModel: 'nomic-embed-text',
    apiKeyMode: 'bearer',
    requiresApiKey: false
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT API)',
    description: 'API oficial OpenAI, formato /v1/chat/completions.',
    httpAdapter: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultEmbedModel: 'text-embedding-3-small',
    apiKeyMode: 'bearer',
    requiresApiKey: true
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'API compatible OpenAI. Ajusta modelo de embeddings si usas RAG (ver docs DeepSeek).',
    httpAdapter: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    defaultEmbedModel: 'deepseek-embedding',
    apiKeyMode: 'bearer',
    requiresApiKey: true
  },
  cursor: {
    id: 'cursor',
    label: 'OpenAI (sk-…; no uses clave crsr_ aquí)',
    description:
      'Misma URL que OpenAI oficial (Bearer sk-…). Las claves crsr_… son de Cursor: usa la plantilla «Cursor Cloud API» y https://api.cursor.com con Basic.',
    httpAdapter: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultEmbedModel: 'text-embedding-3-small',
    apiKeyMode: 'bearer',
    requiresApiKey: true
  },
  cursor_cloud: {
    id: 'cursor_cloud',
    label: 'Cursor Cloud API (api.cursor.com)',
    description:
      'Según documentación Cursor: GET /v0/models con Basic Auth (usuario = API key, contraseña vacía). Sirve para probar la clave y listar modelos de Cloud Agents. Este orquestador no puede usar esta API como chat completions; para ejecutar el proyecto usa Ollama u OpenAI-compatible.',
    httpAdapter: 'cursor_cloud',
    baseUrl: 'https://api.cursor.com',
    defaultModel: 'default',
    defaultEmbedModel: 'nomic-embed-text',
    apiKeyMode: 'basic',
    requiresApiKey: true
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    description: 'API rápida compatible OpenAI. Los embeddings pueden no estar disponibles para RAG.',
    httpAdapter: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    defaultEmbedModel: 'text-embedding-3-small',
    apiKeyMode: 'bearer',
    requiresApiKey: true
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'API compatible OpenAI en api.mistral.ai.',
    httpAdapter: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    defaultEmbedModel: 'mistral-embed',
    apiKeyMode: 'bearer',
    requiresApiKey: true
  },
  together: {
    id: 'together',
    label: 'Together AI',
    description: 'API compatible OpenAI.',
    httpAdapter: 'openai_compatible',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultEmbedModel: 'togethercomputer/m2-bert-80M-8k-retrieval',
    apiKeyMode: 'bearer',
    requiresApiKey: true
  },
  custom_openai: {
    id: 'custom_openai',
    label: 'Otro (URL OpenAI-compatible)',
    description: 'Misma forma que OpenAI (/v1/chat/completions, /v1/embeddings). Tú pones la URL base.',
    httpAdapter: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultEmbedModel: 'text-embedding-3-small',
    apiKeyMode: 'bearer',
    requiresApiKey: true
  }
};

/**
 * URLs que terminan en `/v1` son casi siempre APIs estilo OpenAI (`/v1/models`), no Ollama (`/api/tags`).
 * Evita 404 cuando alguien deja `httpAdapter: ollama` con base tipo `https://api.openai.com/v1`.
 */
function baseUrlImpliesOpenAiCompatible(baseUrl) {
  const s = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!s) return false;
  return /\/v1$/i.test(s);
}

/**
 * @param {object} local - agents.local
 * @returns {'ollama'|'openai_compatible'|'cursor_cloud'}
 */
function resolveHttpAdapterFromLocal(local = {}) {
  const explicit = String(local.httpAdapter || '').trim();
  const baseUrl = String(local.baseUrl || '').trim();

  if (explicit === 'cursor_cloud') return 'cursor_cloud';
  if (explicit === 'openai_compatible') return 'openai_compatible';
  if (explicit === 'ollama') {
    if (baseUrlImpliesOpenAiCompatible(baseUrl)) return 'openai_compatible';
    return 'ollama';
  }

  const pid = String(local.providerPreset || '').trim();
  const p = PRESETS[pid];
  if (p && p.httpAdapter === 'cursor_cloud') return 'cursor_cloud';
  if (p && p.httpAdapter === 'openai_compatible') return 'openai_compatible';
  if (p && p.httpAdapter === 'ollama') {
    if (baseUrlImpliesOpenAiCompatible(baseUrl)) return 'openai_compatible';
    return 'ollama';
  }

  if (baseUrlImpliesOpenAiCompatible(baseUrl)) return 'openai_compatible';

  return 'ollama';
}

/** Para el dashboard: lista sin funciones internas. */
function listPresetsForApi() {
  return Object.values(PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    httpAdapter: p.httpAdapter,
    defaultBaseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
    defaultEmbedModel: p.defaultEmbedModel,
    defaultApiKeyMode: p.apiKeyMode,
    requiresApiKey: !!p.requiresApiKey,
    infoOnly: !!p.infoOnly
  }));
}

function getPreset(presetId) {
  return PRESETS[presetId] || null;
}

module.exports = {
  PRESETS,
  getPreset,
  listPresetsForApi,
  resolveHttpAdapterFromLocal,
  baseUrlImpliesOpenAiCompatible
};
