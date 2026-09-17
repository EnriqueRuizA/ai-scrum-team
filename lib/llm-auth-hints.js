/**
 * Pistas cuando falla listado de modelos / auth (OpenAI-compatible u Ollama).
 */

const { rawApiKeyFromLocalConfig } = require('./local-llm');
const { resolveHttpAdapterFromLocal } = require('./llm-provider-presets');

/**
 * Clave crsr_… solo sirve con adaptador Cursor Cloud (Basic, api.cursor.com), no como Bearer en /v1 OpenAI.
 * @param {object} local - agents.local mezclado (misma forma que en server)
 * @returns {{ error: string, hint: string } | null}
 */
function misconfiguredCrsrKeyWithOpenAiCompatible(local) {
  const key = String(rawApiKeyFromLocalConfig(local || {}) || '').trim();
  if (!/^crsr_/i.test(key)) return null;
  if (resolveHttpAdapterFromLocal(local || {}) !== 'openai_compatible') return null;
  return {
    error:
      'La clave crsr_… es de Cursor Cloud API; no se puede usar como Bearer contra una URL OpenAI (/v1).',
    hint:
      'En Settings elige la plantilla «Cursor Cloud API», URL https://api.cursor.com y modo «Basic». ' +
      'Para ejecutar el proyecto Scrum con chat aquí hace falta Ollama, OpenAI (sk-…) o backend Claude.'
  };
}

/**
 * @param {string} errorMessage
 * @param {string} baseUrl
 * @param {string} rawApiKey - clave resuelta (misma fuente que Authorization)
 * @param {'ollama'|'openai_compatible'|'cursor_cloud'} httpAdapter
 * @returns {string|null}
 */
function hintAfterListModelsFailure(errorMessage, baseUrl, rawApiKey, httpAdapter) {
  const err = String(errorMessage || '');
  const url = String(baseUrl || '');
  const key = String(rawApiKey || '');

  if (
    httpAdapter === 'openai_compatible' &&
    /crsr_/i.test(key) &&
    /api\.openai\.com/i.test(url) &&
    /401|Incorrect API key|invalid_api_key|invalid x-api-key/i.test(err)
  ) {
    return (
      'La clave crsr_… es de Cursor; api.openai.com solo acepta claves sk-… (OpenAI). ' +
      'Si quieres usar la API documentada de Cursor (Basic Auth, GET /v0/models), en Settings elige la plantilla «Cursor Cloud API», URL https://api.cursor.com y modo «Basic». ' +
      'Eso sirve para probar la clave y listar modelos; para ejecutar el proyecto aquí sigue haciendo falta Ollama, OpenAI-compatible o Claude.'
    );
  }

  return null;
}

module.exports = {
  hintAfterListModelsFailure,
  misconfiguredCrsrKeyWithOpenAiCompatible
};

