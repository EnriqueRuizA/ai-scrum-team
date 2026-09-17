// src/llm/ragi.js
const { OllamaClient } = require('./ollama.js');
const { logger } = require('../utils/logger.js');

class RAG {
  constructor({ indexPaths = [], topK = 5, embedModel = 'nomic-embed-text', ollama }) {
    this.paths = indexPaths.map(p => require('path').resolve(p));
    this.topK = topK;
    this.embedModel = embedModel;
    this.ollama = ollama;
    this.vectorStore = [];
  }

  async build() {
    logger.info('Construyendo índice RAG...');
    for (const dir of this.paths) {
      const files = await require('fs-extra').readdir(dir);
      for (const f of files) {
        const p = require('path').join(dir, f);
        if (require('fs').statSync(p).isDirectory()) continue;
        if (!['.js', '.md', '.json'].includes(require('path').extname(p))) continue;
        const text = await require('fs-extra').readFile(p, 'utf8');
        const embedding = await this.ollama.embeddings({ model: this.embedModel, inputs: [text] });
        this.vectorStore.push({ id: p, content: text, embedding: embedding.data[0] });
      }
    }
    logger.info(`Índice RAG construido con ${this.vectorStore.length} vectores`);
  }

  async query(queryText) {
    const qEmbed = await this.ollama.embeddings({ model: this.embedModel, inputs: [queryText] });
    const scores = this.vectorStore.map(v => ({
      id: v.id,
      score: cosineSimilarity(qEmbed.data[0], v.embedding),
      snippet: v.content.slice(0, 300) + '…'
    }));
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, this.topK);
  }
}

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0);
  const normA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const normB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return dot / (normA * normB + 1e-10);
}

module.exports = { RAG };