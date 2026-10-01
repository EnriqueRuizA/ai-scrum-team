const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

/** Contencion de rutas (duplicada minima aqui para no acoplar a server/guards). */
function assertContained(baseDir, rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('Ruta de fichero vacia');
  if (path.isAbsolute(rel)) throw new Error(`Ruta absoluta no permitida: ${rel}`);
  const resolvedBase = path.resolve(baseDir) + path.sep;
  const dest = path.resolve(baseDir, rel);
  if (dest !== resolvedBase.slice(0, -1) && !dest.startsWith(resolvedBase)) {
    throw new Error(`Ruta fuera del proyecto: ${rel}`);
  }
  return dest;
}

/** Extracts files from various response layouts */
function extractFilesFromImplementation(obj) {
  const content = obj.implementation || obj.data?.implementation || obj.result?.implementation;
  if (!content || !Array.isArray(content.files)) return [];
  return content.files.map(f => ({
    path: f.path,
    code: f.code ?? f.content ?? ''
  }));
}

/** Writes files under baseDir and returns count and paths. Rechaza traversal. */
async function writeFilesToDir(baseDir, files) {
  const paths = [];
  let count = 0;
  for (const file of files) {
    const filePath = assertContained(baseDir, file.path);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, file.code ?? file.content ?? '', 'utf8');
    paths.push(file.path);
    count++;
  }
  return { count, paths };
}

/** node --check sobre cada .js dado (o todos los .js de dir, tope 200). Sin shell. */
function runNodeSyntaxCheck(dir, files = null) {
  let targets = [];
  if (Array.isArray(files) && files.length > 0) {
    targets = files.filter((f) => typeof f === 'string' && f.endsWith('.js'));
  } else {
    targets = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (targets.length >= 200) return;
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '.git') continue;
          walk(p);
        } else if (e.name.endsWith('.js')) {
          targets.push(path.relative(dir, p));
        }
      }
    };
    try {
      walk(dir);
    } catch (e) {
      return { ok: false, message: `No se pudo listar ${dir}: ${e.message}` };
    }
  }
  if (targets.length === 0) return { ok: null, skipped: true, message: 'Sin ficheros .js que comprobar' };
  const failures = [];
  for (const rel of targets) {
    let abs;
    try {
      abs = assertContained(dir, rel);
    } catch (e) {
      failures.push({ file: rel, message: e.message });
      continue;
    }
    try {
      execFileSync(process.execPath, ['--check', abs], { stdio: 'ignore', timeout: 30000 });
    } catch (e) {
      failures.push({ file: rel, message: (e.stderr || e.message || '').toString().slice(0, 300) });
    }
  }
  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, checked: targets.length };
}

/** Localiza npm-cli.js junto al shim de npm (Windows: execFile no lanza .cmd sin shell). */
function resolveNpmCli() {
  try {
    const { execFileSync } = require('child_process');
    const where = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(where, ['npm'], { encoding: 'utf8', timeout: 10000 });
    const first = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    if (!first) return null;
    // %x%\npm\npm.cmd -> %x%\npm\node_modules\npm\bin\npm-cli.js
    const cli = path.join(path.dirname(first), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return fs.pathExistsSync(cli) ? cli : null;
  } catch (e) {
    return null;
  }
}

/** Runs npm test if script available. Sin shell (execFile + args). */
function runNpmTestIfPresent(dir, timeoutMs = 120000) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.pathExistsSync(pkgPath)) return { ran: false, ok: null, skipped: true, message: 'No package.json' };
  let pkg;
  try {
    pkg = fs.readJSONSync(pkgPath);
  } catch (e) {
    return { ran: false, ok: false, message: `package.json ilegible: ${e.message}` };
  }
  if (!pkg.scripts?.test) return { ran: false, ok: null, skipped: true, message: 'No test script' };
  const { execFileSync } = require('child_process');
  let cmd;
  let args;
  if (process.platform === 'win32') {
    const cli = resolveNpmCli();
    if (!cli) return { ran: false, ok: null, skipped: true, message: 'npm no localizable en Windows' };
    cmd = process.execPath;
    args = [cli, 'test', '--silent'];
  } else {
    cmd = 'npm';
    args = ['test', '--silent'];
  }
  try {
    const stdout = execFileSync(cmd, args, { cwd: dir, timeout: timeoutMs, encoding: 'utf8', shell: false });
    return { ran: true, ok: true, stdout: String(stdout).slice(-4000) };
  } catch (e) {
    return { ran: true, ok: false, stderr: String(e.stderr || e.message || '').slice(-4000) };
  }
}

/** Sin checks genericos que ofrecer: skipped explicito (nunca ok falso). */
function runRealProjectChecks(dir) {
  void dir;
  return { ok: null, skipped: true, message: 'Sin checks de proyecto configurados (skipped, no OK)' };
}

/** Diagnostic for empty implementation */
function diagnoseEmptyImplementation(result, path) {
  const raw = JSON.stringify(result, null, 2);
  return `Implementation at ${path} is empty. files length: ${raw.length} (longitud raw: ${raw.length} chars). Details: ${raw.slice(0, 2000)}`;
}

/** Serializes execution report steps */
function executionReportForPrompt(obj) {
  const lines = [];
  if (Array.isArray(obj.steps)) {
    for (const s of obj.steps) {
      lines.push(`${s.ok ? '✔' : '✖'} ${s.name}`);
    }
  }
  return lines.join('\n');
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
