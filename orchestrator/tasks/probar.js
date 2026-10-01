// orchestrator/tasks/probar.js - U1: pruebas y reporte QA.
module.exports = {
  id: 'probar',
  label: 'Probar',
  buildPrompt({ run }) {
    const impl = run.lastImplementation || {};
    return (
      `Prueba el resultado del sprint ${run.sprintN}. ` +
      `Ficheros: ${JSON.stringify(impl.written || [])}. ` +
      `Checks: ${JSON.stringify(impl.checks || null)}. ` +
      `Responde SOLO con JSON: {"qa":{"passed":true,"bugs":[{"severity":"critical|major|minor","title":"...","detail":"..."}]}}`
    );
  },
  parse({ parsed }) {
    const qa =
      parsed?.qa && typeof parsed.qa === 'object' ? parsed.qa : { passed: true, bugs: [], unparsed: true };
    return { data: { qa } };
  }
};
