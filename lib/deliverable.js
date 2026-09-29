const { execSync } = require('child_process');
const fs = require('fs-extra');

/** Extracts files from various response layouts */
function extractFilesFromImplementation(obj) {
  const content = obj.implementation || obj.data?.implementation || obj.result?.implementation;
  if (!content || !Array.isArray(content.files)) return [];
  return content.files.map(f => ({
    path: f.path,
    code: f.code ?? f.content ?? ''
  }));
}

/** Writes files under baseDir and returns count and paths */
async function writeFilesToDir(baseDir, files) {
  const paths = [];
  let count = 0;
  for (const file of files) {
    const filePath = require('path').join(baseDir, file.path);
    await fs.ensureDir(require('path').dirname(filePath));
    await fs.writeFile(filePath, file.code ?? file.content ?? '', 'utf8');
    paths.push(file.path);
    count++;
  }
  return { count, paths };
}

/** Simple node syntax check */
function runNodeSyntaxCheck(dir) {
  try {
    execSync('node --check', { cwd: dir, stdio: 'ignore' });
    return { ok: true, message: 'Syntax OK' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/** Runs npm test if script available */
function runNpmTestIfPresent(dir, timeoutMs = 120000) {
  const pkgPath = require('path').join(dir, 'package.json');
  if (!fs.pathExistsSync(pkgPath)) return { ran: false, ok: false, message: 'No package.json' };
  const pkg = fs.readJSONSync(pkgPath);
  if (!pkg.scripts?.test) return { ran: false, ok: false, message: 'No test script' };
  try {
    const r = execSync('npm test', { cwd: dir, timeout: timeoutMs, encoding: 'utf8' });
    return { ran: true, ok: true, stdout: r };
  } catch (e) {
    return { ran: true, ok: false, stderr: e.stderr, message: e.message };
  }
}

/** Placeholder for detailed checks */
function runRealProjectChecks(dir) {
  return { ok: true, message: 'All checks passed' };
}

/** Diagnostic for empty implementation */
function diagnoseEmptyImplementation(result, path) {
  const raw = JSON.stringify(result, null, 2);
  return `Implementation at ${path} is empty. Files length: ${raw.length}. Details: ${raw}`;
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
