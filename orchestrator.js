// orchestrator.js - Scrum Master: orquesta todos los agentes y sprints

const ClaudeWebAgent = require('./agents/base-agent');
const ProductOwnerAgent = require('./agents/product-owner');
const { DeveloperAgent, QATesterAgent } = require('./agents/developer-qa');
const LocalRAGAgent = require('./agents/local-rag-agent');
const { LocalProductOwnerAgent, LocalDeveloperAgent, LocalQATesterAgent } = require('./agents/local-agents');
const { SCRUM_MASTER } = require('./prompts');
const { normalizeTeam, getEnabledRoles } = require('./lib/default-team');
const {
  extractFilesFromImplementation,
  writeFilesToDir,
  runNodeSyntaxCheck,
  runNpmTestIfPresent,
  runRealProjectChecks,
  diagnoseEmptyImplementation,
  executionReportForPrompt
} = require('./lib/deliverable');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { buildLlmConnectionInfo, formatLlmConnectionLogBlock } = require('./lib/llm-connection-info');
const { authHeadersFromLocalConfig } = require('./lib/local-llm');

class ScrumMasterOrchestrator {
  constructor(config, credentials) {
    this.config = config;
    this.credentials = credentials;
    this.sessionId = uuidv4();
    this.outputDir = path.join('./outputs', `session-${this.sessionId.substring(0, 8)}`);
    this.sessionDir = config.agents?.sessionDir || './sessions';
    
    this.agents = {};
    this.team = normalizeTeam(config);
    this.state = {
      sessionId: this.sessionId,
      status: 'idle',
      currentSprint: 0,
      maxSprints: config.scrum?.maxSprints || 3,
      sprints: [],
      artifacts: {
        prd: null,
        architecture: null,
        testPlan: null,
        sprintPlan: null,
        implementations: [],
        qaReports: [],
        finalCode: null
      },
      logs: [],
      errors: [],
      runPaused: false
    };

    /** Pausa entre pasos; parada al terminar el sprint/paso actual (no corta llamadas al LLM en curso). */
    this.runControl = {
      paused: false,
      stopAfterCurrentStep: false
    };

    this.eventHandlers = {};
  }

  setPaused(paused) {
    this.runControl.paused = !!paused;
    this.state.runPaused = this.runControl.paused;
    this.emit('run_control', { paused: this.state.runPaused });
    this.emit('status', this.state);
  }

  requestStopAfterCurrentStep() {
    this.runControl.stopAfterCurrentStep = true;
    this.log(
      'Parada solicitada: al terminar el paso en curso (p. ej. este sprint) la ejecución se detendrá.',
      'warn'
    );
    this.emit('run_control', { stopPending: true });
  }

  clearStopRequest() {
    this.runControl.stopAfterCurrentStep = false;
    this.emit('run_control', { stopPending: false });
  }

  async waitWhilePaused() {
    while (this.runControl.paused) {
      this.emit('run_pause_waiting', { paused: true });
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  async finishGracefulStop(reason) {
    this.state.status = 'stopped';
    this.runControl.stopAfterCurrentStep = false;
    this.state.runPaused = false;
    this.runControl.paused = false;
    this.log(reason, 'warn');
    await this.saveState();
    this.emit('status', this.state);
  }

  async checkGracefulStopAfterStep(message) {
    if (!this.runControl.stopAfterCurrentStep) return false;
    await this.finishGracefulStop(message);
    return true;
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(handler);
  }

  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(h => h(data));
    }
  }

  log(message, level = 'info', agent = 'ScrumMaster') {
    const entry = { timestamp: new Date().toISOString(), agent, level, message };
    this.state.logs.push(entry);
    this.emit('log', entry);
    console.log(`[${entry.timestamp}] [${agent}] [${level.toUpperCase()}] ${message}`);
    this.saveState();
  }

  teamLabel(role) {
    const m = this.team.find((t) => t.role === role);
    return (m && m.label) || role;
  }

