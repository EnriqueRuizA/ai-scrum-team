const EventEmitter = require('events');
const http = require('http');
const { checkHealth, authHeadersFromLocalConfig } = require('../lib/local-llm');

function mockHttpRequest(impl) {
  return jest.spyOn(http, 'request').mockImplementation(impl);
}

describe('lib/local-llm', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('checkHealth returns ok:false when request errors', async () => {
    mockHttpRequest(() => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = jest.fn(() => {
        process.nextTick(() => {
          const err = new Error('connect ECONNREFUSED');
          err.code = 'ECONNREFUSED';
          req.emit('error', err);
        });
      });
      return req;
    });

    await expect(checkHealth('http://localhost:11434', 'llama3.2')).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('ECONNREFUSED') })
    );
  });

  test('checkHealth returns modelLoaded:false when model missing', async () => {
    mockHttpRequest((options, cb) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = jest.fn(() => {
        process.nextTick(() => {
          cb(res);
          process.nextTick(() => {
            res.emit('data', Buffer.from(JSON.stringify({ models: [{ name: 'mistral:latest' }] })));
            res.emit('end');
          });
        });
      });
      return req;
    });

    await expect(checkHealth('http://localhost:11434', 'llama3.2')).resolves.toEqual(
      expect.objectContaining({ ok: true, modelLoaded: false })
    );
  });

  test('authHeadersFromLocalConfig: bearer por defecto con apiKey en config', () => {
    expect(authHeadersFromLocalConfig({ apiKey: ' sk-1 ' })).toEqual({ Authorization: 'Bearer sk-1' });
  });

  test('authHeadersFromLocalConfig: x-api-key', () => {
    expect(authHeadersFromLocalConfig({ apiKey: 'k', apiKeyMode: 'x-api-key' })).toEqual({ 'X-API-Key': 'k' });
  });

  test('authHeadersFromLocalConfig: Basic (Cursor API)', () => {
    const key = 'key_abc';
    const token = Buffer.from(`${key}:`, 'utf8').toString('base64');
    expect(authHeadersFromLocalConfig({ apiKey: key, apiKeyMode: 'basic' })).toEqual({
      Authorization: `Basic ${token}`
    });
  });

  test('authHeadersFromLocalConfig: OPENAI_API_KEY como respaldo', () => {
    delete process.env.AI_SCRUM_LOCAL_API_KEY;
    delete process.env.OLLAMA_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-openai';
    try {
      expect(authHeadersFromLocalConfig({})).toEqual({ Authorization: 'Bearer sk-openai' });
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  test('authHeadersFromLocalConfig: prioridad apiKeyEnv sobre apiKey', () => {
    process.env.TEST_SCRUM_KEY = 'from-env';
    try {
      expect(
        authHeadersFromLocalConfig({ apiKey: 'from-file', apiKeyEnv: 'TEST_SCRUM_KEY' })
      ).toEqual({ Authorization: 'Bearer from-env' });
    } finally {
      delete process.env.TEST_SCRUM_KEY;
    }
  });

  test('authHeadersFromLocalConfig: custom header', () => {
    expect(
      authHeadersFromLocalConfig({
        apiKey: 'tok',
        apiKeyMode: 'custom',
        apiKeyHeader: 'X-Custom',
        apiKeyPrefix: 'Token '
      })
    ).toEqual({ 'X-Custom': 'Token tok' });
  });
});
