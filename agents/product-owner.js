// agents/product-owner.js
const ClaudeWebAgent = require('./base-agent');
const { PRODUCT_OWNER } = require('../prompts');

class ProductOwnerAgent extends ClaudeWebAgent {
  constructor(credentials, config, sessionDir) {
    super({
      name: 'Sarah (Product Owner)',
      role: 'product-owner',
      persona: PRODUCT_OWNER(config),
      credentials,
      sessionDir,
      headless: config.agents?.headless ?? false,
      slowMo: config.agents?.slowMo ?? 100,
      userDataDir: config.agents?.userDataDir || null
    });
    this.config = config;
  }

  async createPRD(projectDescription) {
    this.log('Creando Product Requirements Document...');
    await this.startNewConversation();
    
    const prompt = `Actúa como Product Owner. Crea un PRD completo para: "${projectDescription}"

Incluye:
1. Visión del producto y objetivos
2. Personas de usuario (al menos 3 perfiles)
3. Épicas principales con historias de usuario detalladas
4. Criterios de aceptación para cada historia
5. Requisitos no funcionales (seguridad, rendimiento, escalabilidad)
6. Descripción de wireframes principales
7. Priorización MoSCoW

Responde en JSON estructurado siguiendo el formato indicado.`;

    const response = await this.sendMessage(prompt, true);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }

  async refineSprint(sprintPlan, feedback) {
    this.log('Refinando sprint con feedback...');
    
    const prompt = `Como Product Owner, revisa este plan de sprint y aplica el siguiente feedback:

PLAN ACTUAL:
${JSON.stringify(sprintPlan, null, 2)}

FEEDBACK:
${feedback}

Devuelve el plan refinado en el mismo formato JSON.`;

    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }

  async validateDeliverable(deliverable, acceptanceCriteria) {
    this.log('Validando entregable contra criterios de aceptación...');
    
    const prompt = `Como Product Owner, valida si este entregable cumple los criterios de aceptación:

ENTREGABLE:
${deliverable}

CRITERIOS DE ACEPTACIÓN:
${acceptanceCriteria.map((c, i) => `${i+1}. ${c}`).join('\n')}

Responde con:
{
  "validation": {
    "approved": true/false,
    "criteriaResults": [{"criterion": "...", "met": true/false, "notes": "..."}],
    "overallFeedback": "...",
    "requiredChanges": ["cambio 1", "cambio 2"]
  }
}`;

    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }
}

module.exports = ProductOwnerAgent;
