// orchestrator/index.js - FASE 1: orquestador UNICO y completo.
// Sustituye al orchestrator.js de raiz (truncado). La logica de sprint vive en
// pipeline.js; la persistencia en state.js; la creacion de agentes en
// agents/factory.js (FASE 2 la sustituye por el adapter de opencode).

const fs = require('fs-extra');
const path = require('path');
const { randomUUID: uuidv4 } = require('crypto');
const { StateStore } = require('./state');
const { runPipeline } = require('./pipeline');
const { normalizeTeam, getEnabledRoles, normalizeRoles, normalizeFlow, enabledRoles } = require('../agents/team-config');
const { createAgents, teamLabel } = require('../agents/factory');

class ScrumMasterOrchestrator {
  constructor(config, credentials) {
    this.config = config || {};
    this.credentials = credentials || {};
    this.sessionId = uuidv4();
    this.outputDir = path.join('./outputs', `session-${this.sessionId.substring(0, 8)}`);
    this.sessionDir = this.config.agents?.sessionDir || './sessions';

    this.agents = {};
    this.sharedAgents = [];
    this.team = normalizeTeam(this.config);
    this.enabledRoles = getEnabledRoles(this.team);
    // U1: modelo nuevo (roles + flow). Si no hay roles/flow, los normalizadores
    // devuelven el clasico (SM/PO/Dev/QA) para compatibilidad.
    this.roles = normalizeRoles(this.config);
    this.flow = normalizeFlow(this.config);
    this.enabledRoleIds = enabledRoles(this.roles);
    this.store = new StateStore(
      this.outputDir,
      this.sessionId,
      this.config.scrum?.maxSprints || 3
    );
    this.state = this.store.state;

    this.runControl = { paused: false, stopAfterCurrentStep: false };
    this.eventHandlers = {};
  }

