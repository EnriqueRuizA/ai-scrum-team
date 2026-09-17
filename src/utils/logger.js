// src/utils/logger.js
module.exports = {
  info: (...msg) => console.log('[INFO]', ...msg),
  debug: (...msg) => console.log('[DEBUG]', ...msg),
  warn: (...msg) => console.warn('[WARN]', ...msg),
  error: (...msg) => console.error('[ERROR]', ...msg)
};