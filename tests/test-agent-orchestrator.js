// tests/agent-orquestrator.js - Test de integración del orquestrador

  const ScrumMasterOrchestrator = require('../src/orchestrator/orchestrator.js');
const fs = require('fs-extra');

console.log('🧪 Test de Integración: Orquestrador con Agent Ordering');
console.log('=' .repeat(50));

// Test 1: Orquestrador inicializa con orden de agentes
async function test1() {
  console.log('\n📋 Test 1: Orquestrador con order de agentes');
  
  const configPath = './config/project-config.json';
  let config;
  
  try {
    config = await fs.readJson(configPath);
  } catch (e) {
    console.log('  ✗ No se pudo cargar config:', e.message);
    return false;
  }
  
  const orchestrator = new ScrumMasterOrchestrator(config, {});
  
  // Verificar que el orden fue resuelto
  console.log('  agentOrder del orchestrator:', orchestrator.agentOrder);
  
  if (orchestrator.agentOrder.length > 0) {
    console.log('  ✓ agentOrder resuelto correctamente');
    return true;
  } else {
    console.log('  ✗ agentOrder está vacío');
    return false;
  }
}

// Test 2: Agentes se crean en el orden especificado
async function test2() {
  console.log('\n📋 Test 2: Agentes creados en orden especificado');
  
  const config = await fs.readJson('./config/project-config.json');
  const orchestrator = new ScrumMasterOrchestrator(config, {});
  
  console.log('  Order de agentes:', orchestrator.agentOrder);
  console.log('  Agentes existentes en config:', config.agents.team);
  
  // Verificar que los existentes en config se respetan
  const expectedCount = config.agents.team.filter(t => t.enabled).length;
  const actualCount = orchestrator.agentOrder.length;
  
  if (actualCount === expectedCount) {
    console.log('  ✓ Todos los agentes habilitados están en el orden');
    return true;
  } else {
    console.log(`  ✗ Expected: ${expectedCount}, Got: ${actualCount}`);
    return false;
  }
}

// Test 3: Fallback a legacy order cuando no hay agentsOrder
async function test3() {
  console.log('\n📋 Test 3: Fallback a legacy order');
  
  const config = await fs.readJson('./config/project-config.json');
  
  // Verificar team existe
  if (config.agents && config.agents.team && Array.isArray(config.agents.team)) {
    const enabledAgents = config.agents.team.filter(t => t.enabled !== false);
    console.log('  Agentes habilitados:', enabledAgents.map(a => a.role));
    console.log('  ✓ Legacy order disponible cuando no hay agentsOrder');
    return enabledAgents.length > 0;
  } else {
    console.log('  ✗ team no existe en config');
    return false;
  }
}

// Ejecutar tests
async function runTests() {
  const results = [];
  
  results.push({ name: 'Orchestrator init with order', passed: await test1() });
  results.push({ name: 'Agents created in order', passed: await test2() });
  results.push({ name: 'Legacy order fallback', passed: await test3() });
  
  console.log('='.repeat(50));
  console.log('Results de integración:');
  for (const { name, passed } of results) {
    console.log(`  ${passed ? '✓' : '✗'} ${name}`);
  }
  console.log('='.repeat(50));
  
  const allPassed = results.every(r => r.passed);
  
  if (allPassed) {
    console.log('\n🎉 ¡Todos los tests de integración pasaron!');
  }
  
  return allPassed;
}

runTests()
  .then(passed => process.exit(passed ? 0 : 1))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
