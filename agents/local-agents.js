// agents/local-agents.js - Variantes PO, Dev y QA que usan IA local + RAG

const LocalRAGAgent = require('./local-rag-agent');
const { PRODUCT_OWNER, DEVELOPER, QA_TESTER } = require('../prompts');

class LocalProductOwnerAgent extends LocalRAGAgent {
  constructor(config, sessionDir, outputDir) {
    super({
      name: 'Sarah (Product Owner)',
      role: 'product-owner',
      persona: PRODUCT_OWNER(config),
      config,
      sessionDir,
      outputDir
    });
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
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Responde con JSON con validation.approved, criteriaResults, overallFeedback, requiredChanges.`;
    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }
}

class LocalDeveloperAgent extends LocalRAGAgent {
  constructor(config, sessionDir, outputDir) {
    super({
      name: 'Alex (Developer/Architect)',
      role: 'developer',
      persona: DEVELOPER(config),
      config,
      sessionDir,
      outputDir
    });
  }

  async designArchitecture(prd) {
    this.log('Diseñando arquitectura técnica...');
    await this.startNewConversation();
    const prompt = `Basándote en este PRD, diseña la arquitectura técnica completa:

PRD:
${typeof prd === 'object' ? JSON.stringify(prd.parsed || prd, null, 2) : prd}

Diseña:
1. Arquitectura general del sistema
2. Estructura de carpetas y ficheros
3. Modelo de datos (esquema de base de datos)
4. APIs y endpoints necesarios
5. Diagrama de componentes (en texto ASCII)
6. Decisiones técnicas y justificación
7. Dependencias npm necesarias

Responde en JSON estructurado.`;
    const response = await this.sendMessage(prompt, true);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }

  async implementFeature(story, architecture) {
    this.log(`Implementando: ${story.title || story}...`);
    const prompt = `Implementa la siguiente historia de usuario con código COMPLETO y FUNCIONAL:

HISTORIA DE USUARIO:
${typeof story === 'object' ? JSON.stringify(story, null, 2) : story}

ARQUITECTURA DE REFERENCIA:
${typeof architecture === 'object' ? JSON.stringify(architecture, null, 2) : architecture}

IMPORTANTE: Escribe código completo, no fragmentos. Devuelve JSON con los ficheros completos.`;
    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, story, timestamp: new Date().toISOString() };
  }

  async fixBugs(bugReport, currentCode) {
    this.log(`Corrigiendo ${bugReport.bugs?.length || 'varios'} bugs...`);
    const prompt = `Como developer, corrige los siguientes bugs reportados por QA:

REPORTE DE BUGS:
${JSON.stringify(bugReport, null, 2)}

CÓDIGO ACTUAL:
${currentCode}

Devuelve los ficheros corregidos en formato JSON.`;
    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }

  async implementSprint(sprintPlan, previousCode = null) {
    this.log(`Implementando Sprint ${sprintPlan.sprint?.number || 1}...`);
    await this.startNewConversation();
    const contextMsg = previousCode
      ? `\n\nCÓDIGO EXISTENTE (continúa desde aquí):\n${JSON.stringify(previousCode, null, 2)}`
      : '';
    const prompt = `Implementa TODAS las historias de usuario de este sprint con un PROYECTO EJECUTABLE DE VERDAD:

PLAN DE SPRINT:
${JSON.stringify(sprintPlan, null, 2)}
${contextMsg}

Requisitos obligatorios:
1) Código completo y funcional (no pseudocódigo): Node.js/Express o stack acordado, HTML/CSS/JS si aplica, SQLite si hay datos.
2) Incluye package.json con scripts "start" y, si es posible, "test" (Jest o node:test) con al menos una prueba que se pueda ejecutar con npm test.
3) Estructura de carpetas real (p. ej. src/, public/) y rutas de ficheros coherentes.
4) Responde SOLO con JSON válido en el formato:
{ "implementation": { "architecture": "breve", "files": [ { "path": "ruta/archivo.ext", "description": "...", "code": "contenido completo" } ], "setupInstructions": [], "dependencies": {} } }

