// orchestrator/tasks/index.js - U1: tipos de tarea cerrados.
// Cada tarea = { id, label, buildPrompt({step, role, run}) -> string,
//                parse({text, parsed}) -> { data, files? } }.
// `run` = contexto de ejecucion: { sprintN, maxSprints, goal, stories,
//         lastImplementation, lastQa, priorSteps }.

const plan = require('./plan');
const refinar = require('./refinar');
const implementar = require('./implementar');
const probar = require('./probar');
const revisar = require('./revisar');
const libre = require('./libre');

const TASKS = { plan, refinar, implementar, probar, revisar, libre };
const TASK_IDS = Object.keys(TASKS);

function getTask(id) {
  const t = TASKS[id];
  if (!t) throw new Error(`Tarea desconocida: ${JSON.stringify(id)} (validas: ${TASK_IDS.join(', ')})`);
  return t;
}

module.exports = { TASKS, TASK_IDS, getTask };
