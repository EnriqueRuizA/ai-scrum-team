// orchestrator/tasks/libre.js - U1: tarea sin formato (no se parsea, solo se guarda).
module.exports = {
  id: 'libre',
  label: 'Libre',
  buildPrompt({ step, run }) {
    const brief = step.brief ? `${step.brief}\n\n` : '';
    return `${brief}Contexto del sprint ${run.sprintN}/${run.maxSprints}: ${JSON.stringify(run.stories)}. Responde en texto libre.`;
  },
  parse({ text }) {
    return { data: { text: text || '' } };
  }
};
