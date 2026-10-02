// __tests__/pipeline-paths.test.js - Rutas del modelo: absolutas-dentro se
// relativizan, las de fuera se rechazan (contencion garantizada).
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { toContainedRelPath, writeFilesContained } = require('../orchestrator/pipeline');

describe('toContainedRelPath', () => {
  let base;
  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'paths-'));
  });
  afterEach(async () => {
    await fs.remove(base);
  });

  test('relativa normal se mantiene contenida', () => {
    expect(toContainedRelPath(base, 'app/index.js')).toBe(path.join('app', 'index.js'));
    expect(toContainedRelPath(base, './app/index.js')).toBe(path.join('app', 'index.js'));
  });

  test('absoluta DENTRO de baseDir se relativiza (caso Windows del modelo)', () => {
    const abs = path.join(base, 'package.json');
    expect(toContainedRelPath(base, abs)).toBe('package.json');
    const nested = path.join(base, 'src', 'a.js');
    expect(toContainedRelPath(base, nested)).toBe(path.join('src', 'a.js'));
  });

  test('traversal y hermanos fuera se rechazan', () => {
    expect(() => toContainedRelPath(base, '../fuera.js')).toThrow(/fuera del proyecto/);
    expect(() => toContainedRelPath(base, '../../etc/passwd')).toThrow(/fuera del proyecto/);
    const sibling = path.join(path.dirname(base), 'hermano.js');
    expect(() => toContainedRelPath(base, sibling)).toThrow(/fuera del proyecto/);
  });

  test('absoluta raiz y baseDir mismo se rechazan', () => {
    expect(() => toContainedRelPath(base, path.parse(base).root)).toThrow(/fuera del proyecto/);
    expect(() => toContainedRelPath(base, base)).toThrow(/fuera del proyecto/);
  });

  test('vacias y nulas se rechazan', () => {
    expect(() => toContainedRelPath(base, '')).toThrow(/vacia/);
    expect(() => toContainedRelPath(base, 'a\0b')).toThrow();
  });

  test('otra unidad en Windows se rechaza', () => {
    if (process.platform !== 'win32') return;
    const otherDrive = base.toLowerCase().startsWith('c:') ? 'D:\\evil.js' : 'C:\\evil.js';
    expect(() => toContainedRelPath(base, otherDrive)).toThrow(/fuera del proyecto/);
  });
});

describe('writeFilesContained con absolutas-dentro', () => {
  let base;
  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'wpaths-'));
  });
  afterEach(async () => {
    await fs.remove(base);
  });

  test('escribe el fichero dentro de baseDir (caso del error reportado)', async () => {
    const abs = path.join(base, 'package.json');
    const written = await writeFilesContained(base, [{ path: abs, code: '{}' }]);
    expect(written).toEqual(['package.json']);
    expect(await fs.readFile(path.join(base, 'package.json'), 'utf8')).toBe('{}');
  });

  test('no escribe nada fuera y falla', async () => {
    await expect(
      writeFilesContained(base, [{ path: path.join(path.dirname(base), 'x.js'), code: 'x' }])
    ).rejects.toThrow(/fuera del proyecto/);
    expect(await fs.pathExists(path.join(path.dirname(base), 'x.js'))).toBe(false);
  });
});
