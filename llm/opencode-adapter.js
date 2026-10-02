// llm/opencode-adapter.js - FASE 2: UNICO adapter de IA del proyecto.
// El motor es opencode (modelos gratuitos: proveedor Ollama local u otros
// proveedores free configurados en opencode). Dos modos (T1 del plan):
//   "serve" (primario): habla por HTTP con `opencode serve` (sin cold-boot).
//   "run"   (fallback): un `opencode run --format json` por llamada.
// El prompt NUNCA se interpola en un shell: viaja como argumento (run) o
// como JSON en el body (serve).

const { spawnSafe } = require('../utils/exec-safe');
const path = require('path');
const fs = require('fs');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// Tope de contexto en mensajes de error (evita volcar megabytes de stdout).
const ERROR_TAIL_CHARS = 1000;

function tail(s, n = ERROR_TAIL_CHARS) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return '…(recortado) ' + t.slice(-n);
}

function linkSignals(external, timeoutMs) {
  const ctrl = new AbortController();
  let timer = null;
  const onAbort = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (timer.unref) timer.unref();
  }
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (external) external.removeEventListener('abort', onAbort);
  };
  return { signal: ctrl.signal, cleanup };
}

/** Recolector tolerante de texto desde eventos `--format json` de `opencode run`. */
function collectRunText(stdout) {
  const chunks = [];
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(t);
    } catch (e) {
      continue;
    }
    chunks.push(...extractTextFromEvent(ev));
  }
  return chunks.join('').trim();
}

function extractTextFromEvent(node) {
  const out = [];
  const visit = (n) => {
    if (n == null) return;
    if (typeof n === 'string') return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== 'object') return;
    // Parte de texto del SDK: { type: 'text', text: '...' }
    if (typeof n.text === 'string' && (n.type === 'text' || n.type === undefined)) {
      // Evita duplicar el eco del prompt: solo fragmentos con type text explicito
      if (n.type === 'text') out.push(n.text);
    }
    if (typeof n.delta === 'string') out.push(n.delta);
    for (const v of Object.values(n)) visit(v);
  };
  visit(node);
  return out;
}