Cada "code" debe ser el archivo entero. Si generas tests, inclúyelos como ficheros (p. ej. tests/app.test.js).`;
    const response = await this.sendMessage(prompt, true);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, sprint: sprintPlan.sprint?.number, timestamp: new Date().toISOString() };
  }

  /**
   * Misma conversación: pide solo JSON con implementation.files tras un intento vacío o inválido.
   */
  async repairImplementationForFiles(sprintPlan, failedAttempt, diagnosticsLine) {
    this.log('Reintentando: la respuesta anterior no tenía files[] materializables');
    const rawPreview = String(failedAttempt?.raw || '').slice(0, 2800);
    const prompt = `Tu respuesta anterior NO se pudo volcar a disco: falta un array válido "implementation.files" con objetos { "path", "code" }.

DIAGNÓSTICO: ${diagnosticsLine}

INICIO DEL RAW ANTERIOR (referencia, no copies texto corrupto):
${rawPreview}

Devuelve ÚNICAMENTE JSON válido con esta forma exacta:
{ "implementation": { "architecture": "breve", "files": [ { "path": "package.json", "code": "..." } ], "setupInstructions": [], "dependencies": {} } }

Incluye package.json con scripts "start" y "test" si aplica, y todos los ficheros necesarios para cumplir el plan:

PLAN DE SPRINT:
${JSON.stringify(sprintPlan, null, 2)}`;
    const response = await this.sendMessage(prompt, true);
    const parsed = this.parseJSONResponse(response);
    return {
      raw: response,
      parsed,
      sprint: sprintPlan.sprint?.number,
      timestamp: new Date().toISOString(),
      repairAttempt: true
    };
  }
}

class LocalQATesterAgent extends LocalRAGAgent {
  constructor(config, sessionDir, outputDir) {
    super({
      name: 'María (QA Tester)',
      role: 'qa-tester',
      persona: QA_TESTER(config),
      config,
      sessionDir,
      outputDir
    });
  }

  async createTestPlan(prd, architecture) {
    this.log('Creando plan de pruebas...');
    await this.startNewConversation();
    const prompt = `Como QA Engineer, crea un plan de pruebas completo basado en:

PRD: ${JSON.stringify(prd.parsed || prd, null, 2)}
ARQUITECTURA: ${JSON.stringify(architecture.parsed || architecture, null, 2)}

Incluye casos funcionales, seguridad, integración, rendimiento, edge. Devuelve en formato JSON estructurado.`;
    const response = await this.sendMessage(prompt, true);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }

  async testImplementation(implementation, testPlan, sprintNumber, executionReportSummary = '') {
    this.log(`Ejecutando pruebas del Sprint ${sprintNumber}...`);
    const execBlock =
      executionReportSummary && String(executionReportSummary).trim()
        ? `

RESULTADO DE EJECUCIÓN REAL (working-app: npm install, node --check, npm test si aplica):
${String(executionReportSummary).trim()}

Prioriza este bloque frente a suposiciones: si aquí hay fallos, la recommendation no puede ser APPROVE salvo que sean claramente ajenos al código entregado.
`
        : '';

    const prompt = `Como QA, evalúa esta implementación como si fuera a desplegarse en producción:

IMPLEMENTACIÓN (JSON con ficheros de código):
${JSON.stringify(implementation.parsed || implementation, null, 2)}

PLAN DE PRUEBAS:
${JSON.stringify(testPlan.parsed || testPlan, null, 2)}

SPRINT: ${sprintNumber}
${execBlock}
Debes:
- Revisar si hay package.json, scripts test/start, y si los ficheros parecen ejecutables.
- Listar testCases con resultado PASS/FAIL (razonado a partir del código, como revisión estática).
- bugs[] con severidad CRITICAL/HIGH/MEDIUM/LOW, pasos para reproducir, fichero afectado si aplica.
- recommendation: APPROVE | CONDITIONAL | REJECT

Devuelve JSON con clave qa_report anidada según el formato acordado en tu persona.`;
    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, sprint: sprintNumber, timestamp: new Date().toISOString() };
  }

  async verifyFixes(bugReport, fixedCode) {
    this.log('Verificando correcciones de bugs...');
    const prompt = `Como QA, verifica que los bugs reportados han sido correctamente corregidos:

BUGS ORIGINALES:
${JSON.stringify(bugReport, null, 2)}

CÓDIGO CORREGIDO:
${JSON.stringify(fixedCode.parsed || fixedCode, null, 2)}

Devuelve informe de verificación en JSON.`;
    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }
}

module.exports = { LocalProductOwnerAgent, LocalDeveloperAgent, LocalQATesterAgent };
