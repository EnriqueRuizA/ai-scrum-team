// src/agent/local.js
const { OllamaClient } = require('../llm/ollama.js');
const { RAG } = require('../llm/ragi.js');
const { FileEditor } = require('../file/editor.js');
const { Validator } = require('../file/validator.js');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger.js');

class LocalAgent {
  constructor({ name, role, persona, config }) {
    this.id = uuidv4();
    this.name = name;
    this.role = role;
    this.persona = persona;
    this.config = config;
    this.llm = new OllamaClient({
      baseUrl: config.local.baseUrl || 'http://localhost:11434',
      apiKey: config.local.apiKey || ''
    });
    this.rag = new RAG({
      indexPaths: config.local.rag?.indexPaths || [],
      topK: config.local.rag?.topK || 5,
      embedModel: config.local.rag?.embedModel || 'nomic-embed-text',
      ollama: this.llm
    });
    this.editor = new FileEditor();
  }

  async init() {
    if (this.config.local.rag?.enabled) {
      logger.info(`(${this.role}) Construyendo RAG…`);
      await this.rag.build();
    }
    logger.info(`(${this.role}) Agente inicializado`);
  }

  async generatePrompt(prompt) {
    const messages = [
      { role: 'system', content: `Eres ${this.persona}.` },
      { role: 'user', content: prompt }
    ];
    const ctx = await this.rag.query(prompt);
    if (ctx.length) {
      messages.push({ role: 'assistant', content: `Contexto relevante: ${ctx.map(c => c.snippet).join('\n')}` });
    }
    const res = await this.llm.generate({ model: this.config.local.model, messages });
    return res.choices[0].message.content;
  }

  async handleResponse(response) {
    try {
      const obj = JSON.parse(response);
      if (obj.action === 'write') {
        await this.editor.write(obj.file, obj.content);
        logger.info(`(${this.role}) Archivo ${obj.file} creado/actualizado`);
      } else if (obj.action === 'lint') {
        const result = await Validator.lint(obj.file);
        logger.info(`(${this.role}) Lint ${obj.file}: ${result.ok ? 'OK' : 'FAIL'}`);
      } else if (obj.action === 'test') {
        const result = await Validator.test();
        logger.info(`(${this.role}) Tests: ${result.ok ? 'PASSED' : 'FAILED'}`);
      } else {
        logger.warn(`(${this.role}) Acción desconocida: ${obj.action}`);
      }
    } catch (e) {
      logger.error(`(${this.role}) Error procesando respuesta: ${e.message}`);
    }
  }

  async runTask(taskPrompt) {
    const res = await this.generatePrompt(taskPrompt);
    await this.handleResponse(res);
    return res;
  }
}

module.exports = { LocalAgent };