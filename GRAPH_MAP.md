# Mapa del repositorio

```

agents\base-agent.js:
⋮
│class ClaudeWebAgent {
│  constructor({ name, role, persona, credentials, sessionDir = './sessions', headless = false, slow
│    this.name = name;
│    this.role = role;
│    this.persona = persona;
│    this.credentials = credentials;
│    this.sessionDir = sessionDir;
│    this.headless = headless;
│    this.slowMo = slowMo;
│    this.userDataDir = userDataDir;
⋮
│  log(message, level = 'info') {
│    const timestamp = new Date().toISOString();
│    const logEntry = { timestamp, agent: this.name, role: this.role, level, message };
│    this.emit('log', logEntry);
│    console.log(`[${timestamp}] [${this.role}] ${message}`);
⋮
│  async checkIfLoggedIn() {
│    try {
│      const url = this.page.url();
│      if (url.includes('/new') || url.includes('/chat') || url.includes('claude.ai')) {
│        // Buscar elementos que indiquen sesión activa
│        const indicators = await this.page.$$('[data-testid*="user"], .user-menu, [aria-label*="Acc
│        return indicators.length > 0;
│      }
│    } catch (e) {}
│    return false;
⋮
│  async waitForLoggedIn(timeout = 30000) {
│    this.log('Esperando login completado...');
│    const startTime = Date.now();
│    
│    while (Date.now() - startTime < timeout) {
│      await this.page.waitForTimeout(2000);
│      if (await this.checkIfLoggedIn()) {
│        return true;
│      }
│      const url = this.page.url();
⋮
│  async saveSession() {
│    // Con contexto persistente no tiene sentido guardar storageState manualmente
│    if (this.userDataDir) return;
│    try {
│      await fs.ensureDir(this.sessionDir);
│      const sessionFile = path.join(this.sessionDir, `${this.role}-session.json`);
│      const storageState = await this.context.storageState();
│      await fs.writeJson(sessionFile, storageState);
│      this.log('Sesión guardada');
│    } catch (e) {
⋮
│  async waitForElement(selectors, timeout = 15000) {
│    const combined = Array.isArray(selectors) ? selectors.join(', ') : selectors;
│    return await this.page.waitForSelector(combined, { timeout });
⋮
│  async clickElement(selectors) {
│    const combined = Array.isArray(selectors) ? selectors.join(', ') : selectors;
│    const el = await this.waitForElement(combined);
│    await el.click();
│    await this.page.waitForTimeout(500);
⋮

agents\local-rag-agent.js:
⋮
│class LocalRAGAgent {
│  constructor({ name, role, persona, config, sessionDir = './sessions', outputDir = null }) {
│    this.name = name;
│    this.role = role;
│    this.persona = persona;
│    this.config = config;
│    this.sessionDir = sessionDir;
│    this.outputDir = outputDir;
│    this.initialized = false;
│    this.eventHandlers = {};
⋮
│  log(message, level = 'info') {
│    const timestamp = new Date().toISOString();
│    const logEntry = { timestamp, agent: this.name, role: this.role, level, message };
│    this.emit('log', logEntry);
│    console.log(`[${timestamp}] [${this.role}] ${message}`);
⋮

lib\default-team.js:
⋮
│function defaultTeam() {
│  return VALID_ROLES.map((role) => ({
│    id: role,
│    role,
│    enabled: true,
│    label: DEFAULT_LABELS[role] || role
│  }));
⋮

lib\deliverable.js:
⋮
│function runNodeSyntaxCheck(dir) {
│  try {
│    execSync('node --check', { cwd: dir, stdio: 'ignore' });
│    return { ok: true, message: 'Syntax OK' };
│  } catch (e) {
│    return { ok: false, message: e.message };
│  }
⋮
│function runNpmTestIfPresent(dir, timeoutMs = 120000) {
│  const pkgPath = require('path').join(dir, 'package.json');
│  if (!fs.pathExistsSync(pkgPath)) return { ran: false, ok: false, message: 'No package.json' };
│  const pkg = fs.readJSONSync(pkgPath);
│  if (!pkg.scripts?.test) return { ran: false, ok: false, message: 'No test script' };
│  try {
│    const r = execSync('npm test', { cwd: dir, timeout: timeoutMs, encoding: 'utf8' });
│    return { ran: true, ok: true, stdout: r };
│  } catch (e) {
│    return { ran: true, ok: false, stderr: e.stderr, message: e.message };
⋮
│function runRealProjectChecks(dir) {
│  return { ok: true, message: 'All checks passed' };
⋮

lib\llm-connection-info.js:
⋮
│function hostFromBaseUrl(baseUrl) {
│  try {
│    const u = new URL(baseUrl);
│    const port = u.port;
│    const defaultPort = u.protocol === 'https:' ? '443' : '80';
│    const p =
│      port && port !== defaultPort && String(port) !== '80' && String(port) !== '443'
│        ? `:${port}`
│        : '';
│    return `${u.hostname}${p}`;
⋮
│function inferPresetFromUrl(baseUrl) {
│  try {
│    const u = new URL(baseUrl);
│    const h = (u.hostname || '').toLowerCase();
│    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'ollama_local';
│    if (/^192\.168\.\d+\.\d+$/.test(h)) return 'ollama_local';
│    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return 'ollama_local';
│    if (h.endsWith('.local')) return 'ollama_local';
│  } catch {
│    /* ignore */
⋮

lib\llm-provider-presets.js:
│function resolveHttpAdapterFromLocal(local = {}) {
⋮

lib\local-llm.js:
⋮
│function rawApiKeyFromLocalConfig(local = {}) {
│  const envName = typeof local.apiKeyEnv === 'string' ? local.apiKeyEnv.trim() : '';
│  if (envName && process.env[envName] != null) {
│    const k = String(process.env[envName]).trim();
│    if (k) return k;
│  }
│  if (local.apiKey != null) {
│    const k = String(local.apiKey).trim();
│    if (k && k !== '__REDACTED__') return k;
│  }
⋮
│function requestOllama(urlString, opts) {
│  const method = opts.method || 'POST';
│  const timeoutMs = opts.timeoutMs;
│  const signal = opts.signal;
│  const errorPrefix = opts.errorPrefix || 'Ollama';
│
│  return new Promise((resolve, reject) => {
│    const url = new URL(urlString);
│    const isHttps = url.protocol === 'https:';
│    const lib = isHttps ? https : http;
│
⋮
│async function listModels(baseUrl = DEFAULT_BASE, opts = {}) {
│  const url = (baseUrl || DEFAULT_BASE).replace(/\/$/, '');
│  try {
│    const data = await requestOllama(`${url}/api/tags`, {
│      method: 'GET',
│      timeoutMs: 20000,
│      errorPrefix: 'Ollama tags',
│      authHeaders: opts.authHeaders
│    });
│    const models = (data.models || []).map(m => m.name).filter(Boolean);
⋮
│function modelNameMatches(installedName, wanted) {
│  if (!wanted || !installedName) return false;
│  const w = String(wanted).trim();
│  const n = String(installedName).trim();
│  return n === w || n.startsWith(`${w}:`);
⋮

lib\openai-compatible-llm.js:
⋮
│function normalizeV1Base(baseUrl) {
│  let u = (baseUrl || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
│  if (/\/v1$/i.test(u)) return u;
│  if (/\/openai\/v1$/i.test(u)) return u;
│  return `${u}/v1`;
⋮

lib\parse-llm-json.js:
⋮
│function extractBalancedObject(str, braceIndex) {
│  if (braceIndex < 0 || braceIndex >= str.length || str[braceIndex] !== '{') {
│    return null;
│  }
│  let depth = 0;
│  let inString = false;
│  let escape = false;
│
│  for (let i = braceIndex; i < str.length; i++) {
│    const c = str[i];
│
⋮
│function extractBalancedArray(str, start) {
│  if (start < 0 || str[start] !== '[') return null;
│  let depth = 0;
│  let inString = false;
│  let escape = false;
│
│  for (let i = start; i < str.length; i++) {
│    const c = str[i];
│
│    if (inString) {
⋮
│function normalizeLlmText(text) {
│  let t = text.trim();
│  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
│  return t;
⋮
│function allMarkdownFenceEndIndices(text) {
│  const set = new Set();
│
│  const reJson = /```(?:json|JSON)\s*\r?\n?/g;
│  let m;
│  while ((m = reJson.exec(text)) !== null) {
│    set.add(m.index + m[0].length);
│  }
│
│  // ```\n o ```\r\n (bloque genérico; no coincide ```json\n porque tras ``` no hay solo espacios a
⋮
│function parseSliceWithRepair(slice) {
│  try {
│    return JSON.parse(slice);
│  } catch {
│    try {
│      const fixed = slice.replace(/,(\s*[}\]])/g, '$1');
│      if (fixed !== slice) return JSON.parse(fixed);
│    } catch {
│      /* ignore */
│    }
⋮
│function tryParseBalancedJsonFrom(text, from) {
│  if (from < 0) from = 0;
│  if (from >= text.length) return null;
│
│  for (let pos = from; pos < text.length; ) {
│    const openBrace = text.indexOf('{', pos);
│    const openBracket = text.indexOf('[', pos);
│
│    let next = -1;
│    let useBrace = false;
⋮
│function parseLlmJsonResponse(text) {
│  if (text == null || typeof text !== 'string') return null;
│
│  const t = normalizeLlmText(text);
│  if (!t) return null;
│
│  const roots = allMarkdownFenceEndIndices(t);
│  const nonZero = roots.filter((r) => r > 0);
│  const ordered = nonZero.length ? [...nonZero, 0] : [0];
│
⋮

lib\rag.js:
⋮
│function chunkText(text, opts = {}) {
│  const size = opts.chunkSize || CHUNK_SIZE;
│  const overlap = opts.overlap || CHUNK_OVERLAP;
│  const chunks = [];
│  let start = 0;
│  while (start < text.length) {
│    let end = start + size;
│    if (end < text.length) {
│      const nextNewline = text.indexOf('\n', end);
│      if (nextNewline !== -1 && nextNewline < end + 200) end = nextNewline + 1;
⋮

orchestrator.js:
⋮
│class ScrumMasterOrchestrator {
│  constructor(config, credentials) {
│    this.config = config;
│    this.credentials = credentials;
│    this.sessionId = uuidv4();
│    this.outputDir = path.join('./outputs', `session-${this.sessionId.substring(0, 8)}`);
│    this.sessionDir = config.agents?.sessionDir || './sessions';
│    
│    this.agents = {};
│    this.team = normalizeTeam(config);
⋮
│  log(message, level = 'info', agent = 'ScrumMaster') {
│    const entry = { timestamp: new Date().toISOString(), agent, level, message };
│    this.state.logs.push(entry);
│    this.emit('log', entry);
│    console.log(`[${entry.timestamp}] [${agent}] [${level.toUpperCase()}] ${message}`);
│    this.saveState();
⋮

prompts\index.js:
⋮
│const PROJECT_CONTEXT = (config) => `
⋮

public\parse-llm-json-browser.js:
⋮
│(function (global) {
│  'use strict';
│
│  function extractBalancedObject(str, braceIndex) {
│    if (braceIndex < 0 || braceIndex >= str.length || str[braceIndex] !== '{') {
│      return null;
│    }
│    let depth = 0;
│    let inString = false;
│    let escape = false;
│
│    for (let i = braceIndex; i < str.length; i++) {
│      const c = str[i];
│
⋮
│  function extractBalancedArray(str, start) {
│    if (start < 0 || str[start] !== '[') return null;
│    let depth = 0;
│    let inString = false;
│    let escape = false;
│
│    for (let i = start; i < str.length; i++) {
│      const c = str[i];
│
│      if (inString) {
⋮
│  function normalizeLlmText(text) {
│    let t = text.trim();
│    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
│    return t;
⋮
│  function allMarkdownFenceEndIndices(text) {
│    const set = new Set();
│
│    const reJson = /```(?:json|JSON)\s*\r?\n?/g;
│    let m;
│    while ((m = reJson.exec(text)) !== null) {
│      set.add(m.index + m[0].length);
│    }
│
│    const rePlain = /```\s*\r?\n/g;
⋮
│  function parseSliceWithRepair(slice) {
│    try {
│      return JSON.parse(slice);
│    } catch {
│      try {
│        const fixed = slice.replace(/,(\s*[}\]])/g, '$1');
│        if (fixed !== slice) return JSON.parse(fixed);
│      } catch {
│        /* ignore */
│      }
⋮
│  function tryParseBalancedJsonFrom(text, from) {
│    if (from < 0) from = 0;
│    if (from >= text.length) return null;
│
│    for (let pos = from; pos < text.length; ) {
│      const openBrace = text.indexOf('{', pos);
│      const openBracket = text.indexOf('[', pos);
│
│      let next = -1;
│      let useBrace = false;
⋮
│  function parseLlmJsonResponse(text) {
│    if (text == null || typeof text !== 'string') return null;
│
│    const t = normalizeLlmText(text);
│    if (!t) return null;
│
│    const roots = allMarkdownFenceEndIndices(t);
│    const nonZero = roots.filter((r) => r > 0);
│    const ordered = nonZero.length ? [...nonZero, 0] : [0];
│
⋮

src\file\validator.js:
⋮
│class Validator {
│  static async lint(file) {
│    try {
│      execSync(`npx eslint ${file} --quiet`, { stdio: 'pipe' });
│      return { ok: true };
│    } catch (e) {
│      return { ok: false, error: e.stdout.toString() };
│    }
│  }
│
│  static async syntax(file) {
│    try {
│      await import(file);
│      return { ok: true };
│    } catch (e) {
│      return { ok: false, error: e.message };
│    }
⋮
│  static async test() {
│    try {
│      const out = execSync('npm test --silent', { encoding: 'utf8' });
│      return { ok: true, output: out };
│    } catch (e) {
│      return { ok: false, error: e.stdout };
│    }
⋮

src\utils\logger.js:
⋮
│module.exports = {
│  info: (...msg) => {
│    const timestamp = new Date().toISOString();
│    const logMessage = `[INFO] [${timestamp}] ${msg.join(' ')}`;
│    console.log(logMessage);
│    // También escribir en archivo de log
│    fs.appendFileSync(path.join(logDir, 'app.log'), `${logMessage}\n`);
│  },
│  debug: (...msg) => {
│    const timestamp = new Date().toISOString();
⋮
│  error: (...msg) => {
│    const timestamp = new Date().toISOString();
│    const logMessage = `[ERROR] [${timestamp}] ${msg.join(' ')}`;
│    console.error(logMessage);
│    fs.appendFileSync(path.join(logDir, 'app.log'), `${logMessage}\n`);
⋮

```