  async initialize() {
    this.log('Inicializando equipo de agentes...');
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(this.sessionDir);

    this.team = normalizeTeam(this.config);
    const enabled = getEnabledRoles(this.team);
    if (!enabled.has('scrumMaster')) {
      throw new Error('El Scrum Master debe estar habilitado en agents.team');
    }

    this.state.status = 'initializing';
    this.emit('status', this.state);

    const useLocalBackend = this.config.agents?.backend === 'local';

    if (useLocalBackend) {
      this.log('Modo IA local (API estilo Ollama: /api/generate, embeddings, tags)');
      const loc = this.config.agents?.local || {};
      const conn = buildLlmConnectionInfo(loc);
      const auth = authHeadersFromLocalConfig(loc);
      const embedModel = loc.embedModel || loc.rag?.embedModel || 'nomic-embed-text';
      this.log(
        formatLlmConnectionLogBlock(conn, loc, {
          model: loc.model || 'llama3.2',
          embedModel,
          ragEnabled: loc.rag?.enabled === true,
          authConfigured: Object.keys(auth).length > 0
        })
      );
      if (enabled.has('productOwner')) {
        this.agents.productOwner = new LocalProductOwnerAgent(this.config, this.sessionDir, this.outputDir);
      }
      if (enabled.has('developer')) {
        this.agents.developer = new LocalDeveloperAgent(this.config, this.sessionDir, this.outputDir);
      }
      if (enabled.has('qaTester')) {
        this.agents.qaTester = new LocalQATesterAgent(this.config, this.sessionDir, this.outputDir);
      }
      this.agents.scrumMaster = new LocalRAGAgent({
        name: this.teamLabel('scrumMaster'),
        role: 'scrum-master',
        persona: SCRUM_MASTER(this.config),
        config: this.config,
        sessionDir: this.sessionDir,
        outputDir: this.outputDir
      });
      await Promise.all(Object.keys(this.agents).map((k) => this.initAgent(k)));
    } else {
      const claudeCredentials = this.credentials.claude || {};
      if (this.config.agents?.shareSession) {
        this.log('Modo sesión compartida: mismo navegador entre agentes activos');
        const sharedAgent = new ClaudeWebAgent({
          name: 'SharedSession',
          role: 'shared',
          persona: null,
          credentials: claudeCredentials,
          sessionDir: this.sessionDir,
          headless: this.config.agents?.headless,
          slowMo: this.config.agents?.slowMo,
          userDataDir: this.config.agents?.userDataDir || null
        });
        await sharedAgent.initialize();
        if (enabled.has('scrumMaster')) {
          const sm = this.createScrumMasterAgent(claudeCredentials);
          sm.name = this.teamLabel('scrumMaster');
          this.agents.scrumMaster = sm;
        }
        if (enabled.has('productOwner')) this.agents.productOwner = new ProductOwnerAgent(claudeCredentials, this.config, this.sessionDir);
        if (enabled.has('developer')) this.agents.developer = new DeveloperAgent(claudeCredentials, this.config, this.sessionDir);
        if (enabled.has('qaTester')) this.agents.qaTester = new QATesterAgent(claudeCredentials, this.config, this.sessionDir);
        for (const agent of Object.values(this.agents)) {
          agent.browser = sharedAgent.browser;
          agent.context = sharedAgent.context;
          agent.page = await sharedAgent.context.newPage();
          agent.initialized = true;
        }
      } else {
        if (enabled.has('productOwner')) this.agents.productOwner = new ProductOwnerAgent(claudeCredentials, this.config, this.sessionDir);
        if (enabled.has('developer')) this.agents.developer = new DeveloperAgent(claudeCredentials, this.config, this.sessionDir);
        if (enabled.has('qaTester')) this.agents.qaTester = new QATesterAgent(claudeCredentials, this.config, this.sessionDir);
        if (enabled.has('scrumMaster')) this.agents.scrumMaster = this.createScrumMasterAgent(claudeCredentials);
        if (this.agents.scrumMaster) this.agents.scrumMaster.name = this.teamLabel('scrumMaster');
        this.log('Inicializando agentes en paralelo...');
        await Promise.all(Object.keys(this.agents).map((k) => this.initAgent(k)));
      }
    }

    // Conectar eventos de agentes
    for (const [key, agent] of Object.entries(this.agents)) {
      agent.on('log', (entry) => {
        this.state.logs.push(entry);
        this.emit('log', entry);
      });
      agent.on('response', (data) => this.emit('agent_response', { ...data, agentKey: key }));
      agent.on('sending', (data) => this.emit('agent_sending', { ...data, agentKey: key }));
      agent.on('action_required', (data) => this.emit('action_required', data));
    }

    this.state.status = 'ready';
    this.emit('status', this.state);
    this.log('Equipo listo. Comenzando proyecto...');
  }

