// agents/opencode-agent.js - FASE 2: agente por rol sobre el motor opencode.
// Cumple la interfaz normalizada de agents/factory.js:
//   { name, role, on, initialize, sendMessage(msg, isFirst?), close }.
// La persona (system prompt) se antepone solo en el primer mensaje.

const { parseLlmJsonResponse } = require('../lib/parse-llm-json');

class OpencodeAgent {
  constructor({ name, role, persona, adapter, model, files = [], timeoutMs }) {
    this.name = name;
    this.role = role;
    this.persona = persona || '';
    this.adapter = adapter;
    this.model = model || null;
    this.files = files;
    this.timeoutMs = timeoutMs;
    this.initialized = false;
    this.eventHandlers = {};
    this._firstSent = false;
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers[event];
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(data);
      } catch (e) {
        console.error(`[opencode-agent:${this.role}] handler ${event}:`, e.message);
      }
    }
  }

  log(message, level = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      agent: this.name,
      role: this.role,
      level,
      message
    };
    this.emit('log', entry);
    console.log(`[${entry.timestamp}] [${this.role}] ${message}`);
  }

  async initialize() {
    const health = await this.adapter.health();
    if (!health.ok) {
      throw new Error(`Motor opencode no disponible: ${health.error}. ${health.hint || ''}`);
    }
    this.initialized = true;
    this.emit('ready', { agent: this.name, role: this.role });
    this.log(`Agente ${this.name} listo (opencode/${health.mode}${health.version ? ` ${health.version}` : ''})`);
  }

  async startNewConversation() {
    this._firstSent = false;
    this.log('Nueva conversacion (opencode)');
  }

  async sendMessage(message, isFirstMessage = false) {
    const first = isFirstMessage || !this._firstSent;
    const prompt = first && this.persona ? `${this.persona}\n\n---\n\n${message}` : message;
    this._firstSent = true;

    this.log(`Enviando mensaje (${prompt.length} chars)...`);
    this.emit('sending', { agent: this.name, preview: String(message).substring(0, 100) });

    const { text } = await this.adapter.generate({
      agent: undefined, // el rol ya viaja en la persona; el agent de opencode es opcional
      prompt,
      files: this.files,
      title: `${this.role}`,
      model: this.model || undefined,
      timeoutMs: this.timeoutMs
    });

    this.emit('response', { agent: this.name, preview: (text || '').substring(0, 200) });
    this.log('Respuesta recibida (opencode)');
    return text || '';
  }

  parseJSONResponse(text) {
    try {
      const parsed = parseLlmJsonResponse(text);
      if (parsed != null) return parsed;
    } catch (e) {
      this.log(`Error parseando JSON: ${e.message}`, 'warn');
    }
    if (text && String(text).trim()) {
      this.log('No se pudo extraer JSON valido del modelo', 'warn');
    }
    return null;
  }

  async close() {
    this.log('Agente opencode cerrado');
  }
}

module.exports = OpencodeAgent;
