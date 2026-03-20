const WebSocket = require('ws');

jest.mock('fs-extra', () => {
  const actual = jest.requireActual('fs-extra');
  return {
    ...actual,
    readJson: jest.fn().mockResolvedValue({ agents: { backend: 'local', local: { baseUrl: 'http://localhost:11434', model: 'llama3.2' } } }),
    writeJson: jest.fn(),
    pathExists: jest.fn().mockResolvedValue(true)
  };
});

jest.mock('../orchestrator', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    getState: jest.fn().mockReturnValue({ status: 'idle', sprints: [], logs: [] }),
    initialize: jest.fn().mockResolvedValue(undefined),
    runFullProject: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
    state: { sessionId: 'test-session' }
  }));
});

const { createServer } = require('../server');

describe('server WebSocket (integration)', () => {
  test('responds pong to ping', async () => {
    const { server, wss, start } = createServer();
    await start(0);
    const port = server.address().port;

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msg = await new Promise((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'ping' })));
      ws.on('message', (data) => resolve(String(data)));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout waiting message')), 2000);
    });

    expect(() => JSON.parse(msg)).not.toThrow();
    expect(JSON.parse(msg).type).toBe('pong');

    await new Promise((resolve) => {
      ws.terminate();
      resolve();
    });
    await new Promise((resolve) => wss.close(() => resolve()));
    await new Promise((resolve) => server.close(() => resolve()));
    logSpy.mockRestore();
  });
});

