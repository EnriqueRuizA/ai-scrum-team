// Cliente OpenAI-compatible (/v1/chat/completions, /v1/embeddings, /v1/models) — HTTP nativo.

const http = require('http');
const https = require('https');
const { URL } = require('url');

const { modelNameMatches } = require('./local-llm');

/**
 * @param {string} urlString
 * @param {{ method?: 'GET'|'POST', jsonBody?: object|null, timeoutMs: number, signal?: AbortSignal, errorPrefix?: string, authHeaders?: Record<string, string> }} opts
 */
function requestOpenAICompat(urlString, opts) {
  const method = opts.method || 'POST';
  const timeoutMs = opts.timeoutMs;
  const signal = opts.signal;
  const errorPrefix = opts.errorPrefix || 'OpenAI-compat';

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
          const msg =
            (data && data.error && (data.error.message || data.error)) || raw.slice(0, 800);
          done(new Error(`${errorPrefix} failed (${res.statusCode}): ${msg}`));
          return;
        }
        done(null, data);
      });
    });

    timer = setTimeout(() => {
      req.destroy();
      done(new Error(`${errorPrefix}: timeout (${timeoutMs} ms)`));
    }, timeoutMs);

    req.on('error', (e) => {
      const code = e.code ? ` [${e.code}]` : '';
      done(new Error(`Conexión API falló${code}: ${e.message}`));
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

function normalizeV1Base(baseUrl) {
  let u = (baseUrl || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
  if (/\/v1$/i.test(u)) return u;
  if (/\/openai\/v1$/i.test(u)) return u;
  return `${u}/v1`;
}

function normalizeModelName(model) {
  const value = String(model || '').trim();
  return value.toLowerCase() === 'copilot' ? 'Auto (copilot)' : value;
}

/**
 * @param {string} prompt
 * @param {{ baseUrl?: string, model?: string, system?: string, timeout?: number, signal?: AbortSignal, authHeaders?: Record<string, string>, maxTokens?: number }} opts
 */
async function chatGenerate(prompt, opts = {}) {
  const base = normalizeV1Base(opts.baseUrl);
  const model = normalizeModelName(opts.model || 'gpt-4o-mini');
  const system = opts.system || '';
  const timeout = opts.timeout || 300000;
  const maxTokens = typeof opts.maxTokens === 'number' && opts.maxTokens > 0 ? opts.maxTokens : 8192;

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model,
    messages,
    max_tokens: maxTokens
  };

  const data = await requestOpenAICompat(`${base}/chat/completions`, {
    method: 'POST',
    jsonBody: body,
    timeoutMs: timeout,
    signal: opts.signal,
    errorPrefix: 'OpenAI-compat chat',
    authHeaders: opts.authHeaders
  });

  const choice = data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  return content != null ? String(content) : '';
}

/**
 * @param {string} text
 * @param {{ baseUrl?: string, embedModel?: string, embedTimeoutMs?: number, authHeaders?: Record<string, string> }} opts
 */
async function embed(text, opts = {}) {
  const base = normalizeV1Base(opts.baseUrl);
  const model = normalizeModelName(opts.embedModel || opts.model || 'text-embedding-3-small');
  const timeoutMs =
    typeof opts.embedTimeoutMs === 'number' && opts.embedTimeoutMs > 0
      ? opts.embedTimeoutMs
      : 600000;

  const data = await requestOpenAICompat(`${base}/embeddings`, {
    method: 'POST',
    jsonBody: { model, input: text },
    timeoutMs,
    errorPrefix: 'OpenAI-compat embeddings',
    authHeaders: opts.authHeaders
  });

  const row = data.data && data.data[0];
  return row && Array.isArray(row.embedding) ? row.embedding : [];
}

/**
 * @param {string} baseUrl
 * @param {{ authHeaders?: Record<string, string> }} [opts]
 */
async function listModels(baseUrl, opts = {}) {
  const base = normalizeV1Base(baseUrl);
  try {
    const data = await requestOpenAICompat(`${base}/models`, {
      method: 'GET',
      timeoutMs: 20000,
      errorPrefix: 'OpenAI-compat models',
      authHeaders: opts.authHeaders
    });
    const models = (data.data || []).map((m) => m.id).filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: e.message };
  }
}

async function checkHealth(baseUrl, model, opts = {}) {
  const r = await listModels(baseUrl, opts);
  if (!r.ok) return { ok: false, error: r.error };
  const hasModel = r.models.some((n) => modelNameMatches(n, normalizeModelName(model)));
  return { ok: true, modelLoaded: hasModel };
}

async function verifyOpenAICompatModels(baseUrl, chatModel, embedModel, opts = {}) {
  const r = await listModels(baseUrl, opts);
  if (!r.ok) return { ok: false, error: r.error };
  const modelNames = r.models;
  const hasChat = modelNames.some((n) => modelNameMatches(n, normalizeModelName(chatModel)));
  const hasEmbed = modelNames.some((n) => modelNameMatches(n, normalizeModelName(embedModel)));
  return { ok: true, modelNames, hasChat, hasEmbed };
}

module.exports = {
  chatGenerate,
  embed,
  listModels,
  checkHealth,
  verifyOpenAICompatModels,
  normalizeModelName,
  normalizeV1Base,
  requestOpenAICompat
};
