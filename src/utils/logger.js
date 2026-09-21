// src/utils/logger.js
const fs = require('fs-extra');
const path = require('path');

// Crear directorio de logs si no existe
const logDir = path.join(__dirname, '../../logs');
fs.ensureDirSync(logDir);

module.exports = {
  info: (...msg) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[INFO] [${timestamp}] ${msg.join(' ')}`;
    console.log(logMessage);
    // También escribir en archivo de log
    fs.appendFileSync(path.join(logDir, 'app.log'), `${logMessage}\n`);
  },
  debug: (...msg) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[DEBUG] [${timestamp}] ${msg.join(' ')}`;
    console.log(logMessage);
    fs.appendFileSync(path.join(logDir, 'app.log'), `${logMessage}\n`);
  },
  warn: (...msg) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[WARN] [${timestamp}] ${msg.join(' ')}`;
    console.warn(logMessage);
    fs.appendFileSync(path.join(logDir, 'app.log'), `${logMessage}\n`);
  },
  error: (...msg) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[ERROR] [${timestamp}] ${msg.join(' ')}`;
    console.error(logMessage);
    fs.appendFileSync(path.join(logDir, 'app.log'), `${logMessage}\n`);
  }
};
