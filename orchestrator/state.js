// orchestrator/state.js - FASE 1: persistencia de estado con garantias.
// - Escritura ATOMICA (tmp + rename) para sobrevivir a SIGKILL a mitad de escritura.
// - Cola interna: un solo vuelo de escritura; saveState() nunca lanza.
// - Debounce: los logs frecuentes programan un guardado, no escriben cada linea.
// - Tope de logs en RAM (MAX_LOGS) con overflow a logs-overflow.jsonl.

const fs = require('fs-extra');
const path = require('path');

const MAX_LOGS = 5000;
const SAVE_DEBOUNCE_MS = 500;

function initialState(sessionId, maxSprints) {
  return {
    sessionId,
    status: 'idle',
    currentSprint: 0,
    maxSprints,
    sprints: [],
    artifacts: {
      prd: null,
      architecture: null,
      testPlan: null,
      sprintPlan: null,
      implementations: [],
      qaReports: [],
      finalCode: null
    },
    logs: [],
    errors: [],
    runPaused: false
  };
}

class StateStore {
  constructor(outputDir, sessionId, maxSprints) {
    this.outputDir = outputDir;
    this.statePath = path.join(outputDir, 'state.json');
    this.overflowPath = path.join(outputDir, 'logs-overflow.jsonl');
    this.state = initialState(sessionId, maxSprints);
    this._saveTimer = null;
    this._savePromise = null;
    this.saved = false;
    this.saveError = null;
  }

  pushLog(entry) {
    this.state.logs.push(entry);
    if (this.state.logs.length > MAX_LOGS) {
      const dropped = this.state.logs.splice(0, this.state.logs.length - MAX_LOGS);
      // Overflow a disco (fire-and-forget con catch para no romper el run)
      const lines = dropped.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.ensureDir(this.outputDir)
        .then(() => fs.appendFile(this.overflowPath, lines))
        .catch(() => {});
    }
  }

  /** Programa un guardado debounced. Nunca lanza. */
  scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  /** Guarda ahora (un solo vuelo). Nunca lanza: registra en saveError. */
  async saveNow() {
    if (this._savePromise) return this._savePromise;
    this._savePromise = this._writeAtomic()
      .then(() => {
        this.saved = true;
        this.saveError = null;
      })
      .catch((e) => {
        this.saveError = e && e.message ? e.message : String(e);
      })
      .finally(() => {
        this._savePromise = null;
      });
    return this._savePromise;
  }

  async _writeAtomic() {
    await fs.ensureDir(this.outputDir);
    const tmp = `${this.statePath}.tmp-${process.pid}`;
    await fs.writeJson(tmp, this.state, { spaces: 2 });
    await fs.move(tmp, this.statePath, { overwrite: true });
  }

  static async load(statePath) {
    return fs.readJson(statePath);
  }
}

module.exports = { StateStore, initialState, MAX_LOGS, SAVE_DEBOUNCE_MS };
