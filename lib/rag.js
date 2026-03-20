// lib/rag.js - RAG: índice de fragmentos + retrieval por similitud

const path = require('path');
const fs = require('fs-extra');
const { embed } = require('./local-llm');

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

/**
 * Parte un texto en fragmentos de tamaño limitado con solapamiento.
 * @param {string} text
 * @param {{ chunkSize?: number, overlap?: number }} opts
 * @returns {string[]}
 */
function chunkText(text, opts = {}) {
  const size = opts.chunkSize || CHUNK_SIZE;
  const overlap = opts.overlap || CHUNK_OVERLAP;
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    if (end < text.length) {
      const nextNewline = text.indexOf('\n', end);
      if (nextNewline !== -1 && nextNewline < end + 200) end = nextNewline + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }
  return chunks.filter(c => c.length > 20);
}

/**
 * Producto escalar entre dos vectores (para similitud coseno si vectores normalizados).
 */
function dot(a, b) {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function norm(v) {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
}

function cosineSimilarity(a, b) {
  return dot(a, b) / (norm(a) * norm(b));
}

/**
 * Construye un índice RAG desde carpetas/archivos: lee ficheros, trocea, embede y guarda.
 * @param {string[]} indexPaths - Rutas de directorios o ficheros (recursivo en dirs)
 * @param {{ baseUrl?: string, embedModel?: string, indexFile?: string }} opts
 * @returns {Promise<{ chunks: Array<{ text: string, embedding: number[], path?: string }> }>}
 */
async function buildIndex(indexPaths, opts = {}) {
  const embedOpts = {
    baseUrl: opts.baseUrl,
    embedModel: opts.embedModel,
    embedTimeoutMs: opts.embedTimeoutMs,
    authHeaders: opts.authHeaders
  };
  const chunks = [];
  const seen = new Set();

  async function addFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.js', '.json', '.md', '.txt', '.html', '.css', '.ts', '.tsx', '.jsx', '.py', '.sql'].includes(ext)) return;
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const relPath = path.relative(process.cwd(), filePath);
      const fileChunks = chunkText(content).map(text => ({ text, path: relPath }));
      for (const c of fileChunks) {
        const key = c.text.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        const embedding = await embed(c.text, embedOpts);
        chunks.push({ text: c.text, embedding, path: c.path });
      }
    } catch (e) {
      // ignorar ficheros no legibles
    }
  }

  async function walkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== 'node_modules' && ent.name !== '.git') await walkDir(full);
      } else await addFile(full);
    }
  }

  for (const p of indexPaths) {
    const abs = path.resolve(p);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) await walkDir(abs);
    else await addFile(abs);
  }

  return { chunks };
}

/**
 * Añade fragmentos de texto (sin leer disco) al índice. Útil para inyectar PRD, arquitectura, etc.
 * @param {Array<{ text: string, path?: string }>} items
 * @param {object} opts - baseUrl, embedModel
 * @returns {Promise<Array<{ text: string, embedding: number[], path?: string }>>}
 */
async function addChunksToIndex(items, opts = {}) {
  const embedOpts = {
    baseUrl: opts.baseUrl,
    embedModel: opts.embedModel,
    embedTimeoutMs: opts.embedTimeoutMs,
    authHeaders: opts.authHeaders
  };
  const result = [];
  for (const item of items) {
    const chunks = chunkText(item.text);
    for (const c of chunks) {
      const embedding = await embed(c, embedOpts);
      result.push({ text: c, embedding, path: item.path });
    }
  }
  return result;
}

/**
 * Recupera los fragmentos más relevantes para una consulta.
 * @param {string} query
 * @param {Array<{ text: string, embedding: number[], path?: string }>} indexChunks
 * @param {{ topK?: number, baseUrl?: string, embedModel?: string, embedTimeoutMs?: number }} opts
 * @returns {Promise<Array<{ text: string, path?: string, score: number }>>}
 */
async function retrieve(query, indexChunks, opts = {}) {
  const topK = opts.topK ?? 5;
  if (indexChunks.length === 0) return [];
  const queryEmbedding = await embed(query, {
    baseUrl: opts.baseUrl,
    embedModel: opts.embedModel,
    embedTimeoutMs: opts.embedTimeoutMs,
    authHeaders: opts.authHeaders
  });
  const scored = indexChunks.map(chunk => ({
    text: chunk.text,
    path: chunk.path,
    score: cosineSimilarity(queryEmbedding, chunk.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Formatea fragmentos recuperados para inyectar en el prompt.
 */
function formatRetrieved(chunks) {
  return chunks.map((c, i) => `[${i + 1}] ${c.path ? `(${c.path}) ` : ''}${c.text}`).join('\n\n');
}

module.exports = {
  chunkText,
  buildIndex,
  addChunksToIndex,
  retrieve,
  formatRetrieved,
  cosineSimilarity
};
