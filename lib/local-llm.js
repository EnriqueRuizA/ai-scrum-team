// lib/local-llm.js - Cliente para Ollama (IA local)

const DEFAULT_BASE = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

/**
 * Genera texto con el modelo configurado (Ollama).
 * @param {string} prompt - Texto de entrada
 * @param {{ baseUrl?: string, model?: string, system?: string, timeout?: number }} opts
 * @returns {Promise<string>}
 */
async function generate(prompt, opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const model = opts.model || DEFAULT_MODEL;
  const system = opts.system || '';
  const timeout = opts.timeout || 300000; // 5 min para respuestas largas

  const body = {
    model,
    prompt,
    stream: false,
    options: { num_predict: 8192 }
  };
  if (system) body.system = system;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(t);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama generate failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    return data.response || '';
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Timeout esperando respuesta del modelo local');
    throw e;
  }
}

/**
 * Obtiene embeddings para un texto (Ollama /api/embeddings).
 * @param {string} text
 * @param {{ baseUrl?: string, model?: string }} opts
 * @returns {Promise<number[]>}
 */
async function embed(text, opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const model = opts.embedModel || opts.model || DEFAULT_EMBED_MODEL;

  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama embeddings failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.embedding || [];
}

/**
 * Comprueba si Ollama está disponible y el modelo existe.
 */
async function checkHealth(baseUrl = DEFAULT_BASE, model = DEFAULT_MODEL) {
  const url = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/api/tags`, { method: 'GET' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const hasModel = (data.models || []).some(m => (m.name || '').startsWith(model));
    return { ok: true, modelLoaded: hasModel };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { generate, embed, checkHealth, DEFAULT_BASE, DEFAULT_MODEL, DEFAULT_EMBED_MODEL };
