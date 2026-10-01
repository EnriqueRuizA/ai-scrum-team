// server/helpers.js - FASE 5: utilidades compartidas (extraido de server.js).
const fs = require('fs-extra');
const path = require('path');
const { authHeadersFromLocalConfig } = require('../lib/local-llm');

/** Etiqueta del endpoint usado al listar modelos (logs y JSON del dashboard). */
function listModelsEndpointLabel(httpAdapter) {
  if (httpAdapter === 'cursor_cloud') return 'GET /v0/models';
  if (httpAdapter === 'openai_compatible') return 'GET /v1/models';
  return 'GET /api/tags';
}

/** Evita borrar backend Ollama/Claude al guardar solo project/scrum/agents parciales desde el dashboard */
function mergeProjectConfigPatch(current, patch) {
  if (!patch || typeof patch !== 'object') return current;
  const next = { ...current };
  if (patch.project) next.project = { ...(current.project || {}), ...patch.project };
  if (patch.scrum) next.scrum = { ...(current.scrum || {}), ...patch.scrum };
  if (patch.agents) {
    const a = { ...(current.agents || {}), ...patch.agents };
    if (patch.agents.local) {
      a.local = {
        ...(current.agents?.local || {}),
        ...patch.agents.local,
        rag:
          patch.agents.local.rag != null
            ? { ...(current.agents?.local?.rag || {}), ...patch.agents.local.rag }
            : current.agents?.local?.rag
      };
    }
    if (Array.isArray(patch.agents.team)) {
      a.team = patch.agents.team;
    }
    next.agents = a;
  }
  if (patch.pipeline) {
    next.pipeline = { ...(current.pipeline || {}), ...patch.pipeline };
  }
  if (patch.target) {
    next.target = { ...(current.target || {}), ...patch.target };
    if (patch.target.techStack) {
      next.target.techStack = {
        ...(current.target?.techStack || {}),
        ...patch.target.techStack
      };
    }
  }
  if (patch.outputs) next.outputs = { ...(current.outputs || {}), ...patch.outputs };
  return next;
}

/** Última sesión con state.json guardado (F5 o reinicio del servidor sin orquestador en RAM). */
async function loadDashboardStateFromDisk() {
  const pointerPath = path.join('./outputs', '.last-dashboard-session.json');
  if (!(await fs.pathExists(pointerPath))) return null;
  const ptr = await fs.readJson(pointerPath).catch(() => null);
  if (!ptr || typeof ptr !== 'object') return null;
  const folder = ptr.outputFolder || ptr.folder;
  if (
    !folder ||
    typeof folder !== 'string' ||
    folder.includes('..') ||
    path.normalize(folder).includes('..') ||
    !folder.startsWith('session-')
  ) {
    return null;
  }
  const statePath = path.join('./outputs', folder, 'state.json');
  if (!(await fs.pathExists(statePath))) return null;
  const state = await fs.readJson(statePath).catch(() => null);
  if (!state || typeof state !== 'object') return null;
  return {
    ...state,
    _restoredFromDisk: true,
    _activeRun: false,
    _sessionOutputFolder: folder
  };
}