  /** Inyecta resumen de artefacto en el RAG de todos los agentes locales que lo soporten. */
  async injectArtifactRag(title, data) {
    const max = this.config.pipeline?.ragArtifactMaxChars ?? 100000;
    let text;
    if (typeof data === 'string') text = data;
    else if (data == null) return;
    else
      try {
        text = JSON.stringify(data, null, 2);
      } catch {
        text = String(data);
      }
    if (text.length > max) text = text.slice(0, max) + '\n...[truncado]';
    const items = [{ text, path: `artifact:${title}` }];
    for (const agent of Object.values(this.agents)) {
      if (typeof agent.addRAGContext === 'function') {
        try {
          await agent.addRAGContext(items);
        } catch (e) {
          this.log(`RAG (${title}): ${e.message}`, 'warn');
        }
      }
    }
  }

  createScrumMasterAgent(credentials) {
    const agent = new ClaudeWebAgent({
      name: 'Carlos (Scrum Master)',
      role: 'scrum-master',
      persona: SCRUM_MASTER(this.config),
      credentials,
      sessionDir: this.sessionDir,
      headless: this.config.agents?.headless,
      slowMo: this.config.agents?.slowMo
    });
    return agent;
  }

  async initAgent(agentKey) {
    try {
      this.log(`Inicializando ${agentKey}...`);
      this.emit('agent_initializing', { agentKey });
      await this.agents[agentKey].initialize();
      this.emit('agent_ready', { agentKey });
    } catch (error) {
      this.log(`Error inicializando ${agentKey}: ${error.message}`, 'error');
      this.state.errors.push({ agentKey, error: error.message, timestamp: new Date().toISOString() });
    }
  }

  async runFullProject() {
    this.log('=== INICIANDO PROYECTO COMPLETO ===');
    this.state.status = 'running';
    this.runControl.stopAfterCurrentStep = false;
    this.emit('status', this.state);

    try {
      await this.waitWhilePaused();

      // FASE 1: Discovery y Planning
      this.log('--- FASE 1: DISCOVERY & PLANNING ---');
      this.emit('phase', { phase: 1, name: 'Discovery & Planning' });

      await this.runDiscoveryPhase();
      if (this.state.status === 'stopped') {
        this.log('Flujo detenido durante fase de descubrimiento.', 'warn');
        return;
      }

      await this.waitWhilePaused();

      // FASE 2: Sprints de desarrollo
      this.log('--- FASE 2: SPRINTS DE DESARROLLO ---');

      for (let sprint = 1; sprint <= this.state.maxSprints; sprint++) {
        await this.waitWhilePaused();
        if (this.state.status === 'stopped') return;

        this.state.currentSprint = sprint;
        this.emit('sprint_start', { sprint });

        const continueProject = await this.runSprint(sprint);
        await this.saveState();

        if (this.runControl.stopAfterCurrentStep) {
          await this.finishGracefulStop(
            `Ejecución detenida por el usuario tras completar el sprint ${sprint}. Puedes reiniciar el servidor y cargar la sesión en el dashboard.`
          );
          return;
        }

        if (!continueProject) {
          this.log(`Proyecto completado en sprint ${sprint}`);
          break;
        }
      }

      if (this.state.status === 'stopped') return;

      // FASE 3: Entrega final
      this.log('--- FASE 3: ENTREGA FINAL ---');
      this.emit('phase', { phase: 3, name: 'Final Delivery' });

      await this.runFinalDelivery();

      this.state.status = 'completed';
      this.emit('status', this.state);
      this.log('=== PROYECTO COMPLETADO EXITOSAMENTE ===');

    } catch (error) {
      this.state.status = 'error';
      this.state.errors.push({ error: error.message, stack: error.stack, timestamp: new Date().toISOString() });
      this.emit('status', this.state);
      this.log(`Error crítico: ${error.message}`, 'error');
      throw error;
    }
  }

