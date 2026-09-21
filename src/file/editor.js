// src/file/editor.js
const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils/logger.js');

class FileEditor {
  constructor(baseDir = process.cwd()) {
    this.base = path.resolve(baseDir);
  }

  async read(file) {
    const p = path.resolve(this.base, file);
    logger.debug(`Reading ${p}`);
    return await fs.readFile(p, 'utf8');
  }

  async write(file, content) {
    const p = path.resolve(this.base, file);
    logger.debug(`Writing ${p}`);
    try {
      await fs.ensureDir(path.dirname(p));
      await fs.writeFile(p, content, 'utf8');
      return p;
    } catch (error) {
      logger.error('Error escribiendo archivo:', error.message);
      throw error;
    }
  }

  async patch(file, replacer) {
    try {
      const txt = await this.read(file);
      const updated = replacer(txt);
      return await this.write(file, updated);
    } catch (error) {
      logger.error('Error aplicando patch:', error.message);
      throw error;
    }
  }

  async delete(file) {
    const p = path.resolve(this.base, file);
    logger.info(`Deleting ${p}`);
    try {
      await fs.remove(p);
    } catch (error) {
      logger.error('Error eliminando archivo:', error.message);
      throw error;
    }
  }
}

module.exports = { FileEditor };
