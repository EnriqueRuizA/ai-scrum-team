// agents/developer.js
const ClaudeWebAgent = require('./base-agent');
const { DEVELOPER } = require('../prompts');

class DeveloperAgent extends ClaudeWebAgent {
  constructor(credentials, config, sessionDir) {
    super({
      name: 'Alex (Developer/Architect)',
      role: 'developer',
      persona: DEVELOPER(config),
      credentials,
      sessionDir,
      headless: config.agents?.headless ?? false,
      slowMo: config.agents?.slowMo ?? 100,
      userDataDir: config.agents?.userDataDir || null
    });
    this.config = config;
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

IMPORTANTE:
- Escribe código completo, no fragmentos
- Incluye todos los imports y dependencias
- Maneja errores apropiadamente
- Añade comentarios explicativos
- El código debe ser ejecutable tal cual

Devuelve JSON con los ficheros completos.`;

    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, story, timestamp: new Date().toISOString() };
  }

  async fixBugs(bugReport, currentCode) {
    this.log(`Corrigiendo ${bugReport.bugs?.length || 'varios'} bugs...`);
    
    const prompt = `Como developer, corrige los siguientes bugs reportados por QA:

REPORTE DE BUGS:
${JSON.stringify(bugReport, null, 2)}

CÓDIGO ACTUAL (archivos relevantes):
${currentCode}

Para cada bug:
1. Identifica la causa raíz
2. Implementa la corrección
3. Explica el cambio realizado

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

    const prompt = `Implementa TODAS las historias de usuario de este sprint con código COMPLETO:

PLAN DE SPRINT:
${JSON.stringify(sprintPlan, null, 2)}
${contextMsg}

GENERA:
1. Código completo para cada historia
2. Ficheros HTML, CSS, JS, y backend Node.js
3. Schema de base de datos SQLite
4. Instrucciones de instalación y ejecución

Asegúrate de que sea una aplicación WEB COMPLETA y FUNCIONAL.
Devuelve JSON con TODOS los ficheros.`;

    const response = await this.sendMessage(prompt, true);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, sprint: sprintPlan.sprint?.number, timestamp: new Date().toISOString() };
  }

  async repairImplementationForFiles(sprintPlan, failedAttempt, diagnosticsLine) {
    this.log('Reintentando implementación: sin ficheros válidos en el JSON anterior');
    const rawPreview = String(failedAttempt?.raw || '').slice(0, 2800);
    const prompt = `La respuesta anterior no contenía un JSON con "implementation.files" (array de {path, code}) utilizable.

Diagnóstico: ${diagnosticsLine}

Inicio del raw anterior:
${rawPreview}

Devuelve SOLO JSON válido:
{ "implementation": { "files": [ { "path": "...", "code": "..." } ], "architecture": "", "setupInstructions": [], "dependencies": {} } }

Plan de sprint:
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

// agents/qa-tester.js (en el mismo fichero para brevedad)
const { QA_TESTER } = require('../prompts');

class QATesterAgent extends ClaudeWebAgent {
  constructor(credentials, config, sessionDir) {
    super({
      name: 'María (QA Tester)',
      role: 'qa-tester',
      persona: QA_TESTER(config),
      credentials,
      sessionDir,
      headless: config.agents?.headless ?? false,
      slowMo: config.agents?.slowMo ?? 100,
      userDataDir: config.agents?.userDataDir || null
    });
    this.config = config;
  }

  async createTestPlan(prd, architecture) {
    this.log('Creando plan de pruebas...');
    await this.startNewConversation();
    
    const prompt = `Como QA Engineer, crea un plan de pruebas completo basado en:

PRD: ${JSON.stringify(prd.parsed || prd, null, 2)}
ARQUITECTURA: ${JSON.stringify(architecture.parsed || architecture, null, 2)}

Incluye:
1. Casos de prueba funcionales (todas las features)
2. Pruebas de seguridad (XSS, autenticación, datos sensibles)
3. Pruebas de integración (Gmail, LinkedIn, portales de empleo)
4. Pruebas de rendimiento
5. Casos edge y escenarios negativos
6. Criterios de aceptación por feature

Devuelve en formato JSON estructurado.`;

    const response = await this.sendMessage(prompt, true);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }

  async testImplementation(implementation, testPlan, sprintNumber, executionReportSummary = '') {
    this.log(`Ejecutando pruebas del Sprint ${sprintNumber}...`);

    const execBlock =
      executionReportSummary && String(executionReportSummary).trim()
        ? `

EJECUCIÓN REAL EN DISCO (working-app):
${String(executionReportSummary).trim()}
`
        : '';

    const prompt = `Como QA, analiza esta implementación y ejecuta los casos de prueba relevantes:

IMPLEMENTACIÓN (código):
${JSON.stringify(implementation.parsed || implementation, null, 2)}

PLAN DE PRUEBAS:
${JSON.stringify(testPlan.parsed || testPlan, null, 2)}

SPRINT: ${sprintNumber}
${execBlock}
Analiza el código y reporta:
1. Casos de prueba ejecutados con resultado PASS/FAIL
2. Bugs encontrados con severidad y pasos para reproducir
3. Vulnerabilidades de seguridad identificadas
4. Problemas de usabilidad
5. Recomendación: APPROVE, CONDITIONAL o REJECT
6. Porcentaje de cobertura estimado

Sé crítico y exhaustivo. Devuelve en formato JSON.`;

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

Para cada bug:
1. Verifica si está realmente corregido
2. Comprueba que no hay regresiones
3. Valida que la solución es correcta

Devuelve informe de verificación en JSON.`;

    const response = await this.sendMessage(prompt);
    const parsed = this.parseJSONResponse(response);
    return { raw: response, parsed, timestamp: new Date().toISOString() };
  }
}

module.exports = { DeveloperAgent, QATesterAgent };
