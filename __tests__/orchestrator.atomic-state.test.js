// __tests__/orchestrator.atomic-state.test.js - FASE 1: estado atomico y topado.
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { StateStore, MAX_LOGS } = require('../orchestrator/state');

describe('StateStore', () => {
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  test('saveNow escribe JSON valido y no deja .tmp huerfanos', async () => {
    const store = new StateStore(path.join(dir, 's1'), 'sess-1', 3);
    store.pushLog({ timestamp: new Date().toISOString(), agent: 't', level: 'info', message: 'hola' });
    await store.saveNow();
    expect(store.saved).toBe(true);
    expect(store.saveError).toBeNull();
    const back = await fs.readJson(path.join(dir, 's1', 'state.json'));
    expect(back.sessionId).toBe('sess-1');
    expect(back.logs).toHaveLength(1);
    const leftovers = (await fs.readdir(path.join(dir, 's1'))).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  test('saveNow nunca lanza aunque el disco falle', async () => {
    const store = new StateStore(path.join(dir, 's2'), 'sess-2', 1);
    // outputDir imposible: NUL no existe en Windows de forma escribible via ensureDir
    store.outputDir = path.join(dir, 's2');
    store.statePath = path.join('Z:\\definitivamente\\no\\existe\\x', 'state.json');
    await store.saveNow();
    expect(store.saved).toBe(false);
    expect(typeof store.saveError).toBe('string');
  });

  test('los logs se topan en MAX_LOGS con overflow a disco', async () => {
    const store = new StateStore(path.join(dir, 's3'), 'sess-3', 1);
    for (let i = 0; i < MAX_LOGS + 100; i++) {
      store.pushLog({ timestamp: 't', agent: 'a', level: 'info', message: `m${i}` });
    }
    expect(store.state.logs).toHaveLength(MAX_LOGS);
    // Da un tick al append fire-and-forget
    await new Promise((r) => setTimeout(r, 50));
    const overflow = await fs.readFile(path.join(dir, 's3', 'logs-overflow.jsonl'), 'utf8');
    expect(overflow.split('\n').filter(Boolean)).toHaveLength(100);
  });

  test('scheduleSave es debounced y de un solo vuelo', async () => {
    const store = new StateStore(path.join(dir, 's4'), 'sess-4', 1);
    let writes = 0;
    const orig = store._writeAtomic.bind(store);
    store._writeAtomic = async () => {
      writes += 1;
      await orig();
    };
    for (let i = 0; i < 10; i++) store.scheduleSave();
    await new Promise((r) => setTimeout(r, 900));
    expect(writes).toBe(1);
  });
});
