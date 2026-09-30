// src/orchestrator/orchestrator.js - Orchestrator con soporte para ordering de agentes y models por agente
const { LocalAgent } = require('../agent/local.js');
const prompts = require('../../prompts/index.js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../utils/logger.js');

/**
 * Resuelve el orden de ejecución de los agentes basado en agentsConfig.json o config principal.
 * @returns {string[]} Array de roles en el orden especificado o legacy order
 */
function resolveAgentOrder(config) {
  // Primario: agentsConfig.json
  let agentsOrderConfig = [];
  try {
    const configPath = path.join(__dirname, '../../config/agents-config.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readJsonSync(configPath);
      agentsOrderConfig = configData.agentsOrder || [];
    }
  } catch (e) {
    // Ignorar errores leyendo agents-config.json
  }
  
  // Fallback: extraer IDs de agentsConfig.json o usar legacy order
  let order = [];
  if (agentsOrderConfig.length > 0) {
    // El archivo puede tener IDs o roles - intentar mapear
    for (const id of agentsOrderConfig) {
      // Intentar convertir ID a role
      const roleMapping = {
        'productOwner': 'productOwner',
        'developer': 'developer',
        'qaTester': 'qaTester',
        'scrumMaster': 'scrumMaster'
      };
      const role = roleMapping[id] || id;
      if (role) order.push(role);
    }
  }
  
  // Si no hay orden, usar legacy order del config principal
  if (order.length === 0) {
    const team = config.agents?.team || [];
    order = team
      .filter(t => t.enabled !== false)
      .map(t => t.role);
  }
  
  return order;
}

/**
 * Resuelve el modelo por agente: primero agent.model, después defaultModel, luego gpt-4o-mini
 */
function resolveAgentModel(config, agentRole) {
  // Leer config de agents
  const agentsConfigPath = path.join(__dirname, '../../config/agents-config.json');
  const agentConfig = { defaultModel: 'gpt-4o-mini' };
  
  try {
    if (fs.existsSync(agentsConfigPath)) {
      const configData = fs.readJsonSync(agentsConfigPath);
      agentConfig.defaultModel = configData.defaultModel || 'gpt-4o-mini';
    }
  } catch (e) {}
  
  // Mapear role a ID para buscar en config
  const roleMapping = {
    'productOwner': 'productOwner',
    'developer': 'developer',
    'qaTester': 'qaTester',
    'scrumMaster': 'scrumMaster'
  };
  
  const agentId = roleMapping[agentRole] || agentRole;
  const agentSpecificConfig = config.agents?.agents?.[agentId] || {};
  
  // Priority: agent.model > config.defaultModel > gpt-4o-mini
  return agentSpecificConfig.model || agentConfig.defaultModel || 'gpt-4o-mini';
}

class ScrumMasterOrchestrator {
  constructor(config, credentials) {
    this.config = config;
    this.credentials = credentials;
    this.sessionId = uuidv4();
    this.outputDir = path.join('./outputs', `session-${this.sessionId.substring(0, 8)}`);
    this.sessionDir = config.agents?.sessionDir || './sessions';
    
    this.agents = {};
    this.team = []; // Cambiado a array en lugar de objeto
    this.state = {
      sessionId: this.sessionId,
      status: 'idle',
      currentSprint: 0,
      maxSprints: config.scrum?.maxSprints || 3,
      sprints: [],
      artifacts: {}
    };
    
    // Guardar orden resuelto
    this.agentOrder = resolveAgentOrder(config);
    
    this.eventHandlers = {};
  }

  async init() {
    logger.info('Inicializando orchestrator...');
    try {
      await fs.ensureDir(this.outputDir);
      
      // Inicializar agentes según el orden resuelto
      const agentPromises = [];
      
      for (const role of this.agentOrder) {
        const member = this.config.agents.team.find(m => m.role === role && m.enabled);
        if (!member) continue;
        
        const persona = prompts[member.role] ? prompts[member.role](this.config) : `Rol ${member.role}`;
        const model = resolveAgentModel(this.config, role);
        const agent = new LocalAgent({ 
          name: member.label, 
          role: member.role,
          persona, 
          model,
          config: this.config 
        });
        agentPromises.push(agent.init());
        
        this.agents[member.role] = agent;
      }
      
      logger.info(`Agentes inicializados en orden: ${this.agentOrder.join(', ')}`);
      
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
      // Ejecutar tareas según el orden de los agentes
      const tasks = [];
      
      for (const role of this.agentOrder) {
        const agent = this.agents[role];
        if (!agent) continue;
        
        tasks.push(async () => {
          const stepPrompts = {
            productOwner: `Como Product Owner, para el sprint ${sprintNum}: refina el backlog, define historias y prioridades.`,
            developer: `Como Developer, para el sprint ${sprintNum}: implementa las funcionalidades definidas.`,
            qaTester: `Como QA, para el sprint ${sprintNum}: ejecuta pruebas y valida la implementación.`,
            scrumMaster: `Como Scrum Master, para el sprint ${sprintNum}: gestiona impedimentos y asegura el progreso del equipo.`
          };
          
          const prompt = stepPrompts[role] || `Actúa como ${role} para el sprint ${sprintNum}.`;
          await agent.runTask(prompt);
        });
      }

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
