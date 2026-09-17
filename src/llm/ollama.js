// src/llm/ollama.js
const { logger } = require('../utils/logger.js');

class OllamaClient {
  constructor({ baseUrl = 'http://localhost:11434', apiKey = '' } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async generate({ model, messages, stream = false, timeout = 120000 }) {
    const url = `${this.baseUrl}/api/generate`;
    const body = { model, messages, stream };
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout
    };
    if (this.apiKey) opts.headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(url, opts);
    if (!resp.ok) throw new Error(`Ollama error: ${resp.statusText}`);
    return stream ? resp.body : await resp.json();
  }

  async embeddings({ model, inputs }) {
    const url = `${this.baseUrl}/api/embeddings`;
    const body = { model, inputs };
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (this.apiKey) opts.headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(url, opts);
    if (!resp.ok) throw new Error(`Ollama embeddings error: ${resp.statusText}`);
    return await resp.json();
  }
}

module.exports = { OllamaClient };
