// setup.js - Script de configuración inicial
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

async function setup() {
  console.log('\n🚀 AI SCRUM TEAM - Setup Inicial\n');
  
  // Crear directorios necesarios
  const dirs = ['outputs', 'sessions', 'logs'];
  for (const dir of dirs) {
    await fs.ensureDir(dir);
    console.log(`✓ Directorio creado: ${dir}/`);
  }
  
  // Verificar credenciales
  const credPath = './config/credentials.json';
  const creds = await fs.readJson(credPath);
  
  if (creds.claude.email === 'TU_EMAIL@gmail.com') {
    console.log('\n⚠️  IMPORTANTE: Configura tus credenciales en:');
    console.log('   → config/credentials.json');
    console.log('   → O desde el dashboard en Settings\n');
  }
  
  // Instalar browsers de Playwright
  console.log('📦 Instalando Chromium para Playwright...');
  try {
    execSync('npx playwright install chromium', { stdio: 'inherit' });
    console.log('✓ Chromium instalado\n');
  } catch (e) {
    console.log('⚠️  Error instalando Chromium. Ejecuta manualmente: npx playwright install chromium\n');
  }
  
  console.log('✅ Setup completado!');
  console.log('\nPara iniciar:');
  console.log('  npm start');
  console.log('  → Abre http://localhost:3000\n');
}

setup().catch(console.error);
