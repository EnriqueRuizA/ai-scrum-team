// orchestrator/tasks/implementar.js - U1: implementacion (tipo Dev).
const { extractFilesFromImplementation } = require('../../lib/deliverable');

module.exports = {
  id: 'implementar',
  label: 'Implementar',
  buildPrompt({ run }) {
    return (
      `Implementa el sprint ${run.sprintN} con estas historias: ${JSON.stringify(run.stories)}. ` +
      `Responde SOLO con JSON: {"implementation":{"files":[{"path":"...","code":"..."}],"notes":"..."}} ` +
      `Usa rutas de fichero RELATIVAS al proyecto (p. ej. "src/index.js"), nunca absolutas.`
    );
  },
  parse({ text, parsed }) {
    if (parsed?.implementation) {
      const files = extractFilesFromImplementation({ implementation: parsed.implementation });
      return { data: { implementation: parsed.implementation }, files };
    }
    return { data: { implementation: { files: [], notes: (text || '').slice(0, 2000), raw: true } }, files: [] };
  }
};
