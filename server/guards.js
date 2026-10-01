// server/guards.js - FASE 3: validacion de entradas no confiables.
// validateSessionId(): allowlist estricta ^session-[A-Za-z0-9-]{1,64}$.
// safeJoin(): une rutas y exige containment (el resuelto queda dentro de base).
// sanitizeKey(): rechaza __proto__/constructor/prototype (prototype pollution).
// escHtml(): escape para interpolar en HTML (el dashboard tiene el suyo propio;
//   este es para uso en servidor si alguna vez se renderiza aqui).

const path = require('path');

const SESSION_ID_RE = /^session-[A-Za-z0-9-]{1,64}$/;
const ARTIFACT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function validateSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

function validateArtifactName(name) {
  return typeof name === 'string' && ARTIFACT_NAME_RE.test(name);
}

/**
 * Une base + segmentos y devuelve la ruta solo si queda contenida en base.
 * Lanza Error en caso contrario (traversal, absolutas, NUL...).
 */
function safeJoin(base, ...parts) {
  const resolvedBase = path.resolve(base) + path.sep;
  for (const p of parts) {
    if (typeof p !== 'string' || p.includes('\0')) {
      throw new Error('Segmento de ruta invalido');
    }
  }
  const joined = path.resolve(base, ...parts);
  if (joined !== resolvedBase.slice(0, -1) && !joined.startsWith(resolvedBase)) {
    throw new Error('Ruta fuera del directorio permitido');
  }
  return joined;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeKey(key) {
  return typeof key === 'string' && !FORBIDDEN_KEYS.has(key);
}

/** Filtra claves peligrosas de un objeto plano (1 nivel). */
function sanitizeKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    if (!isSafeKey(k)) continue;
    out[k] = obj[k];
  }
  return out;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  SESSION_ID_RE,
  ARTIFACT_NAME_RE,
  validateSessionId,
  validateArtifactName,
  safeJoin,
  isSafeKey,
  sanitizeKeys,
  escHtml
};
