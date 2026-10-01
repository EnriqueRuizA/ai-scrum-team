// llm/factory.js - FASE 2: crea el adapter segun la config.
// Unico punto de decision del motor. Hoy solo existe el motor opencode
// (modelos gratuitos); los proveedores de pago son solo configuracion
// dentro de opencode, no codigo de este proyecto.

const { OpencodeAdapter } = require('./opencode-adapter');

function createAdapter(config) {
  const oc = (config && config.agents && config.agents.opencode) || {};
  return new OpencodeAdapter({
    mode: oc.mode || 'serve',
    url: oc.url || process.env.OPENCODE_URL || 'http://127.0.0.1:4096',
    model: oc.model || process.env.OPENCODE_MODEL || 'ollama/llama3.2',
    dir: oc.dir || process.cwd(),
    timeoutMs: oc.timeoutMs,
    auto: oc.auto === true,
    command: oc.command || process.env.OPENCODE_BIN || 'opencode'
  });
}

module.exports = { createAdapter };
