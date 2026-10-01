// scripts/check-secrets.js - FASE 0: falla si hay secretos/mapas trackeados
const { execSync } = require('child_process');

const PATTERNS = [
  /credentials\.json$/i,
  /(^|\/)temp-/i,
  /debug.*\.log$/i,
  /(^|\/)[^/]*\.log$/i,
  /architecture\.html$/i,
  /GRAPH_MAP\.md$/i,
  /generar_mapa\.py$/i,
  /project_schema\.json$/i
];

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const bad = files.filter((f) => PATTERNS.some((re) => re.test(f)));

if (bad.length > 0) {
  console.error('check:secrets FALLO: ficheros prohibidos trackeados:');
  bad.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

console.log(`check:secrets OK (${files.length} ficheros trackeados)`);
