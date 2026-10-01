// llm/opencode-models.js - Catalogo de modelos con sus variantes (modificadores).
// Fuente: `opencode models --verbose` (JSON por modelo con objeto `variants`).
// La clave literal "none" (o {}) significa SIN variantes.

const { spawnSafe } = require('../utils/exec-safe');
const { OpencodeAdapter } = require('./opencode-adapter');

/** Extrae el primer objeto {...} balanceado (tolera basura alrededor). */
function extractFirstJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = null;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

/** Parsea la salida de `opencode models --verbose`. Puro y testeable. */
function parseModelsVerbose(stdout) {
  const out = [];
  const chunks = String(stdout || '').split(/^(opencode\/\S+|ollama\/\S+|[A-Za-z0-9_.-]+\/\S+)\s*$/m);
  for (let i = 1; i < chunks.length; i += 2) {
    const fullId = chunks[i].trim();
    const obj = extractFirstJsonObject(chunks[i + 1]);
    if (!obj || typeof obj !== 'object') continue;
    const provider = fullId.includes('/') ? fullId.split('/')[0] : '';
    const vars = obj.variants && typeof obj.variants === 'object' ? obj.variants : {};
    const variants = Object.keys(vars).filter((k) => k && k !== 'none');
    out.push({
      id: fullId,
      provider,
      name: obj.name || obj.id || fullId,
      variants
    });
  }
  return out;
}

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Lista el catalogo (con cache de 5 min). Nunca lanza: devuelve []. */
async function listCatalog() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  try {
    const adapter = new OpencodeAdapter({ mode: 'run' });
    const bin = await adapter.resolveBinary();
    const r = await spawnSafe(bin, ['models', '--verbose'], { timeoutMs: 60000, stdin: 'ignore' });
    if (r.code !== 0) return _cache || [];
    _cache = parseModelsVerbose(r.stdout);
    _cacheAt = Date.now();
    return _cache;
  } catch (e) {
    return _cache || [];
  }
}

function clearCatalogCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = { parseModelsVerbose, listCatalog, clearCatalogCache, CACHE_TTL_MS };
