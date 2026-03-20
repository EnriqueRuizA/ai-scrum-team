// lib/local-llm.js - Cliente para Ollama (IA local)
// Todo el tráfico usa http(s) nativo: evita límites de fetch/undici (body ~300s, headers ~300s, UND_ERR_HEADERS_TIMEOUT).

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_BASE = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

/** Timeout por defecto para /api/embeddings (RAG puede encolar detrás de generate en máquinas lentas). */
const DEFAULT_EMBED_TIMEOUT_MS = 600000; // 10 min

/**
 * Cabeceras HTTP para APIs con API key (proxy delante de Ollama, OpenAI-compatible, etc.).
 * Orden de la clave: `process.env[apiKeyEnv]` → `local.apiKey` → `AI_SCRUM_LOCAL_API_KEY` → `OLLAMA_API_KEY`.
 *
 * @param {object} local - Bloque `agents.local` del project-config (y opcionalmente `process.env`).
 * @returns {Record<string, string>}
 */
function authHeadersFromLocalConfig(local = {}) {
  const envName = typeof local.apiKeyEnv === 'string' ? local.apiKeyEnv.trim() : '';
  let key = '';
  if (envName && process.env[envName] != null) {
    key = String(process.env[envName]).trim();
  }
  if (!key && local.apiKey != null) {
    const k = String(local.apiKey).trim();
    if (k && k !== '__REDACTED__') key = k;
  }
  if (!key) {
    key = (process.env.AI_SCRUM_LOCAL_API_KEY || process.env.OLLAMA_API_KEY || '').trim();
  }
  if (!key) return {};

  const mode = String(local.apiKeyMode || 'bearer').toLowerCase();
  if (mode === 'x-api-key') {
    return { 'X-API-Key': key };
  }
  if (mode === 'custom' && local.apiKeyHeader) {
    const h = String(local.apiKeyHeader).trim();
    const prefix = local.apiKeyPrefix != null ? String(local.apiKeyPrefix) : '';
    if (!h) return { Authorization: `Bearer ${key}` };
    return { [h]: `${prefix}${key}` };
  }
  return { Authorization: `Bearer ${key}` };
}

/**
 * GET o POST JSON contra Ollama; sin fetch/undici.
 * @param {string} urlString
 * @param {{ method?: 'GET'|'POST', jsonBody?: object|null, timeoutMs: number, signal?: AbortSignal, errorPrefix?: string, authHeaders?: Record<string, string> }} opts
 */