  async runDiscoveryPhase() {
    if (!this.agents.productOwner) {
      throw new Error('Product Owner deshabilitado en agents.team: hace falta para el PRD');
    }

    await this.waitWhilePaused();

    this.log('[PO] Creando PRD...', 'info', 'ProductOwner');
    this.emit('agent_working', { agent: 'productOwner', task: 'Creando PRD' });

    const prd = await this.agents.productOwner.createPRD(this.config.project.description);
    this.state.artifacts.prd = prd;
    await this.saveArtifact('prd', prd);
    this.emit('artifact_created', { type: 'prd', data: prd });
    await this.injectArtifactRag('PRD', prd.parsed || prd.raw);
    await this.saveState();

    await this.waitWhilePaused();
    if (await this.checkGracefulStopAfterStep('Detenido por usuario tras generar el PRD.')) return;

    let architecture;
    if (this.agents.developer) {
      this.log('[DEV] Diseñando arquitectura...', 'info', 'Developer');
      this.emit('agent_working', { agent: 'developer', task: 'Diseñando arquitectura' });
      architecture = await this.agents.developer.designArchitecture(prd);
    } else {
      this.log('Developer deshabilitado: arquitectura omitida (stub)', 'warn');
      architecture = {
        raw: '',
        parsed: { note: 'Developer desactivado en agents.team' },
        skipped: true,
        timestamp: new Date().toISOString()
      };
    }
    this.state.artifacts.architecture = architecture;
    await this.saveArtifact('architecture', architecture);
    this.emit('artifact_created', { type: 'architecture', data: architecture });
    await this.injectArtifactRag('Arquitectura', architecture.parsed || {});
    await this.saveState();

    await this.waitWhilePaused();
    if (await this.checkGracefulStopAfterStep('Detenido por usuario tras la arquitectura.')) return;

    let testPlan;
    if (this.agents.qaTester) {
      this.log('[QA] Creando plan de pruebas...', 'info', 'QA');
      this.emit('agent_working', { agent: 'qaTester', task: 'Creando plan de pruebas' });
      testPlan = await this.agents.qaTester.createTestPlan(prd, architecture);
    } else {
      this.log('QA deshabilitado: plan de pruebas mínimo (stub)', 'warn');
      testPlan = {
        raw: '',
        parsed: { test_plan: { cases: [], note: 'QA desactivado en agents.team' } },
        skipped: true,
        timestamp: new Date().toISOString()
      };
    }
    this.state.artifacts.testPlan = testPlan;
    await this.saveArtifact('test-plan', testPlan);
    this.emit('artifact_created', { type: 'testPlan', data: testPlan });
    await this.injectArtifactRag('Plan de pruebas', testPlan.parsed || {});
    await this.saveState();

    await this.waitWhilePaused();
    if (await this.checkGracefulStopAfterStep('Detenido por usuario tras el plan de pruebas.')) return;

    this.log('[SM] Planificando sprints...', 'info', 'ScrumMaster');
    await this.planAllSprints();
    await this.saveState();

    await this.waitWhilePaused();
    if (await this.checkGracefulStopAfterStep('Detenido por usuario tras la planificación de sprints.')) return;

    this.log('Discovery phase completada');
  }