  // --- Eventos ---
  on(event, handler) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers[event];
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(data);
      } catch (e) {
        console.error(`[orchestrator] handler ${event}:`, e.message);
      }
    }
  }

  log(message, level = 'info', agent = 'ScrumMaster') {
    const entry = { timestamp: new Date().toISOString(), agent, level, message };
    this.store.pushLog(entry);
    this.emit('log', entry);
    console.log(`[${entry.timestamp}] [${agent}] [${level.toUpperCase()}] ${message}`);
    this.store.scheduleSave();
  }

  // --- Control de ejecucion ---
  setPaused(paused) {
    this.runControl.paused = !!paused;
    this.state.runPaused = this.runControl.paused;
    this.emit('run_control', { paused: this.state.runPaused });
    this.emit('status', this.state);
  }

  requestStopAfterCurrentStep() {
    this.runControl.stopAfterCurrentStep = true;
    this.log('Parada solicitada: al terminar el paso en curso la ejecucion se detendra.', 'warn');
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

  teamLabel(role) {
    const r = (this.roles || []).find((m) => m.id === role);
    if (r) return r.label || role;
    return teamLabel(this.team, role);
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  async saveState() {
    await this.store.saveNow();
    if (this.store.saveError) {
      console.error('[orchestrator] saveState:', this.store.saveError);
    }
  }

  // --- Ciclo de vida ---
  async initAgent(key, agent) {
    this.emit('agent_initializing', { agentKey: key, role: agent.role, name: agent.name });
    try {
      await agent.initialize();
      agent.initialized = true;
      this.emit('agent_ready', { agentKey: key, role: agent.role, name: agent.name });
    } catch (e) {
      agent.initialized = false;
      const msg = `No se pudo inicializar el agente ${key}: ${e.message}`;
      this.state.errors.push({ timestamp: new Date().toISOString(), agent: key, message: msg });
      this.log(msg, 'error');
      throw new Error(msg);
    }
  }

  _connectAgentEvents() {
    for (const [key, agent] of Object.entries(this.agents)) {
      if (!agent || typeof agent.on !== 'function') continue;
      agent.on('log', (entry) => {
        this.store.pushLog(entry);
        this.emit('log', entry);
        this.store.scheduleSave();
      });
      agent.on('response', (data) => this.emit('agent_response', { ...data, agentKey: key }));
      agent.on('sending', (data) => this.emit('agent_sending', { ...data, agentKey: key }));
      agent.on('action_required', (data) => this.emit('action_required', data));
    }
  }

  async initialize() {
    this.log('Inicializando equipo de agentes...');
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(this.sessionDir);

    this.team = normalizeTeam(this.config);
    this.enabledRoles = getEnabledRoles(this.team);
    this.roles = normalizeRoles(this.config);
    this.flow = normalizeFlow(this.config);
    this.enabledRoleIds = enabledRoles(this.roles);
    if (this.roles.filter((r) => r.enabled !== false).length === 0) {
      throw new Error('Sin roles habilitados en agents.roles');
    }

    this.state.status = 'initializing';
    this.emit('status', this.state);

    const useLocalBackend = this.config.agents?.backend === 'local';
    if (this.config.agents?.opencode) {
      const oc = this.config.agents.opencode;
      this.log(`Motor opencode (modo ${oc.mode || 'serve'}, model=${oc.model || 'ollama/llama3.2'}), roles: ${this.roles.filter((r) => r.enabled !== false).map((r) => r.id).join(', ')}`);
    } else if (useLocalBackend) {
      const local = this.config.agents?.local || {};
      this.log(
        `Backend local: model=${local.model || 'llama3.2'} baseUrl=${local.baseUrl || 'http://localhost:11434'} rag=${local.rag?.enabled === true}`
      );
    } else {
      const email = this.credentials.claude?.email;
      if (!email || !String(email).trim()) {
        throw new Error('Backend Claude: falta el email en config/credentials.json (claude.email).');
      }
      this.log(`Backend Claude.ai (navegador), sesion compartida=${this.config.agents?.shareSession === true}`);
    }

    const { agents, sharedAgents } = createAgents({
      team: this.team,
      roles: this.roles,
      config: this.config,
      credentials: this.credentials,
      sessionDir: this.sessionDir,
      outputDir: this.outputDir
    });
    this.sharedAgents = sharedAgents;

    // El agente compartido (navegador) primero; el resto en secuencia
    // determinista para evitar condiciones de carrera.
    for (const shared of this.sharedAgents) {
      await this.initAgent('__shared', shared);
    }
    if (this.config.agents?.backend !== 'local' && this.config.agents?.shareSession) {
      const shared = this.sharedAgents[0];
      if (!shared || !shared.context) {
        throw new Error('Sesion compartida sin contexto de navegador tras inicializar.');
      }
      for (const agent of Object.values(agents)) {
        agent.browser = shared.browser;
        agent.context = shared.context;
        try {
          agent.page = await shared.context.newPage();
        } catch (e) {
          throw new Error(`No se pudo abrir pagina para ${agent.role}: ${e.message}`);
        }
        agent.initialized = true;
      }
    } else {
      for (const [key, agent] of Object.entries(agents)) {
        await this.initAgent(key, agent);
      }
    }
    this.agents = agents;

    this._connectAgentEvents();

    this.state.status = 'ready';
    this.emit('status', this.state);
    this.log(`Equipo listo: ${Object.keys(this.agents).join(', ')}`);
    await this.saveState();
  }

  async runFullProject() {
    if (this.state.status !== 'ready' && this.state.status !== 'stopped') {
      throw new Error(`Estado invalido para arrancar: ${this.state.status}`);
    }
    this.state.status = 'running';
    this.emit('status', this.state);
    this.emit('phase', { phase: 'project_start' });

    try {
      const result = await runPipeline({
        config: this.config,
        roles: this.roles,
        flow: this.flow,
        agents: this.agents,
        outputDir: this.outputDir,
        state: this.state,
        log: (m, l, a) => this.log(m, l, a),
        emit: (e, d) => this.emit(e, d),
        waitWhilePaused: () => this.waitWhilePaused(),
        checkGracefulStopAfterStep: (m) => this.checkGracefulStopAfterStep(m),
        saveState: () => this.saveState()
      });
      if (result && result.stopped) return result;
      this.state.status = 'completed';
      this.log('Proyecto completado.', 'info');
      await this.saveState();
      await this._writeSessionPointer();
      this.emit('status', this.state);
      this.emit('phase', { phase: 'project_completed' });
      return result;
    } catch (e) {
      this.state.status = 'error';
      this.state.errors.push({ timestamp: new Date().toISOString(), agent: 'ScrumMaster', message: e.message });
      this.log(`Error en proyecto: ${e.message}`, 'error');
      await this.saveState();
      this.emit('status', this.state);
      throw e;
    }
  }

  async _writeSessionPointer() {
    try {
      await fs.writeJson(
        path.join('./outputs', '.last-dashboard-session.json'),
        {
          outputFolder: path.basename(this.outputDir),
          sessionId: this.sessionId,
          updatedAt: new Date().toISOString()
        },
        { spaces: 2 }
      );
    } catch (e) {
      this.log(`No se pudo escribir el puntero de sesion: ${e.message}`, 'warn');
    }
  }

  async cleanup() {
    const all = [...Object.values(this.agents), ...this.sharedAgents];
    for (const agent of all) {
      if (!agent) continue;
      try {
        if (typeof agent.close === 'function') await agent.close();
      } catch (e) {
        console.error(`[orchestrator] cleanup ${agent.role || '?'}:`, e.message);
      }
    }
    this.agents = {};
    this.sharedAgents = [];
  }
}

module.exports = ScrumMasterOrchestrator;
