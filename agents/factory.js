// agents/factory.js - FASE 1: crea los agentes del equipo tras la interfaz normalizada.
// Interfaz que debe cumplir cada agente:
//   { name, role, on(event, handler), initialize(), sendMessage(msg, isFirst?),
//     close(), initialized }
// En FASE 2 el interior se sustituye por el adapter de opencode sin tocar al
// orquestador: solo esta factoria cambia.

const { SCRUM_MASTER, PRODUCT_OWNER, DEVELOPER, QA_TESTER, buildPersona } = require('./personas');
const { getEnabledRoles } = require('./team-config');
const { createAdapter } = require('../llm/factory');

function teamLabel(team, role) {
  const m = (team || []).find((t) => (t.role || t.id) === role);
  return (m && m.label) || role;
}

/** U1: un agente por rol habilitado (ids libres, no solo los 4 clasicos). */
function createOpencodeAgents(roles, config, outputDir) {
  const OpencodeAgent = require('./opencode-agent');
  const adapter = createAdapter(config);
  const oc = config.agents.opencode || {};
  const out = {};
  for (const roleDef of roles) {
    if (!roleDef || roleDef.enabled === false) continue;
    out[roleDef.id] = new OpencodeAgent({
      name: roleDef.label || roleDef.id,
      role: roleDef.id,
      persona: buildPersona(roleDef, config),
      adapter,
      model: roleDef.model || oc.model,
      files: Array.isArray(roleDef.files) ? roleDef.files : [],
      timeoutMs: oc.timeoutMs,
      dir: outputDir || oc.dir || undefined
    });
  }
  return out;
}

function createLocalAgents(team, config, sessionDir, outputDir) {
  const LocalRAGAgent = require('./local-rag-agent');
  const out = {};
  const defs = [
    ['productOwner', PRODUCT_OWNER],
    ['developer', DEVELOPER],
    ['qaTester', QA_TESTER],
    ['scrumMaster', SCRUM_MASTER]
  ];
  for (const [role, personaFn] of defs) {
    out[role] = new LocalRAGAgent({
      name: teamLabel(team, role),
      role,
      persona: personaFn(config),
      config,
      sessionDir,
      outputDir
    });
  }
  return out;
}

function createClaudeAgents(team, config, credentials, sessionDir, outputDir) {
  const ClaudeWebAgent = require('./base-agent');
  const ProductOwnerAgent = require('./product-owner');
  const { DeveloperAgent, QATesterAgent } = require('./developer-qa');
  const LocalRAGAgent = require('./local-rag-agent');
  const claudeCredentials = (credentials && credentials.claude) || {};
  const out = {};

  if (config.agents?.shareSession) {
    const sharedAgent = new ClaudeWebAgent({
      name: 'SharedSession',
      role: 'shared',
      persona: null,
      credentials: claudeCredentials,
      sessionDir,
      headless: config.agents?.headless,
      slowMo: config.agents?.slowMo,
      userDataDir: config.agents?.userDataDir || null
    });
    out.__shared = sharedAgent;
    const enabled = getEnabledRoles(team);
    if (enabled.has('scrumMaster')) {
      // El Scrum Master no necesita navegador: usa el agente local.
      out.scrumMaster = new LocalRAGAgent({
        name: teamLabel(team, 'scrumMaster'),
        role: 'scrumMaster',
        persona: SCRUM_MASTER(config),
        config,
        sessionDir,
        outputDir
      });
    }
    if (enabled.has('productOwner')) {
      out.productOwner = new ProductOwnerAgent(claudeCredentials, config, sessionDir);
    }
    if (enabled.has('developer')) {
      out.developer = new DeveloperAgent(claudeCredentials, config, sessionDir);
    }
    if (enabled.has('qaTester')) {
      out.qaTester = new QATesterAgent(claudeCredentials, config, sessionDir);
    }
    return out;
  }

  const enabled = getEnabledRoles(team);
  if (enabled.has('productOwner')) {
    out.productOwner = new ProductOwnerAgent(claudeCredentials, config, sessionDir);
  }
  if (enabled.has('developer')) {
    out.developer = new DeveloperAgent(claudeCredentials, config, sessionDir);
  }
  if (enabled.has('qaTester')) {
    out.qaTester = new QATesterAgent(claudeCredentials, config, sessionDir);
  }
  if (enabled.has('scrumMaster')) {
    out.scrumMaster = new LocalRAGAgent({
      name: teamLabel(team, 'scrumMaster'),
      role: 'scrumMaster',
      persona: SCRUM_MASTER(config),
      config,
      sessionDir,
      outputDir
    });
  }
  return out;
}

/**
 * @returns { agents, sharedAgents } donde agents = {productOwner?, developer?,
 *   qaTester?, scrumMaster?} y sharedAgents = [agente compartido?] para init.
 */
function createAgents({ team, roles, config, credentials, sessionDir, outputDir }) {
  // U1: si hay bloque agents.opencode, el motor es opencode con roles libres.
  // Si no, ruta legacy (local/Claude con team fijo).
  if (config.agents && config.agents.opencode) {
    const { normalizeRoles } = require('./team-config');
    const effectiveRoles = Array.isArray(roles) && roles.length > 0 ? roles : normalizeRoles(config);
    return { agents: createOpencodeAgents(effectiveRoles, config, outputDir), sharedAgents: [] };
  }
  const useLocalBackend = config.agents?.backend === 'local';
  if (useLocalBackend) {
    return {
      agents: createLocalAgents(team, config, sessionDir, outputDir),
      sharedAgents: []
    };
  }
  const agents = createClaudeAgents(team, config, credentials, sessionDir, outputDir);
  const sharedAgents = [];
  if (agents.__shared) {
    sharedAgents.push(agents.__shared);
    delete agents.__shared;
  }
  return { agents, sharedAgents };
}

module.exports = { createAgents, teamLabel };
