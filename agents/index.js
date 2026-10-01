// agents/index.js - FASE 5: barrel de agentes y equipo.
const teamConfig = require('./team-config');
const { createAgents, teamLabel } = require('./factory');
const personas = require('./personas');
const OpencodeAgent = require('./opencode-agent');

module.exports = { ...teamConfig, createAgents, teamLabel, personas, OpencodeAgent };
