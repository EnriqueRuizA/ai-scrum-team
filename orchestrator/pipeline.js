// orchestrator/pipeline.js - U1: EJECUTOR GENERICO de flow (roles + tareas + loops).
// Cada paso = {role, task, loop?, onError?}. Todo await en cadena.
// Mantiene los artefactos legacy (prd/architecture/.../sprints[]) para que el
// dashboard actual siga funcionando, y anade steps[] genericos por sprint.

const fs = require('fs-extra');
const path = require('path');
const { parseLlmJsonResponse } = require('../lib/parse-llm-json');
const {
  runNodeSyntaxCheck,
  runNpmTestIfPresent
} = require('../lib/deliverable');
const { getTask } = require('./tasks');
const { roleById } = require('../agents/team-config');

const DEFAULT_STEP_TIMEOUT_MS = 30 * 60 * 1000;
const LOOP_MAX_HARD = 10;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedio el timeout (${ms} ms)`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Contencion minima de rutas de ficheros del LLM (endurecido en FASE 3). */
function assertSafeRelPath(rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('Ruta de fichero vacia');
  if (path.isAbsolute(rel)) throw new Error(`Ruta absoluta no permitida: ${rel}`);
  const norm = path.posix.normalize(rel.split(path.sep).join(path.posix.sep));
  if (norm === '..' || norm.startsWith('../') || norm.includes('\0')) {
    throw new Error(`Ruta fuera del proyecto: ${rel}`);
  }
  return norm;
}

/**
 * Ruta del modelo -> relativa contenida en baseDir.
 * Los modelos en Windows suelen devolver absolutas (P:\...\session-X\a.js):
 * si apuntan DENTRO de baseDir se aceptan relativizadas; si no, error.
 * Nunca deja escapar de baseDir (comparacion case-insensitive en win32).
 */
function toContainedRelPath(baseDir, p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('Ruta de fichero vacia');
  if (p.includes('\0')) throw new Error('Ruta de fichero invalida');
  const fail = () => {
    throw new Error(`Ruta fuera del proyecto: ${String(p).slice(0, 200)}`);
  };
  const resolvedBase = path.resolve(baseDir);
  const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(resolvedBase, p);
  const lowAbs = process.platform === 'win32' ? abs.toLowerCase() : abs;
  const lowBase = process.platform === 'win32' ? resolvedBase.toLowerCase() : resolvedBase;
  if (lowAbs !== lowBase && !lowAbs.startsWith(lowBase + path.sep)) fail();
  const rel = path.relative(resolvedBase, abs);
  if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) fail();
  return rel;
}

async function writeFilesContained(baseDir, files) {
  const written = [];
  const resolvedBase = path.resolve(baseDir);
  for (const f of files || []) {
    const rel = toContainedRelPath(resolvedBase, f.path);
    const dest = path.join(resolvedBase, rel);
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, f.code ?? f.content ?? '', 'utf8');
    written.push(rel);
  }
  return written;
}

async function askAgent(agent, prompt, ctx, opts = {}) {
  const timeoutMs = opts.timeoutMs || ctx.config.agents?.timeout || DEFAULT_STEP_TIMEOUT_MS;
  const t0 = Date.now();
  const text = await withTimeout(
    agent.sendMessage(prompt, !!opts.isFirst),
    timeoutMs,
    `${agent.role || agent.name}`
  );
  const parsed = parseLlmJsonResponse(text || '');
  return { text: text || '', parsed, ms: Date.now() - t0 };
}

/** Tope de texto en eventos WS/artefactos (evita respuestas gigantes en RAM). */
const MAX_EXCHANGE_CHARS = 200000;

function clipExchange(s) {
  const t = String(s || '');
  if (t.length <= MAX_EXCHANGE_CHARS) return { text: t, truncated: false };
  return { text: t.slice(0, MAX_EXCHANGE_CHARS), truncated: true };
}

/** Emite el intercambio completo (prompt+respuesta) para la vista Conversacion. */
function emitExchange(ctx, { sprint, step, kind, role, task, prompt, text, ms }) {
  const p = clipExchange(prompt);
  const r = clipExchange(text);
  ctx.emit('exchange', {
    timestamp: new Date().toISOString(),
    sprint,
    step,
    kind: kind || 'step',
    role,
    task,
    ms,
    prompt: p.text,
    promptTruncated: p.truncated,
    response: r.text,
    responseTruncated: r.truncated
  });
}

/** Intercambio recortado para guardar en el artefacto del paso. */
function clippedExchange(prompt, text, ms) {
  const p = clipExchange(prompt);
  const r = clipExchange(text);
  return {
    ms,
    prompt: p.text,
    promptTruncated: p.truncated,
    response: r.text,
    responseTruncated: r.truncated
  };
}

function artifactPaths(outputDir) {
  return {
    dir: path.join(outputDir, 'artifacts'),
    appDir: path.join(outputDir, 'final-app')
  };
}

async function saveArtifact(outputDir, name, data) {
  const { dir } = artifactPaths(outputDir);
  await fs.ensureDir(dir);
  const p = path.join(dir, `${name}.json`);
  await fs.writeJson(p, data, { spaces: 2 });
  return p;
}

/** Condiciones de loop evaluadas contra el contexto del sprint. */
function loopConditionMet(until, run) {
  switch (until) {
    case 'qa.passed':
      return run.lastQa != null && run.lastQa.passed !== false && (run.lastQa.bugs || []).length === 0;
    case 'noCriticalBugs': {
      const bugs = (run.lastQa && run.lastQa.bugs) || [];
      return !bugs.some((b) => b.severity === 'critical');
    }
    case 'filesWritten':
      return (run.lastWritten || []).length > 0;
    case 'always':
      return false; // itera hasta agotar max
    default:
      return true; // condicion desconocida = no repetir (fail-safe)
  }
}

async function runChecks(appDir) {
  const syntax = runNodeSyntaxCheck(appDir, []);
  const npmTest = runNpmTestIfPresent(appDir);
  return { syntax, npmTest: npmTest.ran ? npmTest : { ran: false, skipped: true } };
}

/**
 * Ejecuta un paso del flow y devuelve su artefacto.
 * exec = { ctx, outputDir, appDir, firstInSprint }
 */
async function runStep(step, index, run, exec) {
  const { ctx, outputDir, appDir } = exec;
  const role = roleById(ctx.roles, step.role);
  if (!role) throw new Error(`Paso ${index}: rol desconocido ${JSON.stringify(step.role)}`);
  if (role.enabled === false) {
    ctx.log(`Paso ${index} (${role.id}): rol deshabilitado, se omite.`, 'warn', 'ScrumMaster');
    return { step: index, role: role.id, task: step.task, skipped: true, iterations: [] };
  }
  const agent = ctx.agents[role.id];
  if (!agent) throw new Error(`Paso ${index}: agente no inicializado para rol ${JSON.stringify(role.id)}`);
  const task = getTask(step.task);

  const doOnce = async (iterationCtx) => {
    const prompt = task.buildPrompt({ step, role, run: { ...run, ...iterationCtx } });
    const { text, parsed, ms } = await askAgent(agent, prompt, ctx, { isFirst: exec.firstInSprint });
    exec.firstInSprint = false;
    const result = task.parse({ text, parsed });
    const artifact = {
      step: index,
      role: role.id,
      task: task.id,
      data: result.data,
      iterations: [],
      exchange: clippedExchange(prompt, text, ms)
    };
    emitExchange(ctx, {
      sprint: run.sprintN, step: index, kind: 'step',
      role: role.id, task: task.id, prompt, text, ms
    });
    if (result.files && result.files.length > 0) {
      const written = await writeFilesContained(appDir, result.files);
      artifact.written = written;
      run.lastWritten = written;
      ctx.log(`Paso ${index} (${role.id}): ${written.length} ficheros en final-app`, 'info', 'ScrumMaster');
    }
    if (task.id === 'implementar') {
      artifact.checks = await runChecks(appDir);
      await saveArtifact(outputDir, `sprint-${run.sprintN}-checks`, artifact.checks);
    }
    return artifact;
  };

  const artifact = await doOnce({});
  applyToRunContext(artifact, run);

  // Loop opcional (p.ej. QA -> fix -> QA hasta pasar o agotar max).
  // Cada iteracion: fix opcional + re-ejecucion del propio paso.
  if (step.loop && typeof step.loop === 'object') {
    const max = Math.min(Math.max(1, step.loop.max | 0 || 1), LOOP_MAX_HARD);
    const fix = step.loop.fix && typeof step.loop.fix === 'object' ? step.loop.fix : null;
    if (fix) {
      const fixRole = roleById(ctx.roles, fix.role);
      const fixAgent = fixRole ? ctx.agents[fixRole.id] : null;
      const fixTask = fix ? getTask(fix.task) : null;
      if (!fixRole || !fixAgent || !fixTask) {
        throw new Error(`Paso ${index}: fix invalido ${JSON.stringify(fix)}`);
      }
    }
    let iter = 0;
    while (!loopConditionMet(step.loop.until, run) && iter < max) {
      iter += 1;
      ctx.log(`Paso ${index} (${role.id}): loop ${iter}/${max} (until=${step.loop.until})`, 'warn', 'ScrumMaster');
      if (fix) {
        const fixRole = roleById(ctx.roles, fix.role);
        const fixAgent = ctx.agents[fixRole.id];
        const fixTask = getTask(fix.task);
        const fixPrompt =
          (fix.brief ? `${fix.brief}\n\n` : '') +
          fixTask.buildPrompt({ step: { ...step, ...fix }, role: fixRole, run });
        const fres = await askAgent(fixAgent, fixPrompt, ctx, {});
        const fresult = fixTask.parse({ text: fres.text, parsed: fres.parsed });
        const it = { n: iter, kind: 'fix', role: fixRole.id, task: fixTask.id, data: fresult.data, ms: fres.ms };
        if (fresult.files && fresult.files.length > 0) {
          it.written = await writeFilesContained(appDir, fresult.files);
          run.lastWritten = it.written;
        }
        if (fixTask.id === 'implementar') it.checks = await runChecks(appDir);
        it.exchange = clippedExchange(fixPrompt, fres.text, fres.ms);
        artifact.iterations.push(it);
        emitExchange(ctx, {
          sprint: run.sprintN, step: index, kind: 'fix',
          role: fixRole.id, task: fixTask.id, prompt: fixPrompt, text: fres.text, ms: fres.ms
        });
        applyToRunContext({ ...artifact, data: fresult.data, written: it.written }, run, true);
      }
      const retryPrompt = task.buildPrompt({ step, role, run });
      const { text, parsed, ms } = await askAgent(agent, retryPrompt, ctx, {});
      const result = task.parse({ text, parsed });
      const retry = { n: iter, kind: 'retry', role: role.id, task: task.id, data: result.data, ms };
      if (result.files && result.files.length > 0) {
        retry.written = await writeFilesContained(appDir, result.files);
        run.lastWritten = retry.written;
      }
      if (task.id === 'implementar') retry.checks = await runChecks(appDir);
      retry.exchange = clippedExchange(retryPrompt, text, ms);
      artifact.iterations.push(retry);
      artifact.data = result.data;
      if (retry.written) artifact.written = retry.written;
      emitExchange(ctx, {
        sprint: run.sprintN, step: index, kind: 'retry',
        role: role.id, task: task.id, prompt: retryPrompt, text, ms
      });
      applyToRunContext(artifact, run, true);
    }
    if (!loopConditionMet(step.loop.until, run)) {
      ctx.log(`Paso ${index} (${role.id}): loop agoto max=${max} sin cumplir ${step.loop.until}`, 'warn', 'ScrumMaster');
    }
  }

  await saveArtifact(outputDir, `sprint-${run.sprintN}-step-${index}-${role.id}-${task.id}`, artifact);
  mapLegacyArtifacts(artifact, run, ctx, outputDir);
  return artifact;
}

/** Actualiza el contexto vivo (stories, lastImplementation, lastQa...). */
function applyToRunContext(artifact, run, fromIteration = false) {
  const d = artifact.data || {};
  if (artifact.task === 'plan' && d.sprint) {
    if (d.sprint.goal) run.goal = d.sprint.goal;
    if (Array.isArray(d.sprint.stories)) run.stories = d.sprint.stories;
  }
  if (artifact.task === 'refinar' && Array.isArray(d.stories) && d.stories.length > 0) {
    run.stories = d.stories;
  }
  if (artifact.task === 'implementar' && d.implementation) {
    run.lastImplementation = { ...d.implementation, written: artifact.written || [] };
    if (artifact.checks) run.lastImplementation.checks = artifact.checks;
  }
  if (artifact.task === 'probar' && d.qa) run.lastQa = d.qa;
  if (artifact.task === 'revisar' && d.review) run.lastReview = d.review;
  if (!fromIteration) run.priorSteps.push({ step: artifact.step, role: artifact.role, task: artifact.task });
}

/** Compat dashboard actual: rellena prd/architecture/sprintPlan/implementations/qaReports. */
function mapLegacyArtifacts(artifact, run, ctx, outputDir) {
  const d = artifact.data || {};
  const save = (name, data) => saveArtifact(outputDir, name, data).catch(() => {});
  if (artifact.task === 'plan') {
    if (d.sprint) {
      ctx.state.artifacts.sprintPlan = d.sprint;
      save(`sprint-${run.sprintN}-plan`, d.sprint);
    }
    if (run.sprintN === 1) {
      if (d.prd) {
        ctx.state.artifacts.prd = d.prd;
        save('prd', d.prd);
      }
      if (d.architecture) {
        ctx.state.artifacts.architecture = d.architecture;
        save('architecture', d.architecture);
      }
      if (d.testPlan) {
        ctx.state.artifacts.testPlan = d.testPlan;
        save('testPlan', d.testPlan);
      }
    }
  }
  if (artifact.task === 'implementar' && d.implementation) {
    const entry = { sprint: run.sprintN, ...d.implementation };
    if (artifact.written) entry.written = artifact.written;
    if (artifact.checks) entry.checks = artifact.checks;
    if (artifact.iterations && artifact.iterations.length > 0) entry.iterations = artifact.iterations;
    ctx.state.artifacts.implementations.push(entry);
    save(`sprint-${run.sprintN}-implementation`, d.implementation);
  }
  if (artifact.task === 'probar' && d.qa) {
    const entry = { sprint: run.sprintN, ...d.qa };
    if (artifact.iterations && artifact.iterations.length > 0) entry.iterations = artifact.iterations;
    ctx.state.artifacts.qaReports.push(entry);
    save(`sprint-${run.sprintN}-qa`, d.qa);
    ctx.emit('sprint_update', { sprint: run.sprintN, phase: 'tested', passed: d.qa.passed !== false });
  }
  if (artifact.task === 'revisar' && d.review) {
    ctx.emit('sprint_update', { sprint: run.sprintN, phase: 'reviewed', review: d.review });
  }
}

/**
 * Ejecuta el proyecto completo.
 * ctx = { config, roles, flow, agents (por id), outputDir, state,
 *         log, emit, waitWhilePaused, checkGracefulStopAfterStep, saveState,
 *         startFrom? } (startFrom = nº de sprint inicial, para reanudar).
 */
async function runPipeline(ctx) {
  const { config, outputDir } = ctx;
  const roles = ctx.roles && ctx.roles.length > 0 ? ctx.roles : [];
  const flow = ctx.flow && ctx.flow.length > 0 ? ctx.flow : [];
  if (roles.length === 0) throw new Error('Sin roles configurados (agents.roles)');
  if (flow.length === 0) throw new Error('Sin flow configurado (agents.flow)');
  const { dir, appDir } = artifactPaths(outputDir);
  await fs.ensureDir(dir);
  await fs.ensureDir(appDir);

  const maxSprints = config.scrum?.maxSprints || 3;
  // Reanudar: no se repiten sprints ya guardados en state.sprints.
  const startFrom = Math.max(1, Math.min(ctx.startFrom | 0 || 1, maxSprints));
  const exec = { ctx, outputDir, appDir, firstInSprint: true };

  for (let n = startFrom; n <= maxSprints; n++) {
    await ctx.waitWhilePaused();
    ctx.log(`=== Sprint ${n}/${maxSprints} ===`, 'info', 'ScrumMaster');
    ctx.emit('sprint_start', { sprint: n, maxSprints });
    exec.firstInSprint = true;

    const run = {
      sprintN: n,
      maxSprints,
      goal: `Sprint ${n}`,
      stories: [],
      lastImplementation: null,
      lastQa: null,
      lastWritten: [],
      lastReview: null,
      priorSteps: n > 1 ? [{ sprint: n - 1, summary: ctx.state.sprints[n - 2] || null }] : []
    };

    for (let i = 0; i < flow.length; i++) {
      await ctx.waitWhilePaused();
      const step = flow[i];
      try {
        await runStep(step, i, run, exec);
        ctx.emit('sprint_update', { sprint: n, phase: `step-${i}`, step });
      } catch (e) {
        const onError = step.onError || 'abort';
        ctx.log(`Paso ${i} (${step.role}/${step.task}) fallo: ${e.message}`, 'error', 'ScrumMaster');
        if (onError !== 'continue') throw e;
      }
    }

    ctx.state.sprints.push({
      n,
      plan: { goal: run.goal, stories: run.stories },
      qa: run.lastQa ? { passed: run.lastQa.passed } : null,
      review: run.lastReview || null
    });
    ctx.state.currentSprint = n;
    await ctx.saveState();

    if (await ctx.checkGracefulStopAfterStep(`Parada solicitada: detenido tras el sprint ${n}.`)) {
      return { stopped: true, sprint: n };
    }
  }

  const finalFiles = [];
  try {
    const walk = async (d) => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else finalFiles.push(path.relative(appDir, p));
      }
    };
    await walk(appDir);
  } catch (e) {
    ctx.log(`No se pudo listar final-app: ${e.message}`, 'warn', 'ScrumMaster');
  }
  ctx.state.artifacts.finalCode = { files: finalFiles, appDir: path.resolve(appDir) };
  await saveArtifact(outputDir, 'final-code', ctx.state.artifacts.finalCode);
  await ctx.saveState();
  return { stopped: false, sprints: maxSprints };
}

module.exports = { runPipeline, withTimeout, assertSafeRelPath, toContainedRelPath, writeFilesContained, loopConditionMet };
