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
    await fs.ensureDir(path.dirname(p));
    await fs.writeFile(p, content, 'utf8');
    return p;
  }

  async patch(file, replacer) {
    const txt = await this.read(file);
    const updated = replacer(txt);
    return await this.write(file, updated);
  }

  async delete(file) {
    const p = path.resolve(this.base, file);
    logger.info(`Deleting ${p}`);
    await fs.remove(p);
  }
}

module.exports = { FileEditor };