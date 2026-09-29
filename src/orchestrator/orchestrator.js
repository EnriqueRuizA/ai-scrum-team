// src/orchestrator/orchestrator.js
const { LocalAgent } = require('../agent/local.js');
const prompts = require('../../prompts/index.js');
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
    try {
      await fs.ensureDir(this.outputDir);
      
      // Inicializar agentes en paralelo
      const agentPromises = [];
      for (const member of this.config.agents.team) {
        if (!member.enabled) continue;
        
        const persona = prompts[member.role] ? prompts[member.role](this.config) : `Rol ${member.role}`;
        const agent = new LocalAgent({ name: member.label, role: member.role, persona, config: this.config });
        agentPromises.push(agent.init());
      }
      
      await Promise.all(agentPromises);
      
      // Asignar agentes al estado
      for (const member of this.config.agents.team) {
        if (!member.enabled) continue;
        const agent = this.agents[member.role];
        if (agent) {
          this.agents[member.role] = agent;
        }
      }
      
      this.state.status = 'ready';
      logger.info('Orchestrator listo.');
    } catch (error) {
      logger.error('Error inicializando orchestrator:', error.message);
      throw error;
    }
  }

  getState() {
    return this.state;
  }

  async runSprint() {
    const sprintNum = this.state.currentSprint + 1;
    logger.info(`Iniciando sprint ${sprintNum}`);
    
    try {
      // Ejecutar tareas en paralelo
      const tasks = [
        // 1. Sprint Planning (scrum master)
        async () => {
          const scrumMaster = this.agents.scrumMaster;
          if (scrumMaster) {
            const planningPrompt = `Planifica el sprint ${sprintNum}.`;
            await scrumMaster.runTask(planningPrompt);
          }
        },
        
        // 2. PO refina historias (productOwner)
        async () => {
          const po = this.agents.productOwner;
          if (po) {
            const refinePrompt = `Refina las historias del sprint ${sprintNum}.`;
            await po.runTask(refinePrompt);
          }
        },
        
        // 3. Developer implementa
        async () => {
          const dev = this.agents.developer;
          if (dev) {
            const devPrompt = `Implementa las historias del sprint ${sprintNum}.`;
            await dev.runTask(devPrompt);
          }
        },
        
        // 4. QA revisa
        async () => {
          const qa = this.agents.qaTester;
          if (qa) {
            const qaPrompt = `Ejecuta pruebas para el sprint ${sprintNum}.`;
            await qa.runTask(qaPrompt);
          }
        }
      ];

      // Ejecutar todas las tareas en paralelo
      await Promise.all(tasks.map(task => task()));
      
      this.state.currentSprint = sprintNum;
      this.state.status = 'sprint-completed';
      logger.info(`Sprint ${sprintNum} completado`);
    } catch (error) {
      logger.error('Error ejecutando sprint:', error.message);
      throw error;
    }
  }
}

module.exports = ScrumMasterOrchestrator;
