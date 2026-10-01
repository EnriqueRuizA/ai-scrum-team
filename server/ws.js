// server/ws.js - FASE 5: broadcast WebSocket (extraido de server.js).
const WebSocket = require('ws');

function attachWs(wss, state) {
  const connectedClients = new Set();
// WebSocket - broadcast a todos los clientes
  function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  connectedClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
  }

  wss.on('connection', async (ws) => {
  connectedClients.add(ws);
  console.log('Dashboard conectado. Clientes:', connectedClients.size);

  try {
    let statePayload = null;
    if (state.orchestrator) {
      statePayload = { ...state.orchestrator.getState(), _activeRun: true };
    } else {
      statePayload = await require('./helpers').loadDashboardStateFromDisk();
    }
    if (statePayload) {
      ws.send(
        JSON.stringify({
          type: 'state',
          data: statePayload,
          timestamp: new Date().toISOString()
        })
      );
    }
  } catch (e) {
    console.error('WS estado inicial:', e.message);
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch (e) {}
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
  });

  return { broadcast, connectedClients };
}

module.exports = { attachWs };
