// orchestrator/tasks/refinar.js - U1: refinado de historias (tipo PO).
module.exports = {
  id: 'refinar',
  label: 'Refinar',
  buildPrompt({ run }) {
    return (
      `Refina estas historias para el sprint ${run.sprintN}: ${JSON.stringify(run.stories)}. ` +
      `Responde SOLO con JSON: {"stories":[{"id":"...","title":"...","acceptance":"..."}]}`
    );
  },
  parse({ parsed }) {
    const stories = Array.isArray(parsed?.stories) && parsed.stories.length > 0 ? parsed.stories : null;
    return { data: { stories } };
  }
};
