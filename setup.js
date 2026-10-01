// setup.js - FASE 2: health-check inicial (sin credenciales, sin Playwright).
// Verifica: directorios, config valida, opencode instalado, motor alcanzable
// (serve o run) y modelo de Ollama disponible. Playwright/Chromium solo con
// --claude (backend opcional). Nunca falla por credenciales: ya no existen.

const fs = require('fs-extra');
const { spawnSafe } = require('./utils/exec-safe');
const { validateProjectConfig } = require('./utils/config-validator');

const CLAUDE_ONLY = process.argv.includes('--claude');

async function checkOllamaModels() {
  try {
    const r = await spawnSafe('ollama', ['list'], { timeoutMs: 15000 });
    if (r.code !== 0) return { ok: false, models: [] };
    const models = r.stdout
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: e.message };
  }
}

async function main() {
  console.log('\nAI SCRUM TEAM - Setup (FASE 2: motor opencode)\n');
  let warnings = 0;
  const warn = (m) => {
    warnings += 1;
    console.log(`  ! ${m}`);
  };

  for (const dir of ['outputs', 'sessions', 'logs']) {
    await fs.ensureDir(dir);
    console.log(`  ✓ Directorio: ${dir}/`);
  }

  // 1. Config valida
  let config = {};
  try {
    config = await fs.readJson('./config/project-config.json');
  } catch (e) {
    console.log('  ✖ No se pudo leer config/project-config.json');
    process.exitCode = 1;
    return;
  }
  const v = validateProjectConfig(config);
  if (!v.ok) {
    console.log('  ✖ project-config.json invalido:');
    v.errors.forEach((e) => console.log(`    - ${e}`));
    process.exitCode = 1;
    return;
  }
  console.log('  ✓ project-config.json valido');

  // 2. opencode instalado y motor alcanzable
  const oc = config.agents?.opencode || { mode: 'serve', model: 'ollama/llama3.2' };
  const { createAdapter } = require('./llm/factory');
  const health = await createAdapter(config).health();
  if (health.ok) {
    console.log(`  ✓ Motor opencode OK (modo ${health.mode}${health.version ? `, ${health.version}` : ''})`);
  } else {
    warn(`Motor opencode NO disponible: ${health.error}`);
    console.log(`    → ${health.hint}`);
  }

  // 3. Modelo (solo informativo si el proveedor es Ollama local)
  const model = oc.model || 'ollama/llama3.2';
  if (model.startsWith('ollama/')) {
    const ollama = await checkOllamaModels();
    const want = model.slice('ollama/'.length);
    if (!ollama.ok) {
      warn('Ollama no responde (ollama list fallo). ¿Esta `ollama serve` en marcha?');
    } else if (!ollama.models.some((m) => m === want || m.startsWith(`${want}:`))) {
      warn(`El modelo "${want}" no esta en Ollama. Instalados: ${ollama.models.join(', ') || '(ninguno)'}`);
      console.log(`    → Ejecuta: ollama pull ${want}`);
      console.log('      o cambia agents.opencode.model en config/project-config.json');
    } else {
      console.log(`  ✓ Modelo Ollama disponible: ${want}`);
    }
  } else {
    console.log(`  · Modelo no-Ollama (${model}): la auth vive en opencode (opencode auth list).`);
  }

  // 3b. Skills referenciadas que no existen (aviso, no error) + config antigua.
  // Modelos cloud: solo recordatorio de auth (no se prueban aquí).
  const { missingSkills } = require('./utils/skills');
  const usedModels = new Set();
  if (oc.model) usedModels.add(oc.model);
  for (const r of config.agents?.roles || []) {
    if (r && r.enabled !== false && r.model) usedModels.add(r.model);
  }
  const cloudInUse = [...usedModels].filter(
    (m) => m.startsWith('opencode/') || m.startsWith('ollama-cloud/')
  );
  if (cloudInUse.length > 0) {
    console.log(`  · Modelos cloud en uso: ${cloudInUse.join(', ')}`);
    console.log('    Si alguno pide login: `opencode auth login`. Ollama Cloud además exige `ollama pull <modelo>-cloud`.');
  }
  const v2 = validateProjectConfig(config);
  if (!v2.ok) {
    warn(`project-config.json con problemas: ${v2.errors.slice(0, 3).join('; ')}`);
  }
  const missing = await missingSkills(config, process.cwd());
  if (missing.length > 0) {
    warn(`Skills no encontradas en .opencode/skills: ${missing.join(', ')} (se ignoran hasta crearlas)`);
  }
  if (config.agents?.team && !config.agents?.roles) {
    warn('Tu config usa agents.team antiguo (ignorado); la UI de Agentes genera agents.roles+flow al guardar.');
  }

  // 4. Playwright solo si se pide el backend opcional
  if (CLAUDE_ONLY) {
    console.log('  · Instalando Chromium (backend opcional --claude)...');
    try {
      const r = await spawnSafe('npx', ['playwright', 'install', 'chromium'], { timeoutMs: 10 * 60 * 1000 });
      if (r.code !== 0) warn('Chromium no se pudo instalar; ejecucion manual: npx playwright install chromium');
      else console.log('  ✓ Chromium instalado');
    } catch (e) {
      warn(`Chromium: ${e.message}`);
    }
  }

  console.log(warnings === 0 ? '\nSetup OK. Inicia con: npm start (o START.bat)\n' : `\nSetup con ${warnings} aviso(s). Revisa arriba y reejecuta.\n`);
  if (warnings > 0) process.exitCode = 0; // avisos, no error fatal
}

main().catch((e) => {
  console.error('Setup fallo:', e.message);
  process.exitCode = 1;
});
