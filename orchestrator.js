// orchestrator.js - Wrapper to load new local orchestrator
const LocalOrchestrator = require('./src/orchestrator/orchestrator.js');
module.exports = LocalOrchestrator;

// Only local agents are needed when backend is "local"
const { LocalRAGAgent } = require('./agents/local-rag-agent');
// Eliminar las importaciones de los agentes obsoletos
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
const { resolveHttpAdapterFromLocal } = require('./lib/llm-provider-presets');
const { SCRUM_MASTER, PRODUCT_OWNER, DEVELOPER, QA_TESTER } = require('./prompts');

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
      const httpAdapter = resolveHttpAdapterFromLocal(loc);
      const presetLabel = loc.providerPreset ? ` · proveedor config: ${loc.providerPreset}` : '';
      this.log(
        `Adaptador LLM: ${httpAdapter}${presetLabel} (${httpAdapter === 'openai_compatible' ? 'API tipo OpenAI /v1' : 'API Ollama /api'})`
      );
      this.log(
        formatLlmConnectionLogBlock(conn, loc, {
          model: loc.model || 'llama3.2',
          embedModel,
          ragEnabled: loc.rag?.enabled === true,
          authConfigured: Object.keys(auth).length > 0
        })
      );
      if (enabled.has('productOwner')) {
        this.agents.productOwner = new LocalRAGAgent({
          name: this.teamLabel('productOwner'),
          role: 'productOwner',
          persona: PRODUCT_OWNER(this.config),
          config: this.config,
          sessionDir: this.sessionDir,
          outputDir: this.outputDir
        });
      }
      if (enabled.has('developer')) {
        this.agents.developer = new LocalRAGAgent({
          name: this.teamLabel('developer'),
          role: 'developer',
          persona: DEVELOPER(this.config),
          config: this.config,
          sessionDir: this.sessionDir,
          outputDir: this.outputDir
        });
      }
      if (enabled.has('qaTester')) {
        this.agents.qaTester = new LocalRAGAgent({
          name: this.teamLabel('qaTester'),
          role: 'qaTester',
          persona: QA_TESTER(this.config),
          config: this.config,
          sessionDir: this.sessionDir,
          outputDir: this.outputDir
        });
      }
      if (enabled.has('scrumMaster')) {
        this.agents.scrumMaster = new LocalRAGAgent({
          name: this.teamLabel('scrumMaster'),
          role: 'scrumMaster',
          persona: SCRUM_MASTER(this.config),
          config: this.config,
          sessionDir: this.sessionDir,
          outputDir: this.outputDir
        });
      }
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

  /** Método auxiliar para crear el agente Scrum Master cuando se usa backend Claude */
  createScrumMasterAgent(credentials) {
    return new LocalRAGAgent({
      name: this.teamLabel('scrumMaster'),
      role: 'scrumMaster',
      persona: SCRUM_MASTER(this.config),
      config: this.config,
      sessionDir: this.sessionDir,
      outputDir: this.outputDir
    });
  }

  // ... resto del código sin cambios ...
}