  async planAllSprints() {
    this.emit('agent_working', { agent: 'scrumMaster', task: 'Planificando sprints' });
    
    await this.agents.scrumMaster.startNewConversation();
    
    const prompt = `Como Scrum Master, planifica ${this.state.maxSprints} sprints para el proyecto.

PRD: ${JSON.stringify(this.state.artifacts.prd?.parsed || {}, null, 2)}
ARQUITECTURA: ${JSON.stringify(this.state.artifacts.architecture?.parsed || {}, null, 2)}

Distribuye las historias de usuario en ${this.state.maxSprints} sprints iterativos, de menos a más complejo.
Sprint 1: Fundación (auth, base de datos, estructura)
Sprint 2: Features principales (Gmail, tracking)
Sprint 3: Integraciones (LinkedIn, portales de empleo)
Sprint 4: Analytics y tendencias
Sprint 5: Pulido, optimización y deployment

Devuelve un JSON con la planificación de todos los sprints.`;

    const response = await this.agents.scrumMaster.sendMessage(prompt, true);
    const parsed = this.agents.scrumMaster.parseJSONResponse(response);
    
    const sprintPlan = { raw: response, parsed, timestamp: new Date().toISOString() };
    this.state.artifacts.sprintPlan = sprintPlan;
    await this.saveArtifact('sprint-plan', sprintPlan);
    this.emit('artifact_created', { type: 'sprintPlan', data: sprintPlan });

    return sprintPlan;
  }

