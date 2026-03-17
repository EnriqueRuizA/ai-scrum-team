// agents/local-rag-agent.js - Agente que usa IA local (Ollama) + RAG para edición y generación

const { generate, embed } = require('../lib/local-llm');
const { buildIndex, addChunksToIndex, retrieve, formatRetrieved } = require('../lib/rag');
const path = require('path');
const fs = require('fs-extra');

class LocalRAGAgent {
  constructor({ name, role, persona, config, sessionDir = './sessions', outputDir = null }) {
    this.name = name;
    this.role = role;
    this.persona = persona;
    this.config = config;
    this.sessionDir = sessionDir;
    this.outputDir = outputDir;
    this.initialized = false;
    this.eventHandlers = {};
    this.ragChunks = [];
    this.timeout = (config?.agents?.timeout || 180000);

    const local = config?.agents?.local || {};
    this.llmBaseUrl = local.baseUrl || 'http://localhost:11434';
    this.llmModel = local.model || 'llama3.2';
    this.ragEnabled = local.rag?.enabled === true;
    this.ragTopK = local.rag?.topK ?? 5;
    this.ragIndexPaths = local.rag?.indexPaths || [];
    this.embedModel = local.embedModel || local.rag?.embedModel || 'nomic-embed-text';
  }

  on(event, handler) {
    this.eventHandlers[event] = handler;
  }

  emit(event, data) {
    if (this.eventHandlers[event]) this.eventHandlers[event](data);
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, agent: this.name, role: this.role, level, message };
    this.emit('log', logEntry);
    console.log(`[${timestamp}] [${this.role}] ${message}`);
  }

  async initialize() {
    this.log('Inicializando agente local (Ollama + RAG)...');
    await fs.ensureDir(this.sessionDir);

    if (this.ragEnabled && (this.ragIndexPaths.length > 0 || this.outputDir)) {
      const paths = [...this.ragIndexPaths];
      if (this.outputDir) paths.push(this.outputDir);
      try {
        const { chunks } = await buildIndex(paths, {
          baseUrl: this.llmBaseUrl,
          embedModel: this.embedModel
        });
        this.ragChunks = chunks;
        this.log(`Índice RAG listo: ${this.ragChunks.length} fragmentos`);
      } catch (e) {
        this.log(`RAG index build failed: ${e.message}. Continuando sin RAG.`, 'warn');
        this.ragChunks = [];
      }
    }

    this.initialized = true;
    this.emit('ready', { agent: this.name, role: this.role });
    this.log(`Agente ${this.name} listo (local)`);
  }

  async startNewConversation() {
    this.log('Nueva conversación (local)');
  }

  /**
   * Añade fragmentos al índice RAG en caliente (p. ej. PRD, arquitectura, código actual).
   * Útil para que el modelo tenga contexto del proyecto sin re-indexar todo.
   */
  async addRAGContext(items) {
    if (!this.ragEnabled || !items?.length) return;
    try {
      const newChunks = await addChunksToIndex(items, {
        baseUrl: this.llmBaseUrl,
        embedModel: this.embedModel
      });
      this.ragChunks.push(...newChunks);
      this.log(`RAG: +${newChunks.length} fragmentos de contexto`);
    } catch (e) {
      this.log(`addRAGContext failed: ${e.message}`, 'warn');
    }
  }

  async sendMessage(message, isFirstMessage = false) {
    const fullMessage = isFirstMessage && this.persona
      ? `${this.persona}\n\n---\n\n${message}`
      : message;

    this.log(`Enviando mensaje (${fullMessage.length} chars)...`);
    this.emit('sending', { agent: this.name, preview: message.substring(0, 100) });

    let prompt = fullMessage;
    if (this.ragEnabled && this.ragChunks.length > 0) {
      const query = message.slice(0, 500);
      const retrieved = await retrieve(query, this.ragChunks, {
        topK: this.ragTopK,
        baseUrl: this.llmBaseUrl,
        embedModel: this.embedModel
      });
      if (retrieved.length > 0) {
        const context = formatRetrieved(retrieved);
        prompt = `Contexto relevante del proyecto/código (usa esto para respuestas precisas):\n\n${context}\n\n---\n\nPregunta/tarea:\n\n${fullMessage}`;
        this.log(`RAG: inyectados ${retrieved.length} fragmentos`);
      }
    }

    const response = await generate(prompt, {
      baseUrl: this.llmBaseUrl,
      model: this.llmModel,
      timeout: this.timeout
    });

    this.emit('response', { agent: this.name, preview: (response || '').substring(0, 200) });
    this.log('Respuesta recibida (local)');
    return response || '';
  }

  parseJSONResponse(text) {
    try {
      const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) return JSON.parse(codeBlockMatch[1]);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
      this.log(`Error parseando JSON: ${e.message}`, 'warn');
    }
    return null;
  }

  async close() {
    this.log('Agente local cerrado');
  }
}

module.exports = LocalRAGAgent;
