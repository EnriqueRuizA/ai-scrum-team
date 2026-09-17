/**
 * Cursor Cloud API (documentación: https://cursor.com/docs/cloud-agent/api/endpoints)
 * - Listado: GET https://api.cursor.com/v0/models
 * - Autenticación: Basic (usuario = API key, contraseña vacía)
 *
 * No expone /v1/chat/completions para este orquestador; solo listModels / comprobación de clave.
 */

const { requestOpenAICompat } = require('./openai-compatible-llm');
const { modelNameMatches } = require('./local-llm');

function normalizeCursorApiOrigin(baseUrl) {
  const raw = (baseUrl || 'https://api.cursor.com').trim() || 'https://api.cursor.com';
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'https://api.cursor.com';
  }
}

/**
 * @param {string} baseUrl
 * @param {{ authHeaders?: Record<string, string> }} [opts]
 * @returns {Promise<{ ok: boolean, models: string[], error?: string }>}
 */
async function listModels(baseUrl, opts = {}) {
  const origin = normalizeCursorApiOrigin(baseUrl);
  try {
    const data = await requestOpenAICompat(`${origin}/v0/models`, {
      method: 'GET',
      timeoutMs: 20000,
      errorPrefix: 'Cursor Cloud models',
      authHeaders: opts.authHeaders
    });
    const models = Array.isArray(data.models)
      ? data.models.filter((x) => typeof x === 'string' && x.trim())
      : [];
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: e.message };
  }
}

/**
 * @param {string} baseUrl
 * @param {string} model
 * @param {{ authHeaders?: Record<string, string> }} [opts]
 */
async function checkHealth(baseUrl, model, opts = {}) {
  const r = await listModels(baseUrl, opts);
  if (!r.ok) return { ok: false, error: r.error };
  const m = (model && String(model).trim()) || 'default';
  if (m === 'default') {
    return { ok: true, modelLoaded: true };
  }
  const hasModel = r.models.some((n) => modelNameMatches(n, m));
  return { ok: true, modelLoaded: hasModel };
}

/**
 * @param {string} baseUrl
 * @param {string} chatModel
 * @param {string} embedModel
 * @param {{ authHeaders?: Record<string, string> }} [opts]
 */
async function verifyCursorModels(baseUrl, chatModel, embedModel, opts = {}) {
  const r = await listModels(baseUrl, opts);
  if (!r.ok) return { ok: false, error: r.error };
  const modelNames = r.models;
  const cm = (chatModel && String(chatModel).trim()) || 'default';
  const hasChat = cm === 'default' || modelNames.some((n) => modelNameMatches(n, cm));
  const hasEmbed = modelNames.some((n) => modelNameMatches(n, embedModel));
  return { ok: true, modelNames, hasChat, hasEmbed };
}

function notSupported(what) {
  return new Error(
    `Cursor Cloud API (api.cursor.com): no hay ${what} usable como en Ollama/OpenAI para este orquestador. ` +
      'La API oficial sirve para Cloud Agents, GET /v0/me, GET /v0/models, etc. (Basic Auth). ' +
      'Para ejecutar el pipeline Scrum aquí usa Ollama, un proveedor OpenAI-compatible (/v1/chat/completions) o backend Claude (navegador).'
  );
}

async function chatGenerate(/* prompt, opts */) {
  throw notSupported('chat completions');
}

async function embed(/* text, opts */) {
  throw notSupported('embeddings');
}

module.exports = {
  listModels,
  checkHealth,
  verifyCursorModels,
  chatGenerate,
  embed,
  normalizeCursorApiOrigin
};
