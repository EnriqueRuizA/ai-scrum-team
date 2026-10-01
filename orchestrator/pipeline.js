// orchestrator/pipeline.js - FASE 1: secuencia estricta del proyecto.
// plan -> PO refine -> dev implement -> checks -> QA -> fix -> review, por sprint.
// Todo await en cadena (nunca Promise.all entre roles). Trabaja contra la
// interfaz normalizada de agentes (initialize/sendMessage/close + eventos).

const fs = require('fs-extra');
const path = require('path');
const { parseLlmJsonResponse } = require('../lib/parse-llm-json');
const {
  extractFilesFromImplementation,
  runNodeSyntaxCheck,
  runNpmTestIfPresent
} = require('../lib/deliverable');

const DEFAULT_STEP_TIMEOUT_MS = 30 * 60 * 1000;

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

/** Contencion minima de rutas de ficheros del LLM (FASE 3 la endurece). */
function assertSafeRelPath(rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('Ruta de fichero vacia');
  if (path.isAbsolute(rel)) throw new Error(`Ruta absoluta no permitida: ${rel}`);
  const norm = path.posix.normalize(rel.split(path.sep).join(path.posix.sep));
  if (norm === '..' || norm.startsWith('../') || norm.includes('\0')) {
    throw new Error(`Ruta fuera del proyecto: ${rel}`);
  }
  return norm;
}

async function writeFilesContained(baseDir, files) {
  const written = [];
  for (const f of files || []) {
    const rel = assertSafeRelPath(f.path);
    const dest = path.join(baseDir, rel);
    // Doble comprobacion: el destino resuelto debe seguir dentro de baseDir.
    const resolvedBase = path.resolve(baseDir) + path.sep;
    if (!path.resolve(dest).startsWith(resolvedBase)) {
      throw new Error(`Ruta fuera del proyecto: ${f.path}`);
    }
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, f.code ?? f.content ?? '', 'utf8');
    written.push(rel);
  }
  return written;
}

