// orchestrator/tasks/revisar.js - U1: cierre del sprint (tipo SM).
module.exports = {
  id: 'revisar',
  label: 'Revisar',
  buildPrompt({ run }) {
    return (
      `Cierra el sprint ${run.sprintN}. ` +
      `Historias: ${JSON.stringify(run.stories)}. QA: ${JSON.stringify(run.lastQa || null)}. ` +
      `Responde SOLO con JSON: {"review":{"done":true,"summary":"...","next":"..."}}`
    );
  },
  parse({ parsed }) {
    const review = parsed?.review && typeof parsed.review === 'object' ? parsed.review : { done: true };
    return { data: { review } };
  }
};