/** sessionID de la primera linea JSON con "sessionID" (para continuar con --session). */
function collectRunSessionID(stdout) {
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;
    const m = /"sessionID"\s*:\s*"([^"]+)"/.exec(t);
    if (m) return m[1];
  }
  return null;
}
/** Texto de la respuesta de POST /session/:id/message ({ info, parts }). */
function collectMessageText(body) {
  const parts = (body && body.parts) || [];
  return parts
    .filter((p) => p && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
}

class OpencodeAdapter {
  /**
   * cfg = { mode, url, model, variant, dir, timeoutMs, auto, command, username, password,
   *         env, providerTemplate }
   * variant: esfuerzo del modelo en opencode (p. ej. "xhigh" en muse-spark).
   *   run  -> flag --variant ; serve -> campo variant del mensaje.
   * providerTemplate: ruta al opencode.json versionado (opencode.example/)
   *   cuyo `provider` se inyecta al hijo `opencode run` via
   *   OPENCODE_CONFIG_CONTENT. Sin proveedor explicito, `run` muere con
   *   UnknownError antes de llamar a Ollama (ver TROUBLESHOOTING).
   *   Se respeta si el entorno ya trae OPENCODE_CONFIG_CONTENT.
   */
  constructor(cfg = {}) {
    this.mode = cfg.mode === 'run' ? 'run' : 'serve';
    this.url = (cfg.url || 'http://127.0.0.1:4096').replace(/\/$/, '');
    this.model = cfg.model || 'ollama/llama3.2';
    this.variant = typeof cfg.variant === 'string' ? cfg.variant.trim() : '';
    this.dir = cfg.dir || process.cwd();
    this.timeoutMs = cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.auto = cfg.auto === true;
    this.command = cfg.command || 'opencode';
    this.username = cfg.username || process.env.OPENCODE_SERVER_USERNAME || '';
    this.password = cfg.password || process.env.OPENCODE_SERVER_PASSWORD || '';
    this.extraEnv = cfg.env || {};
    this.providerTemplate =
      cfg.providerTemplate !== undefined
        ? cfg.providerTemplate
        : path.join(__dirname, '..', 'opencode.example', 'opencode.json');
    this._binary = null; // resuelto por resolveBinary() (importante en Windows: .cmd no es ejecutable directo)
    this._providerEnv = undefined; // cache de providerEnv()
  }

  /**
   * Resuelve el ejecutable real de opencode. En Windows, `opencode` suele ser
   * un shim .cmd/.ps1 de npm que CreateProcess NO puede lanzar sin shell;
   * hay que encontrar el opencode.exe real. Cachea el resultado.
   */
  async resolveBinary() {
    if (this._binary) return this._binary;
    // 1. Override explicito (ruta o nombre) si responde a --version.
    if (this.command && this.command !== 'opencode') {
      this._binary = this.command;
      return this._binary;
    }
    const tried = [];
    const candidates = [];
    if (process.platform === 'win32') {
      try {
        const w = await spawnSafe('where', ['opencode'], { timeoutMs: 10000 });
        if (w.code === 0) {
          const lines = w.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          // En Windows, `opencode` suele resolverse a shims (.cmd/.ps1 o script
          // sh sin extension) que CreateProcess NO puede lanzar sin shell.
          // Solo los .exe son ejecutables directos: se descartan los demas.
          const isDirectExe = (p) => p.toLowerCase().endsWith('.exe') && fs.existsSync(p);
          const exes = lines.filter(isDirectExe);
          // .exe primero; los shims no ejecutables ni se intentan.
          exes.sort();
          candidates.push(...exes);
        }
      } catch (e) {}
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
      candidates.push(path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
    } else {
      try {
        const w = await spawnSafe('which', ['opencode'], { timeoutMs: 10000 });
        if (w.code === 0) candidates.push(...w.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
      } catch (e) {}
    }
    candidates.push('opencode');
    for (const c of candidates) {
      if (tried.includes(c.toLowerCase())) continue;
      tried.push(c.toLowerCase());
      if (path.isAbsolute(c)) {
        if (!fs.existsSync(c)) continue;
        // Defensa en Windows: solo ejecutables directos (.exe); los shims
        // .cmd/.ps1 o scripts sh fallan con ENOENT sin shell.
        if (process.platform === 'win32' && !c.toLowerCase().endsWith('.exe')) continue;
      }
      try {
        const r = await spawnSafe(c, ['--version'], { timeoutMs: 15000 });
        if (r.code === 0) {
          this._binary = c;
          return c;
        }
      } catch (e) {
        // ENOENT u otro: probar siguiente candidato
      }
    }
    throw new Error(
      'No se encontro un ejecutable opencode funcional. ¿Esta instalado? https://opencode.ai (opencode --version debe responder).'
    );
  }

  authHeaders() {
    if (!this.password) return {};
    const user = this.username || 'opencode';
    return { Authorization: `Basic ${Buffer.from(`${user}:${this.password}`).toString('base64')}` };
  }

  /**
   * Contenido para OPENCODE_CONFIG_CONTENT del hijo `opencode run`
   * (solo `provider`, sin `model`: el flag --model manda).
   * Cacheado; null si no hay template o no trae provider.
   */
  providerEnv() {
    if (this._providerEnv !== undefined) return this._providerEnv;
    this._providerEnv = null;
    if (!this.providerTemplate) return null;
    try {
      const tpl = JSON.parse(fs.readFileSync(this.providerTemplate, 'utf8'));
      if (tpl && tpl.provider && typeof tpl.provider === 'object') {
        this._providerEnv = JSON.stringify({ provider: tpl.provider });
      }
    } catch (e) {
      this._providerEnv = null;
    }
    return this._providerEnv;
  }

  async health() {
    if (this.mode === 'run') {
      try {
        const bin = await this.resolveBinary();
        const r = await spawnSafe(bin, ['--version'], { timeoutMs: 15000 });
        const version = (r.stdout || r.stderr || '').trim().split('\n')[0];
        if (r.code !== 0) throw new Error((r.stderr || 'opencode --version fallo').trim());
        return { ok: true, mode: 'run', version };
      } catch (e) {
        return {
          ok: false,
          mode: 'run',
          error: e.message,
          hint: '¿Esta instalado opencode? https://opencode.ai (opencode --version debe responder).'
        };
      }
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${this.url}/global/health`, {
        headers: this.authHeaders(),
        signal: ctrl.signal
      }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return { ok: body.healthy !== false, mode: 'serve', version: body.version };
    } catch (e) {
      return {
        ok: false,
        mode: 'serve',
        error: e.message,
        hint: `¿Esta levantado opencode serve? Ejecuta: opencode serve --port 4096 (URL: ${this.url}).`
      };
    }
  }

  /**
   * @param {object} opts - { agent, prompt, files?, title?, model?, variant?, signal?, timeoutMs?, sessionID? }
   *   sessionID: reutiliza la sesion opencode (un agente = una sesion por
   *   ejecucion; evita decenas de sesiones duplicadas con el mismo titulo).
   * @returns {Promise<{text, sessionID}>}
   */
  async generate(opts = {}) {
    if (!opts.prompt || typeof opts.prompt !== 'string') {
      throw new Error('generate() requiere prompt (string no vacio)');
    }
    const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : this.timeoutMs;
    const { signal, cleanup } = linkSignals(opts.signal, timeoutMs);
    try {
      if (this.mode === 'run') return await this._generateRun(opts, signal);
      return await this._generateServe(opts, signal);
    } finally {
      cleanup();
    }
  }

  /** Construye argv de `opencode run` (puro: testeable sin binario). */
  buildRunArgs(opts = {}) {
    // Absoluta si es relativa: el servidor puede arrancar desde otro cwd y
    // `--dir` relativo apuntaria al sitio equivocado (fallo code 1 sin pista).
    // Las absolutas se respetan tal cual (portabilidad de tests en win32).
    const rawDir = opts.dir || this.dir;
    const dir = path.isAbsolute(rawDir) ? rawDir : path.resolve(rawDir);
    const args = ['run', '--format', 'json', '--dir', dir];
    if (opts.agent) args.push('--agent', opts.agent);
    args.push('--model', opts.model || this.model);
    const variant = (opts.variant || this.variant || '').trim();
    if (variant) args.push('--variant', variant);
    if (this.auto) args.push('--auto');
    for (const f of opts.files || []) args.push('--file', f);
    if (opts.title) args.push('--title', opts.title);
    // Continuar la sesion del agente en vez de crear una nueva por llamada.
    if (opts.sessionID) args.push('--session', opts.sessionID);
    args.push(opts.prompt);
    return args;
  }

  async _generateRun(opts, signal) {
    const bin = await this.resolveBinary();
    // dir por llamada (p.ej. outputs/session-XXX): el modelo nunca trabaja
    // sobre la raiz del repo salvo que se pida explicitamente.
    const args = this.buildRunArgs(opts);

    // Proveedor explicito al hijo (respeta el entorno existente):
    // sin esto, `run` puede morir con UnknownError antes de usar Ollama.
    const injected = this.providerEnv();
    const baseEnv = { ...process.env, ...this.extraEnv };
    if (injected && !baseEnv.OPENCODE_CONFIG_CONTENT) {
      baseEnv.OPENCODE_CONFIG_CONTENT = injected;
    }

    const r = await spawnSafe(bin, args, {
      timeoutMs: 0, // el timeout lo gobierna el AbortSignal enlazado
      signal,
      stdin: 'ignore', // headless: nunca esperar input interactivo (falla rapido, no cuelga)
      maxBuffer: 20 * 1024 * 1024,
      env: baseEnv
    });
    if (signal.aborted) throw new Error('generate() cancelado (abort)');
    if (r.code !== 0) {
      // opencode suele explicar el fallo en STDOUT (eventos JSON de error),
      // no en stderr: incluir ambos, o el mensaje queda vacio e indiagnosticable.
      const errTail = tail(r.stderr);
      const outTail = tail(r.stdout);
      const model = (opts.model || this.model || '').trim();
      throw new Error(
        `opencode run fallo (code ${r.code}, model=${model || '?'}):` +
          (errTail ? ` stderr: ${errTail}` : ' stderr vacio.') +
          (outTail ? ` stdout: ${outTail}` : ' stdout vacio.')
      );
    }
    const text = collectRunText(r.stdout);
    if (!text) {
      // Fallback: stdout no-JSON (p.ej. versiones sin --format json util)
      const raw = (r.stdout || '').trim();
      if (raw) return { text: raw, sessionID: collectRunSessionID(r.stdout) || opts.sessionID || null };
      throw new Error('opencode run no devolvio texto utilizable');
    }
    return { text, sessionID: collectRunSessionID(r.stdout) || opts.sessionID || null };
  }

  async _serveJson(method, p, body, signal) {
    const res = await fetch(`${this.url}${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`opencode serve ${method} ${p} -> HTTP ${res.status} ${t.slice(0, 200)}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return res.json();
  }

  async _generateServe(opts, signal) {
    // Reutiliza la sesion del agente si se indica (evita duplicadas).
    let sessionID = opts.sessionID || null;
    if (!sessionID) {
      const session = await this._serveJson('POST', '/session', { title: opts.title || 'ai-scrum-team' }, signal);
      sessionID = session && (session.id || session.ID);
      if (!sessionID) throw new Error('opencode serve no devolvio session.id');
    }
    try {
      const msg = {
        agent: opts.agent,
        model: opts.model || this.model,
        parts: [{ type: 'text', text: opts.prompt }]
      };
      const variant = (opts.variant || this.variant || '').trim();
      if (variant) msg.variant = variant;
      const body = await this._serveJson('POST', `/session/${sessionID}/message`, msg, signal);
      const text = collectMessageText(body);
      if (!text) throw new Error('opencode serve devolvio un mensaje sin texto');
      return { text, sessionID };
    } finally {
      // Best-effort: aborta la sesion si nos cancelaron a mitad.
      if (signal.aborted) {
        try {
          await this._serveJson('POST', `/session/${sessionID}/abort`, {}, undefined);
        } catch (e) {}
      }
    }
  }
}

module.exports = { OpencodeAdapter, collectRunText, collectRunSessionID, collectMessageText };
