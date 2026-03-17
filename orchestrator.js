// orchestrator.js - Scrum Master: orquesta todos los agentes y sprints

const ClaudeWebAgent = require('./agents/base-agent');
const ProductOwnerAgent = require('./agents/product-owner');
const { DeveloperAgent, QATesterAgent } = require('./agents/developer-qa');
const LocalRAGAgent = require('./agents/local-rag-agent');
const { LocalProductOwnerAgent, LocalDeveloperAgent, LocalQATesterAgent } = require('./agents/local-agents');
const { SCRUM_MASTER } = require('./prompts');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ScrumMasterOrchestrator {
  constructor(config, credentials) {
    this.config = config;
    this.credentials = credentials;
    this.sessionId = uuidv4();
    this.outputDir = path.join('./outputs', `session-${this.sessionId.substring(0, 8)}`);
    this.sessionDir = config.agents?.sessionDir || './sessions';
    
    this.agents = {};
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
        implementations: [],
        qaReports: [],
        finalCode: null
      },
      logs: [],
      errors: []
    };
    
    this.eventHandlers = {};
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

  async initialize() {
    this.log('Inicializando equipo de agentes...');
    await fs.ensureDir(this.outputDir);
    await fs.ensureDir(this.sessionDir);
    
    this.state.status = 'initializing';
    this.emit('status', this.state);

    const useLocalBackend = this.config.agents?.backend === 'local';

    if (useLocalBackend) {
      // Backend IA local (Ollama + RAG): sin navegador
      this.log('Modo IA local (Ollama + RAG)');
      this.agents.productOwner = new LocalProductOwnerAgent(this.config, this.sessionDir, this.outputDir);
      this.agents.developer = new LocalDeveloperAgent(this.config, this.sessionDir, this.outputDir);
      this.agents.qaTester = new LocalQATesterAgent(this.config, this.sessionDir, this.outputDir);
      this.agents.scrumMaster = new LocalRAGAgent({
        name: 'Carlos (Scrum Master)',
        role: 'scrum-master',
        persona: SCRUM_MASTER(this.config),
        config: this.config,
        sessionDir: this.sessionDir,
        outputDir: this.outputDir
      });
      await Promise.all([
        this.initAgent('productOwner'),
        this.initAgent('developer'),
        this.initAgent('qaTester'),
        this.initAgent('scrumMaster')
      ]);
    } else {
      // Backend Claude.ai (web con Playwright)
      const claudeCredentials = this.credentials.claude || {};
      if (this.config.agents?.shareSession) {
        this.log('Modo sesión compartida: todos los agentes usan el mismo navegador');
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
        this.agents.scrumMaster = this.createScrumMasterAgent(claudeCredentials);
        this.agents.productOwner = new ProductOwnerAgent(claudeCredentials, this.config, this.sessionDir);
        this.agents.developer = new DeveloperAgent(claudeCredentials, this.config, this.sessionDir);
        this.agents.qaTester = new QATesterAgent(claudeCredentials, this.config, this.sessionDir);
        for (const agent of Object.values(this.agents)) {
          agent.browser = sharedAgent.browser;
          agent.context = sharedAgent.context;
          agent.page = await sharedAgent.context.newPage();
          agent.initialized = true;
        }
      } else {
        this.agents.productOwner = new ProductOwnerAgent(claudeCredentials, this.config, this.sessionDir);
        this.agents.developer = new DeveloperAgent(claudeCredentials, this.config, this.sessionDir);
        this.agents.qaTester = new QATesterAgent(claudeCredentials, this.config, this.sessionDir);
        this.agents.scrumMaster = this.createScrumMasterAgent(claudeCredentials);
        this.log('Inicializando agentes en paralelo...');
        await Promise.all([
          this.initAgent('productOwner'),
          this.initAgent('developer'),
          this.initAgent('qaTester'),
          this.initAgent('scrumMaster')
        ]);
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
    this.emit('status', this.state);

    try {
      // FASE 1: Discovery y Planning
      this.log('--- FASE 1: DISCOVERY & PLANNING ---');
      this.emit('phase', { phase: 1, name: 'Discovery & Planning' });
      
      await this.runDiscoveryPhase();
      
      // FASE 2: Sprints de desarrollo
      this.log('--- FASE 2: SPRINTS DE DESARROLLO ---');
      
      for (let sprint = 1; sprint <= this.state.maxSprints; sprint++) {
        this.state.currentSprint = sprint;
        this.emit('sprint_start', { sprint });
        
        const continueProject = await this.runSprint(sprint);
        if (!continueProject) {
          this.log(`Proyecto completado en sprint ${sprint}`);
          break;
        }
      }

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
    // 1. Product Owner crea el PRD
    this.log('[PO] Creando PRD...', 'info', 'ProductOwner');
    this.emit('agent_working', { agent: 'productOwner', task: 'Creando PRD' });
    
    const prd = await this.agents.productOwner.createPRD(this.config.project.description);
    this.state.artifacts.prd = prd;
    await this.saveArtifact('prd', prd);
    this.emit('artifact_created', { type: 'prd', data: prd });

    // 2. Developer diseña arquitectura
    this.log('[DEV] Diseñando arquitectura...', 'info', 'Developer');
    this.emit('agent_working', { agent: 'developer', task: 'Diseñando arquitectura' });
    
    const architecture = await this.agents.developer.designArchitecture(prd);
    this.state.artifacts.architecture = architecture;
    await this.saveArtifact('architecture', architecture);
    this.emit('artifact_created', { type: 'architecture', data: architecture });

    // 3. QA crea plan de pruebas
    this.log('[QA] Creando plan de pruebas...', 'info', 'QA');
    this.emit('agent_working', { agent: 'qaTester', task: 'Creando plan de pruebas' });
    
    const testPlan = await this.agents.qaTester.createTestPlan(prd, architecture);
    this.state.artifacts.testPlan = testPlan;
    await this.saveArtifact('test-plan', testPlan);
    this.emit('artifact_created', { type: 'testPlan', data: testPlan });

    // 4. Scrum Master planifica sprints
    this.log('[SM] Planificando sprints...', 'info', 'ScrumMaster');
    await this.planAllSprints();
    
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
    await this.saveArtifact('sprint-plan', sprintPlan);
    this.emit('artifact_created', { type: 'sprintPlan', data: sprintPlan });
    
    return sprintPlan;
  }

  async runSprint(sprintNumber) {
    this.log(`\n=== SPRINT ${sprintNumber} ===`);
    
    const sprintData = {
      number: sprintNumber,
      startTime: new Date().toISOString(),
      status: 'in-progress',
      implementation: null,
      qaReport: null,
      approved: false
    };

    this.state.sprints.push(sprintData);
    this.emit('sprint_update', { sprint: sprintNumber, status: 'planning' });

    // 1. Scrum Master: Sprint Planning
    await this.runSprintPlanning(sprintNumber, sprintData);
    
    // 2. Developer: Implementación
    this.emit('sprint_update', { sprint: sprintNumber, status: 'development' });
    const implementation = await this.agents.developer.implementSprint(
      sprintData.plan,
      this.state.artifacts.finalCode
    );
    sprintData.implementation = implementation;
    await this.saveArtifact(`sprint-${sprintNumber}-implementation`, implementation);
    this.emit('artifact_created', { type: 'implementation', sprint: sprintNumber, data: implementation });

    // 3. QA: Testing
    this.emit('sprint_update', { sprint: sprintNumber, status: 'testing' });
    this.log(`[QA] Testeando Sprint ${sprintNumber}...`, 'info', 'QA');
    
    const qaReport = await this.agents.qaTester.testImplementation(
      implementation,
      this.state.artifacts.testPlan,
      sprintNumber
    );
    sprintData.qaReport = qaReport;
    this.state.artifacts.qaReports.push(qaReport);
    await this.saveArtifact(`sprint-${sprintNumber}-qa-report`, qaReport);
    this.emit('artifact_created', { type: 'qaReport', sprint: sprintNumber, data: qaReport });

    // 4. Fix bugs si los hay
    const hasCriticalBugs = this.hasCriticalBugs(qaReport);
    if (hasCriticalBugs) {
      this.log(`[DEV] Corrigiendo bugs críticos en Sprint ${sprintNumber}...`, 'info', 'Developer');
      this.emit('sprint_update', { sprint: sprintNumber, status: 'bug-fixing' });
      
      const fixedCode = await this.agents.developer.fixBugs(qaReport.parsed, JSON.stringify(implementation.parsed));
      const verificationReport = await this.agents.qaTester.verifyFixes(qaReport.parsed, fixedCode);
      
      sprintData.implementation = fixedCode;
      await this.saveArtifact(`sprint-${sprintNumber}-fixed`, fixedCode);
    }

    // 5. Sprint Review por Product Owner
    this.emit('sprint_update', { sprint: sprintNumber, status: 'review' });
    const recommendation = qaReport.parsed?.qa_report?.recommendation || 'CONDITIONAL';
    sprintData.approved = recommendation === 'APPROVE' || recommendation === 'CONDITIONAL';
    
    // Actualizar código final
    if (sprintData.implementation?.parsed?.implementation?.files) {
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
    await this.saveArtifact(`sprint-${sprintNumber}-retro`, retro);
    this.emit('artifact_created', { type: 'retrospective', sprint: sprintNumber, data: retro });
  }

  async runFinalDelivery() {
    this.log('[SM] Preparando entrega final...', 'info', 'ScrumMaster');
    
    if (!this.state.artifacts.finalCode) {
      this.log('No hay código final para entregar', 'warn');
      return;
    }

    // Guardar todos los archivos del proyecto final
    const finalFiles = this.state.artifacts.finalCode?.parsed?.implementation?.files || [];
    
    const appDir = path.join(this.outputDir, 'final-app');
    await fs.ensureDir(appDir);

    for (const file of finalFiles) {
      if (file.path && file.code) {
        const filePath = path.join(appDir, file.path.replace(/^\//, ''));
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, file.code, 'utf8');
        this.log(`Guardado: ${file.path}`);
      }
    }

    // Generar README del proyecto
    await this.generateREADME(appDir);
    
    this.emit('delivery', { 
      outputDir: this.outputDir,
      appDir,
      files: finalFiles.length
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
