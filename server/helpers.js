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


module.exports = {
  listModelsEndpointLabel,
  mergeProjectConfigPatch,
  loadDashboardStateFromDisk,
  mergeCredentialsPatch,
  mergeLocalForOllamaTest,
  sanitizeProjectConfigForClient
};
