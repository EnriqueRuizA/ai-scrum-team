// server/routes/run.js - FASE 5: rutas (extraido de server.js, sin cambios de comportamiento).
const fs = require('fs-extra');
const { authHeadersFromLocalConfig } = require('../../lib/local-llm');
const { resolveHttpAdapterFromLocal } = require('../../lib/llm-provider-presets');
const { checkHealth, verifyLlmModels } = require('../../lib/unified-local-llm');
function registerRun(app, ctx) {
  const { broadcast, runLock, state, runProject } = ctx;
// Iniciar el proyecto
  app.post('/api/start', async (req, res) => {
  if (!runLock.tryAcquire({ endpoint: '/api/start' })) {
    return res.status(409).json({ error: 'Ya hay un proyecto en ejecución', run: runLock.getInfo() });
  }

  try {
    const config = await fs.readJson('./config/project-config.json');
    const useLocal = config.agents?.backend === 'local';
    let credentials = {};
    if (!useLocal) {
      credentials = await fs.readJson('./config/credentials.json').catch(() => ({}));
      if (!credentials.claude?.email || !String(credentials.claude.email).trim()) {
        return res.status(400).json({
          error: 'Credenciales de Claude.ai: indica al menos el email. La contraseña es opcional si usas enlace mágico por correo.'
        });
      }
    } else if (config.agents?.opencode) {
      // FASE 2: el motor es opencode (modelos gratuitos). Un solo health-check.
      const { createAdapter } = require('../../llm/factory');
      const ocHealth = await createAdapter(config).health();
      if (!ocHealth.ok) {
        return res.status(400).json({
          error: `Motor opencode no disponible (${ocHealth.mode}): ${ocHealth.error}. ${ocHealth.hint || ''}`
        });
      }
    } else {
      const localCfg = config.agents?.local || {};
      const baseUrl = localCfg.baseUrl || 'http://localhost:11434';
      const model = localCfg.model || 'llama3.2';
      const httpAdapter = resolveHttpAdapterFromLocal(localCfg);
      if (httpAdapter === 'cursor_cloud') {
        return res.status(400).json({
          error:
            'La API oficial de Cursor (api.cursor.com) usa Basic Auth y expone GET /v0/models para Cloud Agents; ' +
            'no ofrece /v1/chat/completions para este orquestador. Para «Iniciar proyecto» elige Ollama, un proveedor OpenAI-compatible (p. ej. OpenAI con sk-…) o backend Claude (navegador). ' +
            'Puedes usar la plantilla «Cursor Cloud API» solo para probar la clave y listar modelos en Settings.'
        });
      }
      const authHeaders = authHeadersFromLocalConfig(localCfg);
      const health = await checkHealth(baseUrl, model, { authHeaders, local: localCfg });
      if (!health.ok) {
        const detail = health.error || 'desconocido';
        let errorMsg;
        if (httpAdapter === 'openai_compatible') {
          errorMsg = `No se puede conectar con la API en ${baseUrl}. Revisa URL (…/v1), red y API key. Detalle: ${detail}`;
        } else {
          errorMsg = `No se puede conectar con Ollama en ${baseUrl}. Inicia Ollama ("ollama serve") y revisa agents.local.baseUrl. Detalle: ${detail}`;
        }
        return res.status(400).json({ error: errorMsg });
      }
      if (health.modelLoaded === false) {
        let errorMsg;
        if (httpAdapter === 'openai_compatible') {
          errorMsg = `La API respondió pero no aparece el modelo de chat «${model}» en el listado. Revisa el id en la documentación del proveedor.`;
        } else {
          errorMsg = `Ollama está activo pero el modelo "${model}" no está disponible. Ejecuta: ollama pull ${model}`;
        }
        return res.status(400).json({ error: errorMsg });
      }

      const ragOn = localCfg.rag?.enabled === true;
      if (ragOn) {
        const embedModel =
          localCfg.embedModel || localCfg.rag?.embedModel || 'nomic-embed-text';
        const v = await verifyLlmModels(baseUrl, model, embedModel, { authHeaders, local: localCfg });
        if (!v.ok) {
          return res.status(400).json({
            error: `No se pudo comprobar modelos: ${v.error}`
          });
        }
        if (!v.hasEmbed) {
          return res.status(400).json({
            error:
              httpAdapter === 'openai_compatible'
                ? `RAG activo pero el proveedor no lista el modelo de embeddings «${embedModel}». Cambia embedModel en Settings o desactiva RAG.`
                : `RAG está activo (agents.local.rag.enabled) pero falta el modelo de embeddings «${embedModel}» en Ollama. ` +
                  `No se “importa” el RAG en Ollama: es un segundo modelo que calcula vectores. En una terminal ejecuta:\n` +
                  `  ollama pull ${embedModel}\n` +
                  `Luego vuelve a iniciar el proyecto. (Puedes desactivar RAG en Settings si no lo necesitas.)`
          });
        }
      }
    }

    broadcast('status', { status: 'starting' });
    res.json({ success: true, message: 'Proyecto iniciado' });

    // Ejecutar en background
    runProject(config, credentials).catch(err => {
      console.error('Error en proyecto:', err);
      broadcast('error', { message: err.message });
    });

  } catch (e) {
    runLock.release();
    res.status(500).json({ error: e.message });
  }
  });

// Control de ejecución (pausa entre pasos / parada al terminar sprint o hito de discovery)
  app.post('/api/run/pause', (req, res) => {
    if (!state.orchestrator) return res.status(400).json({ error: 'No hay proyecto en ejecución' });
    state.orchestrator.setPaused(true);
    broadcast('run_control', { paused: true });
    res.json({ success: true, paused: true });
  });

  app.post('/api/run/resume', (req, res) => {
    if (!state.orchestrator) return res.status(400).json({ error: 'No hay proyecto en ejecución' });
    state.orchestrator.setPaused(false);
    broadcast('run_control', { paused: false });
    res.json({ success: true, paused: false });
  });

  app.post('/api/run/stop-after-step', (req, res) => {
    if (!state.orchestrator) return res.status(400).json({ error: 'No hay proyecto en ejecución' });
    state.orchestrator.requestStopAfterCurrentStep();
    broadcast('run_control', { stopPending: true });
    res.json({ success: true, stopPending: true });
  });

  // U3: alias legacy POST /api/pause eliminado (usar POST /api/run/pause).

}

module.exports = registerRun;
