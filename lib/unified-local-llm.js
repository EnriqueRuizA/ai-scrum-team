/**
 * Enruta llamadas a Ollama nativo, API OpenAI-compatible o Cursor Cloud (listado /v0/models) según agents.local.
 */

const ollama = require('./local-llm');
const openaiCompat = require('./openai-compatible-llm');
const cursorCloud = require('./cursor-cloud-llm');
const { resolveHttpAdapterFromLocal } = require('./llm-provider-presets');

/**
 * @param {{ httpAdapter?: string, local?: object }} opts
 * @returns {'ollama'|'openai_compatible'|'cursor_cloud'}
 */
function adapterFromOpts(opts = {}) {
  if (opts.httpAdapter === 'cursor_cloud') return 'cursor_cloud';
  if (opts.httpAdapter === 'openai_compatible') return 'openai_compatible';
  if (opts.httpAdapter === 'ollama') return 'ollama';
  if (opts.local) return resolveHttpAdapterFromLocal(opts.local);
  return 'ollama';
}

async function generate(prompt, opts = {}) {
  const a = adapterFromOpts(opts);
  if (a === 'cursor_cloud') {
    return cursorCloud.chatGenerate(prompt, opts);
  }
  if (a === 'openai_compatible') {
    return openaiCompat.chatGenerate(prompt, opts);
  }
  return ollama.generate(prompt, opts);
}

async function embed(text, opts = {}) {
  const a = adapterFromOpts(opts);
  if (a === 'cursor_cloud') {
    return cursorCloud.embed(text, opts);
  }
  if (a === 'openai_compatible') {
    return openaiCompat.embed(text, opts);
  }
  return ollama.embed(text, opts);
}

async function listModels(baseUrl, opts = {}) {
  const a = adapterFromOpts(opts);
  if (a === 'cursor_cloud') {
    return cursorCloud.listModels(baseUrl, opts);
  }
  if (a === 'openai_compatible') {
    return openaiCompat.listModels(baseUrl, opts);
  }
  return ollama.listModels(baseUrl, opts);
}

async function checkHealth(baseUrl, model, opts = {}) {
  const a = adapterFromOpts(opts);
  if (a === 'cursor_cloud') {
    return cursorCloud.checkHealth(baseUrl, model, opts);
  }
  if (a === 'openai_compatible') {
    return openaiCompat.checkHealth(baseUrl, model, opts);
  }
  return ollama.checkHealth(baseUrl, model, opts);
}

async function verifyLlmModels(baseUrl, chatModel, embedModel, opts = {}) {
  const a = adapterFromOpts(opts);
  if (a === 'cursor_cloud') {
    return cursorCloud.verifyCursorModels(baseUrl, chatModel, embedModel, opts);
  }
  if (a === 'openai_compatible') {
    return openaiCompat.verifyOpenAICompatModels(baseUrl, chatModel, embedModel, opts);
  }
  return ollama.verifyOllamaModels(baseUrl, chatModel, embedModel, opts);
}

module.exports = {
  generate,
  embed,
  listModels,
  checkHealth,
  verifyLlmModels,
  adapterFromOpts,
  resolveHttpAdapterFromLocal
};
