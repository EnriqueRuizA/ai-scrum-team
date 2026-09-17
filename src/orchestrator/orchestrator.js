// src/orchestrator/orchestrator.js
const { LocalAgent } = require('../agent/local.js');
const prompts = require('../prompts/index.js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils/logger.js');

class ScrumMasterOrchestrator {
  constructor(config, credentials) {
    this.config = config;
    this.credentials = credentials;
    this.sessionId = uuidv4();
    this.outputDir = path.join('./outputs', `session-${this.sessionId.substring(0, 8)}`);
    this.state = {
      sessionId: this.sessionId,
      status: 'idle',
      currentSprint: 0,
      maxSprints: config.scrum?.maxSprints || 3,
      sprints: [],
      artifacts: {}
    };
    this.agents = {};
  }

  async init() {
    logger.info('Inicializando orchestrator…');
    await fs.ensureDir(this.outputDir);
    // Instanciar agentes según config
    for (const member of this.config.agents.team) {
      if (!member.enabled) continue;
      const persona = prompts[member.role] ? prompts[member.role](this.config) : `Rol ${member.role}`;
      const agent = new LocalAgent({ name: member.label, role: member.role, persona, config: this.config });
      await agent.init();
      this.agents[member.role] = agent;
    }
    this.state.status = 'ready';
    logger.info('Orchestrator listo.');
  }

  getState() {
    return this.state;
  }

  async runSprint() {
    const sprintNum = this.state.currentSprint + 1;
    logger.info(`Iniciando sprint ${sprintNum}`);
    // 1. Sprint Planning (scrum master)
    const scrumMaster = this.agents.scrumMaster;
    const planningPrompt = `Planifica el sprint ${sprintNum}.`; // could be more detailed
    await scrumMaster.runTask(planningPrompt);
    // 2. PO refina historias (productOwner)
    const po = this.agents.productOwner;
    const refinePrompt = `Refina las historias del sprint ${sprintNum}.`;
    await po.runTask(refinePrompt);
    // 3. Developer implementa
    const dev = this.agents.developer;
    const devPrompt = `Implementa las historias del sprint ${sprintNum}.`;
    await dev.runTask(devPrompt);
    // 4. QA revisa
    const qa = this.agents.qaTester;
    const qaPrompt = `Ejecuta pruebas para el sprint ${sprintNum}.`;
    await qa.runTask(qaPrompt);

    this.state.currentSprint = sprintNum;
    this.state.status = 'sprint-completed';
    logger.info(`Sprint ${sprintNum} completado`);
  }
}

module.exports = ScrumMasterOrchestrator;