async function askAgent(agent, prompt, ctx, opts = {}) {
  const timeoutMs =
    (opts.timeoutMs ||
      ctx.config.agents?.timeout ||
      DEFAULT_STEP_TIMEOUT_MS);
  const text = await withTimeout(
    agent.sendMessage(prompt, !!opts.isFirst),
    timeoutMs,
    `${agent.role || agent.name}`
  );
  const parsed = parseLlmJsonResponse(text || '');
  return { text: text || '', parsed };
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

/**
 * Ejecuta el proyecto completo.
 * ctx = { config, team, agents, outputDir, log(msg, level?, agent?),
 *         emit(event, data), waitWhilePaused(), checkGracefulStopAfterStep(msg),
 *         saveState(), enabledRoles:Set }
 */
async function runPipeline(ctx) {
  const { config, agents, outputDir } = ctx;
  const { dir, appDir } = artifactPaths(outputDir);
  await fs.ensureDir(dir);
  await fs.ensureDir(appDir);

  const maxSprints = config.scrum?.maxSprints || 3;
  const enabled = ctx.enabledRoles;
  const has = (r) => enabled.has(r);
  const get = (r) => agents[r] || null;

  const mustHave = (r) => {
    const a = get(r);
    if (!a) throw new Error(`Agente requerido no disponible: ${r}`);
    return a;
  };

  for (let n = 1; n <= maxSprints; n++) {
    await ctx.waitWhilePaused();
    ctx.log(`=== Sprint ${n}/${maxSprints} ===`, 'info', 'ScrumMaster');
    ctx.emit('sprint_start', { sprint: n, maxSprints });

    // 1. Sprint planning (Scrum Master; por defecto un plan minimo)
    let plan = { goal: `Sprint ${n}`, stories: [] };
    if (has('scrumMaster')) {
      const sm = mustHave('scrumMaster');
      const prev = n > 1 ? ` Contexto del sprint anterior: ${JSON.stringify(ctx.state.sprints[n - 2] || null)}. ` : ' Es el primer sprint. ';
      const { parsed } = await askAgent(
        sm,
        `Planifica el sprint ${n}/${maxSprints}.${prev}Responde SOLO con JSON: {"sprint":{"goal":"...","stories":[{"id":"S-1","title":"...","acceptance":"..."}]}}`,
        ctx,
        { isFirst: n === 1 }
      );
      if (parsed?.sprint) plan = parsed.sprint;
      if (n === 1 && parsed && (parsed.prd || parsed.architecture || parsed.testPlan)) {
        if (parsed.prd) {
          ctx.state.artifacts.prd = parsed.prd;
          await saveArtifact(outputDir, 'prd', parsed.prd);
        }
        if (parsed.architecture) {
          ctx.state.artifacts.architecture = parsed.architecture;
          await saveArtifact(outputDir, 'architecture', parsed.architecture);
        }
        if (parsed.testPlan) {
          ctx.state.artifacts.testPlan = parsed.testPlan;
          await saveArtifact(outputDir, 'testPlan', parsed.testPlan);
        }
      }
    }
    ctx.state.artifacts.sprintPlan = plan;
    await saveArtifact(outputDir, `sprint-${n}-plan`, plan);
    ctx.emit('sprint_update', { sprint: n, phase: 'planned', plan });

    // 2. Refinado (Product Owner)
    let stories = plan.stories || [];
    if (has('productOwner')) {
      const po = mustHave('productOwner');
      const { parsed } = await askAgent(
        po,
        `Refina estas historias para el sprint ${n}: ${JSON.stringify(stories)}. Responde SOLO con JSON: {"stories":[{"id":"...","title":"...","acceptance":"..."}]}`,
        ctx
      );
      if (Array.isArray(parsed?.stories) && parsed.stories.length > 0) stories = parsed.stories;
    }

    // 3. Implementacion (Developer)
    let implementation = { files: [], notes: '' };
    if (has('developer')) {
      const dev = mustHave('developer');
      const { parsed, text } = await askAgent(
        dev,
        `Implementa el sprint ${n} con estas historias: ${JSON.stringify(stories)}. Responde SOLO con JSON: {"implementation":{"files":[{"path":"...","code":"..."}],"notes":"..."}}`,
        ctx
      );
      if (parsed?.implementation) {
        implementation = parsed.implementation;
      } else if (text) {
        ctx.log('El desarrollador no devolvio JSON valido; se guarda la respuesta en bruto.', 'warn', 'ScrumMaster');
        implementation = { files: [], notes: text.slice(0, 2000), raw: true };
      }
      const files = extractFilesFromImplementation({ implementation });
      if (files.length > 0) {
        const written = await writeFilesContained(appDir, files);
        ctx.log(`Sprint ${n}: ${written.length} ficheros escritos en final-app`, 'info', 'ScrumMaster');
        implementation.written = written;
      }
      ctx.state.artifacts.implementations.push({ sprint: n, ...implementation });
      await saveArtifact(outputDir, `sprint-${n}-implementation`, implementation);
      ctx.emit('sprint_update', { sprint: n, phase: 'implemented' });

      // 3b. Checks reales (sin ok falsos: si no hay que comprobar, skipped)
      const syntax = runNodeSyntaxCheck(appDir, implementation.written || []);
      const npmTest = runNpmTestIfPresent(appDir);
      implementation.checks = { syntax, npmTest: npmTest.ran ? npmTest : { ran: false, skipped: true } };
      await saveArtifact(outputDir, `sprint-${n}-checks`, implementation.checks);
    }

    // 4. QA (QA tester)
    let qa = { passed: true, bugs: [] };
    if (has('qaTester')) {
      const qaAgent = mustHave('qaTester');
      const { parsed } = await askAgent(
        qaAgent,
        `Prueba el resultado del sprint ${n}. Ficheros: ${JSON.stringify(implementation.written || [])}. Checks: ${JSON.stringify(implementation.checks || null)}. Responde SOLO con JSON: {"qa":{"passed":true,"bugs":[{"severity":"critical|major|minor","title":"...","detail":"..."}]}}`,
        ctx
      );
      if (parsed?.qa) qa = parsed.qa;
      ctx.state.artifacts.qaReports.push({ sprint: n, ...qa });
      await saveArtifact(outputDir, `sprint-${n}-qa`, qa);
      ctx.emit('sprint_update', { sprint: n, phase: 'tested', passed: qa.passed !== false });

      // 5. Fix de bugs criticos (una ronda)
      const critical = (qa.bugs || []).filter((b) => b.severity === 'critical');
      if (critical.length > 0 && has('developer')) {
        ctx.log(`Sprint ${n}: ${critical.length} bug(s) criticos, ronda de fix`, 'warn', 'ScrumMaster');
        const dev = mustHave('developer');
        const { parsed: fixParsed } = await askAgent(
          dev,
          `Corrige estos bugs criticos del sprint ${n}: ${JSON.stringify(critical)}. Responde SOLO con JSON: {"implementation":{"files":[{"path":"...","code":"..."}],"notes":"..."}}`,
          ctx
        );
        if (fixParsed?.implementation) {
          const files = extractFilesFromImplementation({ implementation: fixParsed.implementation });
          if (files.length > 0) {
            const written = await writeFilesContained(appDir, files);
            ctx.log(`Sprint ${n}: fix aplicado (${written.length} ficheros)`, 'info', 'ScrumMaster');
          }
        }
      }
    }

    // 6. Review (Scrum Master o cierre automatico)
    let review = { done: true, next: '' };
    if (has('scrumMaster')) {
      const sm = mustHave('scrumMaster');
      const { parsed } = await askAgent(
        sm,
        `Cierra el sprint ${n}. Plan: ${JSON.stringify(plan)}. QA: ${JSON.stringify(qa)}. Responde SOLO con JSON: {"review":{"done":true,"summary":"...","next":"..."}}`,
        ctx
      );
      if (parsed?.review) review = parsed.review;
    }
    ctx.state.sprints.push({ n, plan: { goal: plan.goal, stories }, qa: { passed: qa.passed }, review });
    ctx.state.currentSprint = n;
    await ctx.saveState();
    ctx.emit('sprint_update', { sprint: n, phase: 'reviewed', review });

    if (await ctx.checkGracefulStopAfterStep(`Parada solicitada: detenido tras el sprint ${n}.`)) {
      return { stopped: true, sprint: n };
    }
  }

  // Cierre: artefacto final = listado de la app generada.
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

module.exports = { runPipeline, withTimeout, assertSafeRelPath, writeFilesContained };