  async runSprint(sprintNumber) {
    if (!this.agents.developer) {
      throw new Error('Developer deshabilitado: no se puede implementar código en sprint');
    }

    this.log(`\n=== SPRINT ${sprintNumber} ===`);

    const sprintData = {
      number: sprintNumber,
      startTime: new Date().toISOString(),
      status: 'in-progress',
      implementation: null,
      executionReport: null,
      qaReport: null,
      approved: false
    };

    this.state.sprints.push(sprintData);
    this.emit('sprint_update', { sprint: sprintNumber, status: 'planning' });

    await this.waitWhilePaused();

    // 1. Scrum Master: Sprint Planning
    await this.runSprintPlanning(sprintNumber, sprintData);
    
    // 2. Developer: implementación + reintentos si el JSON no trae files[]
    this.emit('sprint_update', { sprint: sprintNumber, status: 'development' });
    const outCfg = this.config.outputs || {};
    const requireFiles = outCfg.requireFilesEachSprint !== false;
    const maxRetries = Math.max(0, Math.min(8, Number(outCfg.implementationRetryMax) || 2));
    const runChecksEach =
      outCfg.runRealChecksEachSprint !== false && outCfg.writeWorkingCopyEachSprint !== false;
    const failIfChecks = outCfg.failSprintIfChecksFail === true;

    let implementation = await this.agents.developer.implementSprint(
      sprintData.plan,
      this.state.artifacts.finalCode
    );
    let files = extractFilesFromImplementation(implementation.parsed);
    let retriesUsed = 0;
    while (
      files.length === 0 &&
      retriesUsed < maxRetries &&
      typeof this.agents.developer.repairImplementationForFiles === 'function'
    ) {
      retriesUsed++;
      this.log(
        `[DEV] Sin ficheros materializables — reintento ${retriesUsed}/${maxRetries}`,
        'warn',
        'Developer'
      );
      implementation = await this.agents.developer.repairImplementationForFiles(
        sprintData.plan,
        implementation,
        diagnoseEmptyImplementation(implementation.parsed, implementation.raw)
      );
      files = extractFilesFromImplementation(implementation.parsed);
    }

    sprintData.implementation = implementation;
    sprintData.implementationRetries = retriesUsed;
    await this.saveArtifact(`sprint-${sprintNumber}-implementation`, implementation);
    this.emit('artifact_created', { type: 'implementation', sprint: sprintNumber, data: implementation });

    const workDir = path.join(this.outputDir, 'working-app');
    let executionReport = null;

    if (outCfg.writeWorkingCopyEachSprint !== false && files.length > 0) {
      const { count } = await writeFilesToDir(workDir, files, (rel) =>
        this.log(`[working-app] ${rel}`)
      );
      this.log(`Copia de trabajo: ${count} ficheros en working-app/`);

      if (runChecksEach) {
        executionReport = await runRealProjectChecks(workDir, {
          npmInstall: outCfg.npmInstallEachSprint !== false,
          npmTest: outCfg.runNpmTestOnDelivery !== false,
          syntax: outCfg.nodeSyntaxCheckOnDelivery !== false,
          installTimeout: outCfg.npmInstallTimeoutMs || 300000,
          testTimeout: outCfg.npmTestTimeoutMs || 180000
        });
        sprintData.executionReport = executionReport;
        this.log(
          `[EJECUCIÓN REAL] ${executionReport.ok ? 'npm/sintaxis/test OK' : 'fallos en disco (ver executionReport)'}`,
          executionReport.ok ? 'info' : 'warn'
        );
      }
    } else if (files.length === 0) {
      sprintData.executionReport = {
        ok: false,
        dir: path.resolve(workDir),
        steps: [
          {
            name: 'materialize',
            ok: false,
            message: '0 ficheros extraídos del JSON del modelo (no se escribió working-app)'
          }
        ]
      };
      if (requireFiles) {
        this.log(
          `[DEV] ${diagnoseEmptyImplementation(implementation.parsed, implementation.raw)}`,
          'error',
          'Developer'
        );
      }
    }

    // 3. QA: Testing (recibe resultado de npm/sintaxis si hubo comprobaciones reales)
    this.emit('sprint_update', { sprint: sprintNumber, status: 'testing' });
    let qaReport;
    if (!this.agents.qaTester) {
      this.log(`[QA] Omitido (agente deshabilitado) — Sprint ${sprintNumber}`, 'warn');
      qaReport = {
        raw: '',
        parsed: {
          qa_report: {
            recommendation: 'APPROVE',
            bugs: [],
            note: 'QA desactivado en agents.team'
          }
        },
        skipped: true,
        sprint: sprintNumber,
        timestamp: new Date().toISOString()
      };
    } else if (requireFiles && files.length === 0) {
      this.log(`[QA] Sin código materializable — informe sintético REJECT`, 'warn', 'QA');
      qaReport = {
        raw: '',
        parsed: {
          qa_report: {
            recommendation: 'REJECT',
            bugs: [
              {
                severity: 'HIGH',
                title: 'Sin ficheros en implementation.files',
                description:
                  'El modelo no devolvió un JSON con files[] tras los reintentos. No hay nada que ejecutar en working-app.'
              }
            ],
            testCases: [],
            note: 'Generado por el orquestador (requireFilesEachSprint)'
          }
        },
        orchestratorSynthetic: true,
        sprint: sprintNumber,
        timestamp: new Date().toISOString()
      };
    } else {
      this.log(`[QA] Testeando Sprint ${sprintNumber}...`, 'info', 'QA');
      const execSummary =
        executionReport != null ? executionReportForPrompt(executionReport) : '';
      qaReport = await this.agents.qaTester.testImplementation(
        implementation,
        this.state.artifacts.testPlan,
        sprintNumber,
        execSummary
      );
    }
    sprintData.qaReport = qaReport;
    this.state.artifacts.qaReports.push(qaReport);
    await this.saveArtifact(`sprint-${sprintNumber}-qa-report`, qaReport);
    this.emit('artifact_created', { type: 'qaReport', sprint: sprintNumber, data: qaReport });

    // 4. Fix bugs si los hay
    const hasCriticalBugs = this.hasCriticalBugs(qaReport);
    if (hasCriticalBugs && this.agents.developer) {
      this.log(`[DEV] Corrigiendo bugs críticos en Sprint ${sprintNumber}...`, 'info', 'Developer');
      this.emit('sprint_update', { sprint: sprintNumber, status: 'bug-fixing' });

      const fixedCode = await this.agents.developer.fixBugs(
        qaReport.parsed,
        JSON.stringify(sprintData.implementation.parsed)
      );
      if (this.agents.qaTester) {
        await this.agents.qaTester.verifyFixes(qaReport.parsed, fixedCode);
      }

      sprintData.implementation = fixedCode;
      await this.saveArtifact(`sprint-${sprintNumber}-fixed`, fixedCode);
    }

    // 5. Sprint Review por Product Owner
    this.emit('sprint_update', { sprint: sprintNumber, status: 'review' });
    const recommendation = qaReport.parsed?.qa_report?.recommendation || 'CONDITIONAL';
    let approved = recommendation === 'APPROVE' || recommendation === 'CONDITIONAL';
    const materializedCount = extractFilesFromImplementation(sprintData.implementation?.parsed).length;
    if (requireFiles && materializedCount === 0) approved = false;
    if (failIfChecks && sprintData.executionReport && !sprintData.executionReport.ok) approved = false;
    sprintData.approved = approved;

    // Actualizar código final si hay al menos un fichero parseable (cualquier forma soportada)
    if (materializedCount > 0) {
      this.state.artifacts.finalCode = sprintData.implementation;
    }

    sprintData.endTime = new Date().toISOString();
    sprintData.status = sprintData.approved ? 'completed' : 'needs-rework';
    
    this.emit('sprint_update', { sprint: sprintNumber, status: sprintData.status, sprintData });
    this.log(`Sprint ${sprintNumber} ${sprintData.approved ? 'APROBADO' : 'REQUIERE REWORK'}`);
    
    // 6. Sprint Retrospective
    await this.runRetrospective(sprintNumber, sprintData);
    
    await this.saveState();
    
    // Continuar si no es el último sprint
    return sprintNumber < this.state.maxSprints;
  }