function requestOllama(urlString, opts) {
  const method = opts.method || 'POST';
  const timeoutMs = opts.timeoutMs;
  const signal = opts.signal;
  const errorPrefix = opts.errorPrefix || 'Ollama';

  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    let bodyStr;
    const headers = { ...(opts.authHeaders || {}) };
    if (method === 'POST' && opts.jsonBody != null) {
      bodyStr = JSON.stringify(opts.jsonBody);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr, 'utf8');
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers
    };

    let settled = false;
    let timer;

    const done = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(data);
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (settled) return;
        const raw = Buffer.concat(chunks).toString('utf8');
        let data;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (e) {
          done(
            new Error(
              `${errorPrefix}: respuesta no es JSON (HTTP ${res.statusCode}): ${e.message}. Cuerpo: ${raw.slice(0, 300)}`
            )
          );
          return;
        }
        if (res.statusCode >= 400) {
          done(new Error(`${errorPrefix} failed (${res.statusCode}): ${raw.slice(0, 800)}`));
          return;
        }
        done(null, data);
      });
    });

    timer = setTimeout(() => {
      req.destroy();
      done(
        new Error(
          `${errorPrefix}: timeout (${timeoutMs} ms) esperando respuesta. ` +
            'Si es /api/generate, sube agents.local.generateTimeoutMs. Si el PC va justo, reduce RAG o el tamaño del índice.'
        )
      );
    }, timeoutMs);

    req.on('error', (e) => {
      const code = e.code ? ` [${e.code}]` : '';
      done(
        new Error(
          `Conexión con Ollama falló${code}: ${e.message}. ` +
            'Comprueba que `ollama serve` sigue activo y agents.local.baseUrl es correcta.'
        )
      );
    });

    if (signal) {
      if (signal.aborted) {
        req.destroy();
        done(new Error('Petición cancelada'));
        return;
      }
      const onAbort = () => {
        req.destroy();
        done(new Error('Petición cancelada'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Genera texto con el modelo configurado (Ollama).
 * @param {string} prompt - Texto de entrada
 * @param {{ baseUrl?: string, model?: string, system?: string, timeout?: number, signal?: AbortSignal }} opts
 * @returns {Promise<string>}
 */
async function generate(prompt, opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const model = opts.model || DEFAULT_MODEL;
  const system = opts.system || '';
  const timeout = opts.timeout || 300000;

  const body = {
    model,
    prompt,
    stream: false,
    options: { num_predict: 8192 }
  };
  if (system) body.system = system;

  const data = await requestOllama(`${baseUrl}/api/generate`, {
    method: 'POST',
    jsonBody: body,
    timeoutMs: timeout,
    signal: opts.signal,
    errorPrefix: 'Ollama generate',
    authHeaders: opts.authHeaders
  });
  return data.response || '';
}

/**
 * Obtiene embeddings para un texto (Ollama /api/embeddings).
 * @param {string} text
 * @param {{ baseUrl?: string, model?: string, embedTimeoutMs?: number }} opts
 * @returns {Promise<number[]>}
 */
async function embed(text, opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const model = opts.embedModel || opts.model || DEFAULT_EMBED_MODEL;
  const timeoutMs =
    typeof opts.embedTimeoutMs === 'number' && opts.embedTimeoutMs > 0
      ? opts.embedTimeoutMs
      : DEFAULT_EMBED_TIMEOUT_MS;

  const data = await requestOllama(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    jsonBody: { model, prompt: text },
    timeoutMs,
    errorPrefix: 'Ollama embeddings',
    authHeaders: opts.authHeaders
  });
  return data.embedding || [];
}

/**
 * Lista nombres de modelos instalados en Ollama (/api/tags).
 * @param {string} baseUrl
 * @param {{ authHeaders?: Record<string, string> }} [opts]
 * @returns {Promise<{ ok: boolean, models: string[], error?: string }>}
 */
async function listModels(baseUrl = DEFAULT_BASE, opts = {}) {
  const url = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  try {
    const data = await requestOllama(`${url}/api/tags`, {
      method: 'GET',
      timeoutMs: 20000,
      errorPrefix: 'Ollama tags',
      authHeaders: opts.authHeaders
    });
    const models = (data.models || []).map(m => m.name).filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: e.message };
  }
}

/**
 * Comprueba si Ollama está disponible y el modelo existe.
 * @param {string} baseUrl
 * @param {string} model
 * @param {{ authHeaders?: Record<string, string> }} [opts]
 */
async function checkHealth(baseUrl = DEFAULT_BASE, model = DEFAULT_MODEL, opts = {}) {
  const url = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  try {
    const data = await requestOllama(`${url}/api/tags`, {
      method: 'GET',
      timeoutMs: 15000,
      errorPrefix: 'Ollama tags',
      authHeaders: opts.authHeaders
    });
    const hasModel = (data.models || []).some((m) => modelNameMatches(m.name, model));
    return { ok: true, modelLoaded: hasModel };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Coincide nombre Ollama (p. ej. llama3.2 vs llama3.2:latest). */
function modelNameMatches(installedName, wanted) {
  if (!wanted || !installedName) return false;
  const w = String(wanted).trim();
  const n = String(installedName).trim();
  return n === w || n.startsWith(`${w}:`);
}

/**
 * Lista modelos y comprueba chat + embeddings (para RAG).
 * @param {string} baseUrl
 * @param {string} chatModel
 * @param {string} embedModel
 * @param {{ authHeaders?: Record<string, string> }} [opts]
 * @returns {Promise<{ ok: boolean, error?: string, modelNames?: string[], hasChat?: boolean, hasEmbed?: boolean }>}
 */
async function verifyOllamaModels(
  baseUrl = DEFAULT_BASE,
  chatModel = DEFAULT_MODEL,
  embedModel = DEFAULT_EMBED_MODEL,
  opts = {}
) {
  const url = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  try {
    const data = await requestOllama(`${url}/api/tags`, {
      method: 'GET',
      timeoutMs: 15000,
      errorPrefix: 'Ollama tags',
      authHeaders: opts.authHeaders
    });
    const modelNames = (data.models || []).map((m) => m.name).filter(Boolean);
    const hasChat = modelNames.some((n) => modelNameMatches(n, chatModel));
    const hasEmbed = modelNames.some((n) => modelNameMatches(n, embedModel));
    return { ok: true, modelNames, hasChat, hasEmbed };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  generate,
  embed,
  checkHealth,
  listModels,
  verifyOllamaModels,
  modelNameMatches,
  authHeadersFromLocalConfig,
  DEFAULT_BASE,
  DEFAULT_MODEL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EMBED_TIMEOUT_MS
};
