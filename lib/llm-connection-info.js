/**
 * Describe y resume cómo está configurado el backend LLM local (Ollama vs API remota).
 * Usado en logs y en el dashboard (config visible, sin secretos).
 */

const { URL } = require('url');

const PRESET_LABELS = {
  ollama_local: 'Ollama / modelo en esta máquina o red local',
  remote_api: 'API remota (hosted, proxy, clave API, etc.)',
  custom: 'Personalizado (revisa nombre y URL)'
};

const VALID_PRESETS = new Set(Object.keys(PRESET_LABELS));

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function hostFromBaseUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const port = u.port;
    const defaultPort = u.protocol === 'https:' ? '443' : '80';
    const p =
      port && port !== defaultPort && String(port) !== '80' && String(port) !== '443'
        ? `:${port}`
        : '';
    return `${u.hostname}${p}`;
  } catch {
    return '(URL no válida)';
  }
}

/**
 * Heurística si no hay preset guardado.
 * @param {string} baseUrl
 * @returns {'ollama_local'|'remote_api'}
 */
function inferPresetFromUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const h = (u.hostname || '').toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'ollama_local';
    if (/^192\.168\.\d+\.\d+$/.test(h)) return 'ollama_local';
    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return 'ollama_local';
    if (h.endsWith('.local')) return 'ollama_local';
  } catch {
    /* ignore */
  }
  return 'remote_api';
}

/**
 * @param {object} local - `agents.local`
 * @returns {{
 *   preset: string,
 *   presetLabel: string,
 *   userLabel: string,
 *   host: string,
 *   baseUrlNormalized: string
 * }}
 */
function buildLlmConnectionInfo(local = {}) {
  const baseUrlRaw = (local.baseUrl && String(local.baseUrl).trim()) || 'http://localhost:11434';
  const baseUrlNormalized = baseUrlRaw.replace(/\/$/, '');

  let preset = String(local.llmConnectionPreset || '').trim();
  if (!VALID_PRESETS.has(preset)) {
    preset = inferPresetFromUrl(baseUrlNormalized);
  }

  const userLabel = String(local.llmConnectionLabel || '').trim();
  const presetLabel = PRESET_LABELS[preset] || PRESET_LABELS.remote_api;

  return {
    preset,
    presetLabel,
    userLabel,
    host: hostFromBaseUrl(baseUrlNormalized),
    baseUrlNormalized
  };
}

/**
 * Texto multilínea para el log del orquestador al arrancar en modo local.
 * @param {ReturnType<typeof buildLlmConnectionInfo>} info
 * @param {object} local
 * @param {{ model: string, embedModel: string, ragEnabled: boolean, authConfigured: boolean }} ctx
 */
function formatLlmConnectionLogBlock(info, local, ctx) {
  const lines = [
    '── Conexión LLM (backend local) ──',
    `  Tipo: ${info.presetLabel}`,
    info.userLabel ? `  Nombre que diste: «${info.userLabel}»` : '  Nombre que diste: (sin etiqueta; puedes ponerla en Settings)',
    `  Host: ${info.host}`,
    `  URL base: ${info.baseUrlNormalized}`,
    `  Modelo de chat: ${ctx.model}`,
    ctx.ragEnabled
      ? `  RAG: sí · modelo embeddings: ${ctx.embedModel}`
      : '  RAG: no',
    `  API key / auth HTTP: ${ctx.authConfigured ? 'sí (cabecera enviada)' : 'no'}`
  ];
  return lines.join('\n');
}

/**
 * Una línea corta para cada petición al modelo.
 * @param {ReturnType<typeof buildLlmConnectionInfo>} info
 * @param {string} model
 */
function formatLlmRequestOneLiner(info, model) {
  const tag = info.userLabel || info.preset;
  return `Petición LLM [${tag}] → ${info.host} · modelo «${model}»`;
}

module.exports = {
  PRESET_LABELS,
  buildLlmConnectionInfo,
  inferPresetFromUrl,
  hostFromBaseUrl,
  formatLlmConnectionLogBlock,
  formatLlmRequestOneLiner
};