  async runSprintPlanning(sprintNumber, sprintData) {
    this.log(`[SM] Planificando Sprint ${sprintNumber}...`, 'info', 'ScrumMaster');
    this.emit('agent_working', { agent: 'scrumMaster', task: `Sprint ${sprintNumber} Planning` });
    
    const prompt = `Como Scrum Master, crea el plan detallado para el Sprint ${sprintNumber}.

CONTEXTO DEL PROYECTO:
${JSON.stringify(this.state.artifacts.prd?.parsed || {}, null, 2)}

SPRINTS COMPLETADOS: ${sprintNumber - 1}
BUGS PENDIENTES: ${this.getPendingBugs()}

Define las user stories específicas para el Sprint ${sprintNumber}.
Recuerda que el objetivo es construir: ${this.config.project.description}

Devuelve el plan en formato JSON con el sprint goal, stories y DoD.`;

    const response = await this.agents.scrumMaster.sendMessage(prompt, sprintNumber === 1);
    const parsed = this.agents.scrumMaster.parseJSONResponse(response);
    
    sprintData.plan = { raw: response, parsed, timestamp: new Date().toISOString() };
    await this.saveArtifact(`sprint-${sprintNumber}-plan`, sprintData.plan);
  }

  async runRetrospective(sprintNumber, sprintData) {
    this.emit('agent_working', { agent: 'scrumMaster', task: `Sprint ${sprintNumber} Retrospective` });
    
    const prompt = `Como Scrum Master, facilita la retrospectiva del Sprint ${sprintNumber}:

PLAN: ${JSON.stringify(sprintData.plan?.parsed || {}, null, 2)}
QA REPORT: ${JSON.stringify(sprintData.qaReport?.parsed || {}, null, 2)}
STATUS: ${sprintData.status}

Analiza:
1. ¿Qué fue bien?
2. ¿Qué puede mejorar?
3. ¿Qué cambios aplicar en el próximo sprint?

Formato JSON con retro estructurada.`;

    const response = await this.agents.scrumMaster.sendMessage(prompt);
    const retro = { raw: response, parsed: this.agents.scrumMaster.parseJSONResponse(response) };
    sprintData.retrospective = retro;
    await this.saveArtifact(`sprint-${sprintNumber}-retro`, retro);
    this.emit('artifact_created', { type: 'retrospective', sprint: sprintNumber, data: retro });
  }

