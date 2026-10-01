// llm/opencode-adapter.js - FASE 2: UNICO adapter de IA del proyecto.
// El motor es opencode (modelos gratuitos: proveedor Ollama local u otros
// proveedores free configurados en opencode). Dos modos (T1 del plan):
//   "serve" (primario): habla por HTTP con `opencode serve` (sin cold-boot).
//   "run"   (fallback): un `opencode run --format json` por llamada.
// El prompt NUNCA se interpola en un shell: viaja como argumento (run) o
// como JSON en el body (serve).

const { spawnSafe } = require('../utils/exec-safe');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

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
   * cfg = { mode, url, model, dir, timeoutMs, auto, command, username, password,
   *         env }
   */
  constructor(cfg = {}) {
    this.mode = cfg.mode === 'run' ? 'run' : 'serve';
    this.url = (cfg.url || 'http://127.0.0.1:4096').replace(/\/$/, '');
    this.model = cfg.model || 'ollama/llama3.2';
    this.dir = cfg.dir || process.cwd();
    this.timeoutMs = cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.auto = cfg.auto === true;
    this.command = cfg.command || 'opencode';
    this.username = cfg.username || process.env.OPENCODE_SERVER_USERNAME || '';
    this.password = cfg.password || process.env.OPENCODE_SERVER_PASSWORD || '';
    this.extraEnv = cfg.env || {};
  }

  authHeaders() {
    if (!this.password) return {};
    const user = this.username || 'opencode';
    return { Authorization: `Basic ${Buffer.from(`${user}:${this.password}`).toString('base64')}` };
  }

  async health() {
    if (this.mode === 'run') {
      try {
        const r = await spawnSafe(this.command, ['--version'], { timeoutMs: 15000 });
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
   * @param {object} opts - { agent, prompt, files?, title?, model?, signal?, timeoutMs? }
   * @returns {Promise<{text}>}
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

  async _generateRun(opts, signal) {
    const args = ['run', '--format', 'json', '--dir', this.dir];
    if (opts.agent) args.push('--agent', opts.agent);
    args.push('--model', opts.model || this.model);
    if (this.auto) args.push('--auto');
    for (const f of opts.files || []) args.push('--file', f);
    if (opts.title) args.push('--title', opts.title);
    args.push(opts.prompt);

    const r = await spawnSafe(this.command, args, {
      timeoutMs: 0, // el timeout lo gobierna el AbortSignal enlazado
      signal,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...this.extraEnv }
    });
    if (signal.aborted) throw new Error('generate() cancelado (abort)');
    if (r.code !== 0) {
      throw new Error(`opencode run fallo (code ${r.code}): ${(r.stderr || '').trim().slice(0, 500)}`);
    }
    const text = collectRunText(r.stdout);
    if (!text) {
      // Fallback: stdout no-JSON (p.ej. versiones sin --format json util)
      const raw = (r.stdout || '').trim();
      if (raw) return { text: raw };
      throw new Error('opencode run no devolvio texto utilizable');
    }
    return { text };
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
    const session = await this._serveJson('POST', '/session', { title: opts.title || 'ai-scrum-team' }, signal);
    const sessionID = session && (session.id || session.ID);
    if (!sessionID) throw new Error('opencode serve no devolvio session.id');
    try {
      const body = await this._serveJson('POST', `/session/${sessionID}/message`, {
        agent: opts.agent,
        model: opts.model || this.model,
        parts: [{ type: 'text', text: opts.prompt }]
      }, signal);
      const text = collectMessageText(body);
      if (!text) throw new Error('opencode serve devolvio un mensaje sin texto');
      return { text };
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

module.exports = { OpencodeAdapter, collectRunText, collectMessageText };
