// orchestrator.js - FASE 1: shim de compatibilidad.
// La implementacion real vive en orchestrator/index.js. Este fichero existe
// solo para no romper `require('./orchestrator')` (server.js, tests).
// Se eliminara en FASE 5 cuando server.js migre a server/app.js.

module.exports = require('./orchestrator/index');
