// lib/deliverable.js — Materializar código en disco y ejecutar comprobaciones reales (no solo JSON)

const path = require('path');
const fs = require('fs-extra');
const { execSync } = require('child_process');

function tryExec(cmd, options = {}) {
  const { cwd, timeout = 120000, maxBuffer = 20 * 1024 * 1024 } = options;
  try {
    const stdout = execSync(cmd, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout,
      shell: true,
      maxBuffer
    });
    return { ok: true, stdout: stdout || '' };
  } catch (e) {
    return {
      ok: false,
      message: e.message,
      stdout: e.stdout ? String(e.stdout) : '',
      stderr: e.stderr ? String(e.stderr) : ''
    };
  }
}

function collectFileObjects(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((f) => f && typeof f === 'object' && f.path && (f.code != null || f.content != null))
    .map((f) => ({
      path: String(f.path).replace(/^\//, ''),
      code: f.code != null ? String(f.code) : String(f.content)
    }));
}

/**
 * Extrae ficheros del JSON del modelo (varias formas habituales).
 * @param {object|null} parsed
 * @returns {Array<{ path: string, code: string }>}
 */
function extractFilesFromImplementation(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const roots = [
    parsed.implementation,
    parsed,
    parsed.data && parsed.data.implementation,
    parsed.result && parsed.result.implementation
  ].filter((x) => x && typeof x === 'object');

  for (const root of roots) {
    const got = collectFileObjects(root.files);
    if (got.length) return got;
  }
  return [];
}

/** Ayuda para logs cuando el modelo no devuelve files[]. */
function diagnoseEmptyImplementation(parsed, raw) {
  const hints = [];
  if (parsed == null) hints.push('parsed=null (no se pudo extraer JSON del modelo)');
  else if (typeof parsed === 'object') {
    const hasImpl = parsed.implementation && typeof parsed.implementation === 'object';
    if (hasImpl && !Array.isArray(parsed.implementation.files)) {
      hints.push('implementation existe pero files no es array');
    }
    if (!hasImpl && !Array.isArray(parsed.files)) {
      hints.push('no hay implementation.files ni files[] en la raíz');
    }
    hints.push(`claves en parsed: ${Object.keys(parsed).slice(0, 12).join(', ')}`);
  }
  if (typeof raw === 'string') {
    hints.push(`longitud raw=${raw.length} caracteres`);
  }
  return hints.join(' · ');
}

/**
 * Escribe ficheros bajo targetDir (sin salir por path traversal).
 * @returns {Promise<{ count: number, paths: string[] }>}
 */
async function writeFilesToDir(targetDir, files, logFn) {
  await fs.ensureDir(targetDir);
  const paths = [];
  const rootResolved = path.resolve(targetDir);
  for (const f of files) {
    let rel = f.path.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\//, '');
    const full = path.join(rootResolved, rel);
    if (!full.startsWith(rootResolved)) continue;
    await fs.ensureDir(path.dirname(full));
    await fs.writeFile(full, f.code, 'utf8');
    paths.push(rel);
    if (typeof logFn === 'function') logFn(rel);
  }
  return { count: paths.length, paths };
}

/**
 * node --check en ficheros .js (excluye node_modules).
 */
async function runNodeSyntaxCheck(appDir) {
  const results = { ok: true, files: [], errors: [] };
  const root = path.resolve(appDir);
  if (!(await fs.pathExists(root))) return results;

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile() && ent.name.endsWith('.js')) {
        try {
          execSync(`node --check "${full}"`, { stdio: 'pipe', timeout: 30000 });
          results.files.push(path.relative(root, full));
        } catch (e) {
          results.ok = false;
          results.errors.push({ file: path.relative(root, full), message: e.message });
        }
      }
    }
  }
  await walk(root);
  return results;
}

/**
 * npm test si existe package.json y scripts.test
 */
async function runNpmTestIfPresent(appDir, timeoutMs = 120000) {
  const pkgPath = path.join(appDir, 'package.json');
  if (!(await fs.pathExists(pkgPath))) return { ran: false, ok: true, message: 'Sin package.json' };
  const pkg = await fs.readJson(pkgPath);
  if (!pkg.scripts || !pkg.scripts.test) return { ran: false, ok: true, message: 'Sin script test' };
  const r = tryExec('npm test', { cwd: appDir, timeout: timeoutMs });
  return { ran: true, ok: r.ok, message: r.ok ? undefined : (r.stderr || r.message || 'npm test falló'), stdout: r.stdout, stderr: r.stderr };
}

/**
 * Pipeline real: npm install (si hay package.json), node --check, npm test (opcional).
 * @param {string} appDir
 * @param {{ npmInstall?: boolean, npmTest?: boolean, syntax?: boolean, installTimeout?: number, testTimeout?: number }} opts
 */
async function runRealProjectChecks(appDir, opts = {}) {
  const {
    npmInstall = true,
    npmTest = true,
    syntax = true,
    installTimeout = 300000,
    testTimeout = 180000
  } = opts;

  const report = { dir: path.resolve(appDir), steps: [], ok: true };
  const pkgPath = path.join(appDir, 'package.json');
  const hasPkg = await fs.pathExists(pkgPath);

  if (npmInstall && hasPkg) {
    const r = tryExec('npm install --no-fund --no-audit', { cwd: appDir, timeout: installTimeout });
    report.steps.push({
      name: 'npm install',
      ok: r.ok,
      stdoutTail: (r.stdout || '').slice(-4000),
      stderrTail: (r.stderr || '').slice(-4000)
    });
    if (!r.ok) report.ok = false;
  } else if (npmInstall) {
    report.steps.push({ name: 'npm install', skipped: true, message: 'Sin package.json en working-app' });
  }

  if (syntax) {
    const syn = await runNodeSyntaxCheck(appDir);
    report.steps.push({
      name: 'node --check',
      ok: syn.ok,
      checkedFiles: syn.files.length,
      errors: syn.errors
    });
    if (!syn.ok) report.ok = false;
  }

  if (npmTest) {
    const t = await runNpmTestIfPresent(appDir, testTimeout);
    report.steps.push({
      name: 'npm test',
      ran: t.ran,
      ok: !t.ran || t.ok,
      message: t.message,
      stdoutTail: t.stdout ? String(t.stdout).slice(-3000) : undefined
    });
    if (t.ran && !t.ok) report.ok = false;
  }

  return report;
}

function executionReportForPrompt(report) {
  if (!report || !report.steps) return '';
  return JSON.stringify(report, null, 2).slice(0, 12000);
}

module.exports = {
  extractFilesFromImplementation,
  writeFilesToDir,
  runNodeSyntaxCheck,
  runNpmTestIfPresent,
  runRealProjectChecks,
  diagnoseEmptyImplementation,
  executionReportForPrompt
};
