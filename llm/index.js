// llm/index.js - FASE 5: barrel del motor de IA.
const { OpencodeAdapter, collectRunText, collectMessageText } = require('./opencode-adapter');
const { createAdapter } = require('./factory');

module.exports = { OpencodeAdapter, collectRunText, collectMessageText, createAdapter };
