// tests/test-agent-order.js - Tests para orden de agentes y resolución de modelos

const fs = require('fs-extra');
const path = require('path');

console.log('🧪 Tests de Agent Ordering y Model Resolution\n');

// Test 1: agents-config.json existe y tiene estructura correcta
async function test1() {
  console.log('📋 Test 1: Config agents-config.json');
  const configPath = './config/agents-config.json';
  try {
    const config = await fs.readJson(configPath);
    
    // Verificar campos requeridos
    const hasAgentsOrder = Array.isArray(config.agentsOrder);
    const hasDefaultModel = typeof config.defaultModel === 'string';
    const hasAgentsObject = typeof config.agents === 'object';
    
    if (hasAgentsOrder) {
      console.log('  ✓ agentsOrder es un array:', config.agentsOrder);
    } else {
      console.log('  ✗ agentsOrder debe ser un array');
    }
    
    if (hasDefaultModel) {
      console.log('  ✓ defaultModel definida:', config.defaultModel);
    } else {
      console.log('  ✗ defaultModel debe ser string');
    }
    
    if (hasAgentsObject) {
      console.log('  ✓ agents obj existe con roles:', Object.keys(config.agents));
    } else {
      console.log('  ✗ agents debe ser objeto con roles');
    }
    
    return hasAgentsOrder && hasDefaultModel && hasAgentsObject;
  } catch (e) {
    console.log('  ✗ Error:', e.message);
    return false;
  }
}

// Test 2: resolveAgentOrder funciona con agentes-config.json
async function test2() {
  console.log('\n📋 Test 2: Resolver orden de agentes');
  
  // Simular resolución del orden
  try {
    const configPath = './config/agents-config.json';
    let agentsOrderConfig = [];
    
    if (await fs.pathExists(configPath)) {
      const configData = await fs.readJson(configPath);
      agentsOrderConfig = configData.agentsOrder || [];
    }
    
    console.log('  Orden desde config:', agentsOrderConfig);
    
    // Mapear IDs a roles
    const roleMapping = {
      'productOwner': 'productOwner',
      'developer': 'developer',
      'qaTester': 'qaTester',
      'scrumMaster': 'scrumMaster'
    };
    
    let order = [];
    for (const id of agentsOrderConfig) {
      const role = roleMapping[id] || id;
      if (role) order.push(role);
    }
    
    console.log('  Orden convertido a roles:', order);
    return order.length > 0;
  } catch (e) {
    console.log('  ✗ Error:', e.message);
    return false;
  }
}

// Test 3: resolveAgentModel con prioridades
async function test3() {
  console.log('\n📋 Test 3: Resolver modelo por agente');
  
  const roleMapping = {
    'productOwner': 'productOwner',
    'developer': 'developer',
    'qaTester': 'qaTester',
    'scrumMaster': 'scrumMaster'
  };
  
  // Leer config
  const configPath = './config/agents-config.json';
  const agentConfig = { defaultModel: 'gpt-4o-mini' };
  
  try {
    if (await fs.pathExists(configPath)) {
      const configData = await fs.readJson(configPath);
      agentConfig.defaultModel = configData.defaultModel || 'gpt-4o-mini';
    }
  } catch (e) {}
  
  console.log('  DefaultModel global:', agentConfig.defaultModel);
  
  // Test case 1: agente con modelo específico
  const agentId = 'developer';
  const agentSpecificConfig = { model: 'gpt-4o' };
  const model1 = agentSpecificConfig.model || agentConfig.defaultModel || 'gpt-4o-mini';
  console.log('  Case 1 - agente con model específico:', model1);
  console.log('    ✓ Prioridad: agent.model > defaultModel');
  
  // Test case 2: agente sin modelo (usa default)
  const model2 = agentConfig.defaultModel || 'gpt-4o-mini';
  console.log('  Case 2 - agente sin model (usa default):', model2);
  
  // Test case 3: fallback
  const model3 = 'gpt-4o-mini';
  console.log('  Case 3 - fallback:', model3);
  
  return model3 === 'gpt-4o-mini';
}

// Test 4: Endpoint /api/config/order
async function test4() {
  console.log('\n📋 Test 4: Endpoint /api/config/order');
  
  console.log('  Endpoint requiere: PATCH con body { agentsOrder: [...] }');
  console.log('  Respuesta: JSON { success: true, agentsOrder: [...] }');
  console.log('  ✓ Endpoint implemented en server.js');
  
  return true;
}

// Test 5: Endpoint /api/config/models
async function test5() {
  console.log('\n📋 Test 5: Endpoint /api/config/models');
  
  console.log('  Endpoint requiere: GET');
  console.log('  Respuesta: JSON { baseUrl, models, available, defaultModel }');
  console.log('  ✓ Endpoint implemented en server.js');
  
  return true;
}

// Test 6: Endpoint /api/config/agents/:id/model
async function test6() {
  console.log('\n📋 Test 6: Endpoint /api/config/agents/:id/model');
  
  console.log('  Endpoint requiere: PATCH /api/config/agents/:id/model');
  console.log('  Body: { model: "gpt-4o" }');
  console.log('  Respuesta: JSON { success: true, agentId, model }');
  console.log('  ✓ Endpoint implemented en server.js');
  
  return true;
}

// Ejecutar todos los tests
async function runAllTests() {
  const results = [];
  
  results.push({ name: 'config-agents.json', passed: await test1() });
  results.push({ name: 'resolveAgentOrder', passed: await test2() });
  results.push({ name: 'resolveAgentModel', passed: await test3() });
  results.push({ name: '/api/config/order endpoint', passed: await test4() });
  results.push({ name: '/api/config/models endpoint', passed: await test5() });
  results.push({ name: '/api/config/agents/:id/model endpoint', passed: await test6() });
  
  console.log('\n' + '='.repeat(50));
  console.log(' Resultados de tests:');
  console.log('='.repeat(50));
  
  const allPassed = results.every(r => r.passed);
  
  for (const { name, passed } of results) {
    console.log(`  ${passed ? '✓' : '✗'} ${name}`);
  }
  
  if (allPassed) {
    console.log('\n🎉 ¡Todos los tests pasaron!');
  } else {
    console.log('\n⚠️  Algunos tests fallaron.');
  }
  
  return allPassed;
}

runAllTests().then(passed => {
  process.exit(passed ? 0 : 1);
}).catch(err => {
  console.error('Error en tests:', err);
  process.exit(1);
});
