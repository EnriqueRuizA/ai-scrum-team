// agents/local-rag-agent.js - Agente que usa IA local (Ollama) + RAG para edición y generación

const { authHeadersFromLocalConfig } = require('../lib/local-llm');
const { generate } = require('../lib/unified-local-llm');
const { buildLlmConnectionInfo, formatLlmRequestOneLiner } = require('../lib/llm-connection-info');
const { resolveHttpAdapterFromLocal } = require('../lib/llm-provider-presets');
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

    const local = config?.agents?.local || {};
    // Timeout exclusivo para Ollama /api/generate (no uses agents.timeout del navegador: suele ser 3 min y es corto para PRD + modelos grandes).
    const explicit = local.generateTimeoutMs;
    this.llmTimeout =
      typeof explicit === 'number' && explicit > 0
        ? explicit
        : 900000; // 15 min por defecto

    this.llmBaseUrl = local.baseUrl || 'http://localhost:11434';
    this.llmModel = local.model || 'llama3.2';
    this.ragEnabled = local.rag?.enabled === true;
    this.ragTopK = local.rag?.topK ?? 5;
    this.ragIndexPaths = local.rag?.indexPaths || [];
    this.embedModel = local.embedModel || local.rag?.embedModel || 'nomic-embed-text';
    this.embedTimeoutMs =
      typeof local.embedTimeoutMs === 'number' && local.embedTimeoutMs > 0
        ? local.embedTimeoutMs
        : undefined;

    /** Cabeceras Authorization / X-API-Key según agents.local (clave en config o env). */
    this.llmAuthHeaders = authHeadersFromLocalConfig(local);

    /** Para logs: tipo de origen (local vs remoto) y etiqueta opcional. */
    this.llmConnectionInfo = buildLlmConnectionInfo(local);

    /** `ollama` | `openai_compatible` — según proveedor elegido. */
    this.httpAdapter = resolveHttpAdapterFromLocal(local);
  }

  /** Línea corta de verificación en cada llamada al modelo. */
  getLlmRequestLogLine() {
    return formatLlmRequestOneLiner(this.llmConnectionInfo, this.llmModel);
  }

  /** Opciones comunes para RAG → embed() en Ollama */
  getRagEmbedOpts() {
    return {
      baseUrl: this.llmBaseUrl,
      embedModel: this.embedModel,
      embedTimeoutMs: this.embedTimeoutMs,
      authHeaders: this.llmAuthHeaders,
      httpAdapter: this.httpAdapter
    };
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
    this.log(`Inicializando agente local… ${this.getLlmRequestLogLine()}`);
    await fs.ensureDir(this.sessionDir);

    if (this.ragEnabled && (this.ragIndexPaths.length > 0 || this.outputDir)) {
      const paths = [...this.ragIndexPaths];
      if (this.outputDir) paths.push(this.outputDir);
      try {
        const { chunks } = await buildIndex(paths, this.getRagEmbedOpts());
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
      const newChunks = await addChunksToIndex(items, this.getRagEmbedOpts());
      this.ragChunks.push(...newChunks);
      this.log(`RAG: +${newChunks.length} fragmentos de contexto`);
    } catch (e) {
      const hint =
        /404|not found|pull/i.test(String(e.message))
          ? this.httpAdapter === 'openai_compatible'
            ? ` Revisa el id del modelo de embeddings en la documentación del proveedor (embedModel: ${this.embedModel}).`
            : ` Instala el modelo de embeddings en Ollama (no se “importa” el RAG): ollama pull ${this.embedModel}`
          : '';
      this.log(`addRAGContext failed: ${e.message}.${hint}`, 'warn');
    }
  }

  async sendMessage(message, isFirstMessage = false) {
    const fullMessage = isFirstMessage && this.persona
      ? `${this.persona}\n\n---\n\n${message}`
      : message;

    this.log(`Enviando mensaje (${fullMessage.length} chars)… ${this.getLlmRequestLogLine()}`);
    this.emit('sending', {
      agent: this.name,
      preview: message.substring(0, 100),
      llmTarget: {
        preset: this.llmConnectionInfo.preset,
        userLabel: this.llmConnectionInfo.userLabel || null,
        host: this.llmConnectionInfo.host,
        model: this.llmModel,
        httpAdapter: this.httpAdapter
      }
    });

    let prompt = fullMessage;
    if (this.ragEnabled && this.ragChunks.length > 0) {
      const query = message.slice(0, 500);
      const retrieved = await retrieve(query, this.ragChunks, {
        topK: this.ragTopK,
        ...this.getRagEmbedOpts()
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
      timeout: this.llmTimeout,
      authHeaders: this.llmAuthHeaders,
      httpAdapter: this.httpAdapter
    });

    this.emit('response', { agent: this.name, preview: (response || '').substring(0, 200) });
    this.log('Respuesta recibida (local)');
    return response || '';
  }

  parseJSONResponse(text) {
    const { parseLlmJsonResponse } = require('../lib/parse-llm-json');
    try {
      const parsed = parseLlmJsonResponse(text);
      if (parsed != null) return parsed;
    } catch (e) {
      this.log(`Error parseando JSON: ${e.message}`, 'warn');
    }
    if (text && String(text).trim()) {
      this.log('No se pudo extraer JSON válido del modelo (¿```json sin cerrar o JSON truncado?)', 'warn');
    }
    return null;
  }

  async close() {
    this.log('Agente local cerrado');
  }
}

module.exports = LocalRAGAgent;