/** Fusiona credenciales por plataforma sin sustituir todo el bloque (conserva password si no se envía) */
function mergeCredentialsPatch(current, body) {
  const { isSafeKey } = require('./guards');
  const out = { ...current };
  for (const [key, val] of Object.entries(body || {})) {
    if (!isSafeKey(key)) continue; // anti prototype-pollution (__proto__/constructor/prototype)
    if (val != null && typeof val === 'object' && !Array.isArray(val)) {
      const prev = current[key] && typeof current[key] === 'object' ? current[key] : {};
      const merged = { ...prev, ...val };
      if (Object.prototype.hasOwnProperty.call(val, 'password') && (val.password === '' || val.password === null)) {
        delete merged.password;
      }
      out[key] = merged;
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Para POST /api/ollama/test-auth: mezcla agents.local del disco con el cuerpo (valores del formulario).
 * No sobrescribe apiKey del fichero si el formulario envía vacío (significa “usar la guardada”).
 */
function mergeLocalForOllamaTest(fileLocal, patch) {
  const base = { ...(fileLocal || {}) };
  if (!patch || typeof patch !== 'object') return base;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'apiKey' && (v == null || String(v).trim() === '')) continue;
    if (v === undefined) continue;
    base[k] = v;
  }
  return base;
}

/** No exponer apiKey al navegador; indica si habrá cabecera de autenticación (archivo o env). */
function sanitizeProjectConfigForClient(config) {
  const c = JSON.parse(JSON.stringify(config));
  if (c.agents?.local) {
    const loc = c.agents.local;
    const headers = authHeadersFromLocalConfig(loc);
    delete loc.apiKey;
    loc.hasApiKey = Object.keys(headers).length > 0;
  }
  return c;
}

const DEFAULT_STATE_LOGS = 500;
const MAX_STATE_LOGS = 5000;

/**
 * Recorta los logs de un state para respuestas HTTP (FASE 6).
 * - logs: numero maximo (defecto 500, 0 = todos, tope 5000).
 * - since: ISO timestamp; solo logs >= since.
 * Devuelve copia con `_logsTotal` (original) y `_logsLimited` (bool).
 */
function limitStateLogs(state, query = {}) {
  if (!state || typeof state !== 'object') return state;
  const all = Array.isArray(state.logs) ? state.logs : [];
  let n = DEFAULT_STATE_LOGS;
  if (query.logs !== undefined) {
    const parsed = Number.parseInt(String(query.logs), 10);
    if (Number.isInteger(parsed) && parsed >= 0) n = Math.min(parsed, MAX_STATE_LOGS);
  }
  let kept = all;
  if (typeof query.since === 'string' && query.since) {
    kept = kept.filter((e) => e && typeof e.timestamp === 'string' && e.timestamp >= query.since);
  }
  const limited = n === 0 ? kept : kept.slice(-n);
  return {
    ...state,
    logs: limited,
    _logsTotal: all.length,
    _logsLimited: limited.length !== all.length
  };
}

/**
 * Lee los artefactos de pasos (sprint-N-step-I-rol-tarea.json) de una sesion,
 * ordenados por sprint y paso. Para la vista Conversacion del dashboard.
 */
async function readStepArtifacts(outputsDir, sessionId) {
  const { validateSessionId, safeJoin } = require('./guards');
  if (!validateSessionId(sessionId)) throw new Error('id de sesión inválido');
  const dir = safeJoin(outputsDir, sessionId, 'artifacts');
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch (e) {
    return [];
  }
  const out = [];
  for (const name of entries) {
    const m = /^sprint-(\d+)-step-(\d+)-(.+)-([A-Za-z]+)\.json$/.exec(name);
    if (!m) continue;
    try {
      const data = await fs.readJson(require('path').join(dir, name));
      out.push({
        file: name,
        sprint: Number(m[1]),
        step: Number(m[2]),
        role: data.role || m[3],
        task: data.task || m[4],
        exchange: data.exchange || null,
        iterations: (data.iterations || []).map((it) => ({
          n: it.n,
          kind: it.kind,
          role: it.role,
          task: it.task,
          ms: it.ms,
          exchange: it.exchange || null
        })),
        written: data.written || [],
        ts: data.ts || null
      });
    } catch (e) {
      continue;
    }
  }
  out.sort((a, b) => a.sprint - b.sprint || a.step - b.step);
  return out;
}


module.exports = {
  listModelsEndpointLabel,
  mergeProjectConfigPatch,
  loadDashboardStateFromDisk,
  mergeCredentialsPatch,
  mergeLocalForOllamaTest,
  sanitizeProjectConfigForClient,
  limitStateLogs,
  DEFAULT_STATE_LOGS,
  MAX_STATE_LOGS,
  readStepArtifacts
};