  async runFinalDelivery() {
    this.log('[SM] Preparando entrega final...', 'info', 'ScrumMaster');
    
    if (!this.state.artifacts.finalCode) {
      this.log('No hay código final para entregar', 'warn');
      return;
    }

    const appDir = path.join(this.outputDir, 'final-app');
    await fs.ensureDir(appDir);

    const extracted = extractFilesFromImplementation(this.state.artifacts.finalCode?.parsed);
    const { count } = await writeFilesToDir(appDir, extracted, (rel) => this.log(`Guardado: ${rel}`));
    if (count === 0) {
      this.log('No se encontraron ficheros en implementation.files — revisa el JSON del último sprint', 'warn');
    }

    if (this.config.outputs?.nodeSyntaxCheckOnDelivery !== false) {
      const syn = await runNodeSyntaxCheck(appDir);
      this.log(
        `Comprobación sintaxis JS: ${syn.ok ? 'sin errores' : syn.errors.length + ' ficheros con error'}`,
        syn.ok ? 'info' : 'warn'
      );
    }

    if (this.config.outputs?.runNpmTestOnDelivery) {
      const tr = await runNpmTestIfPresent(appDir);
      this.log(
        tr.ran ? (tr.ok ? 'npm test: OK' : `npm test: ${tr.message || 'falló'}`) : String(tr.message || 'npm test omitido'),
        tr.ran && !tr.ok ? 'warn' : 'info'
      );
    }

    await this.generateREADME(appDir);
    
    this.emit('delivery', {
      outputDir: this.outputDir,
      appDir,
      files: count
    });
    
    this.log(`Entrega final en: ${appDir}`);
  }

  async generateREADME(appDir) {
    const prompt = `Como Scrum Master, genera un README.md completo para el proyecto ${this.config.project.name}.

INFORMACIÓN DEL PROYECTO:
- Descripción: ${this.config.project.description}
- Sprints completados: ${this.state.currentSprint}
- Features implementadas: ${this.config.target.features.join(', ')}
- Stack: ${JSON.stringify(this.config.target.techStack)}

Incluye:
1. Descripción del proyecto
2. Features implementadas
3. Requisitos del sistema
4. Instrucciones de instalación
5. Configuración (credenciales, APIs)
6. Uso
7. Estructura del proyecto

Genera el README completo en Markdown.`;

    const response = await this.agents.scrumMaster.sendMessage(prompt);
    
    // Extraer markdown
    const markdownMatch = response.match(/```(?:markdown|md)?\s*([\s\S]+?)\s*```/) || [null, response];
    const readme = markdownMatch[1];
    
    await fs.writeFile(path.join(appDir, 'README.md'), readme, 'utf8');
  }

  // Utils
  hasCriticalBugs(qaReport) {
    const bugs = qaReport?.parsed?.qa_report?.bugs || [];
    return bugs.some(b => b.severity === 'CRITICAL');
  }

  getPendingBugs() {
    const lastReport = this.state.artifacts.qaReports.slice(-1)[0];
    if (!lastReport?.parsed?.qa_report?.bugs) return 'Ninguno';
    const pending = lastReport.parsed.qa_report.bugs.filter(b => b.status !== 'FIXED');
    return pending.length ? JSON.stringify(pending.map(b => b.title)) : 'Ninguno';
  }

  async saveArtifact(name, data) {
    try {
      const artifactsDir = path.join(this.outputDir, 'artifacts');
      await fs.ensureDir(artifactsDir);
      const filePath = path.join(artifactsDir, `${name}.json`);
      await fs.writeJson(filePath, data, { spaces: 2 });
    } catch (e) {
      this.log(`Error guardando artefacto ${name}: ${e.message}`, 'warn');
    }
  }

  async saveState() {
    try {
      const statePath = path.join(this.outputDir, 'state.json');
      await fs.writeJson(statePath, this.state, { spaces: 2 });
      const outputsRoot = path.dirname(this.outputDir);
      await fs.ensureDir(outputsRoot);
      await fs.writeJson(
        path.join(outputsRoot, '.last-dashboard-session.json'),
        {
          outputFolder: path.basename(this.outputDir),
          sessionId: this.sessionId,
          updatedAt: new Date().toISOString()
        },
        { spaces: 2 }
      );
    } catch (e) {
      // ignore
    }
  }

  async cleanup() {
    this.log('Cerrando agentes...');
    for (const agent of Object.values(this.agents)) {
      try { await agent.close(); } catch (e) {}
    }
  }

  getState() {
    return this.state;
  }
}

module.exports = ScrumMasterOrchestrator;
