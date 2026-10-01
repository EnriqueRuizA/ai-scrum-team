// agents/factory.js - FASE 1: crea los agentes del equipo tras la interfaz normalizada.
// Interfaz que debe cumplir cada agente:
//   { name, role, on(event, handler), initialize(), sendMessage(msg, isFirst?),
//     close(), initialized }
// En FASE 2 el interior se sustituye por el adapter de opencode sin tocar al
// orquestador: solo esta factoria cambia.

const { SCRUM_MASTER, PRODUCT_OWNER, DEVELOPER, QA_TESTER } = require('../prompts');
const { getEnabledRoles } = require('./team-config');

function teamLabel(team, role) {
  const m = team.find((t) => t.role === role);
  return (m && m.label) || role;
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
function createAgents({ team, config, credentials, sessionDir, outputDir }) {
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
