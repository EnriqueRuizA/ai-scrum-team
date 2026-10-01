// utils/skills.js - U1: descubre skills opencode (.opencode/skills/<n>/SKILL.md).
// Sin dependencias: frontmatter minimo (name/description) por regex.

const fs = require('fs-extra');
const path = require('path');

function parseSkillFrontmatter(text) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(String(text || ''));
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

/** Escanea root/.opencode/skills y devuelve [{name, description, path}]. */
async function discoverSkills(rootDir) {
  const base = path.join(rootDir || process.cwd(), '.opencode', 'skills');
  if (!(await fs.pathExists(base))) return [];
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(base, e.name, 'SKILL.md');
    if (!(await fs.pathExists(file))) continue;
    let fm = {};
    try {
      fm = parseSkillFrontmatter(await fs.readFile(file, 'utf8'));
    } catch (err) {
      continue;
    }
    out.push({
      name: fm.name || e.name,
      description: (fm.description || '').slice(0, 200),
      path: path.relative(rootDir || process.cwd(), file)
    });
  }
  return out;
}

/** Skills referenciadas por roles que no existen en disco. */
async function missingSkills(config, rootDir) {
  const roles = (config?.agents?.roles || []).filter((r) => r && r.enabled !== false);
  const wanted = new Set();
  for (const r of roles) {
    for (const s of r.skills || []) wanted.add(s);
  }
  if (wanted.size === 0) return [];
  const found = new Set((await discoverSkills(rootDir)).map((s) => s.name));
  return [...wanted].filter((s) => !found.has(s));
}

module.exports = { parseSkillFrontmatter, discoverSkills, missingSkills };
