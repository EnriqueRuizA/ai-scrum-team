// orchestrator/tasks/plan.js - U1: planificacion del sprint (tipa Scrum).
module.exports = {
  id: 'plan',
  label: 'Planificar',
  buildPrompt({ run }) {
    const prev =
      run.sprintN > 1 && run.priorSteps.length > 0
        ? ` Contexto anterior: ${JSON.stringify(run.priorSteps.slice(-3))}. `
        : ' Es el primer sprint. ';
    const docs =
      run.sprintN === 1
        ? ' Si es el primer sprint, incluye tambien "prd", "architecture" y "testPlan".'
        : '';
    return (
      `Planifica el sprint ${run.sprintN}/${run.maxSprints}.${prev}` +
      `Responde SOLO con JSON: {"sprint":{"goal":"...","stories":[{"id":"S-1","title":"...","acceptance":"..."}]}}${docs}`
    );
  },
  parse({ parsed }) {
    const data = { sprint: { goal: '', stories: [] } };
    if (parsed && typeof parsed === 'object') {
      if (parsed.sprint && typeof parsed.sprint === 'object') data.sprint = parsed.sprint;
      for (const k of ['prd', 'architecture', 'testPlan']) {
        if (parsed[k] !== undefined) data[k] = parsed[k];
      }
    }
    return { data };
  }
};
