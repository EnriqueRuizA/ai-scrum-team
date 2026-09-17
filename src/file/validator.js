// src/file/validator.js
const { execSync } = require('child_process');
const { logger } = require('../utils/logger.js');

class Validator {
  static async lint(file) {
    try {
      execSync(`npx eslint ${file} --quiet`, { stdio: 'pipe' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.stdout.toString() };
    }
  }

  static async syntax(file) {
    try {
      await import(file);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  static async test() {
    try {
      const out = execSync('npm test --silent', { encoding: 'utf8' });
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, error: e.stdout };
    }
  }
}

module.exports = { Validator };