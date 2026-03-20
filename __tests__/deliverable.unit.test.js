const {
  extractFilesFromImplementation,
  writeFilesToDir,
  diagnoseEmptyImplementation,
  executionReportForPrompt
} = require('../lib/deliverable');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

describe('lib/deliverable', () => {
  test('extractFilesFromImplementation lee implementation.files', () => {
    const files = extractFilesFromImplementation({
      implementation: {
        files: [
          { path: 'src/a.js', code: 'console.log(1)' },
          { path: 'b.js', content: 'x' }
        ]
      }
    });
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('src/a.js');
    expect(files[1].code).toBe('x');
  });

  test('extractFilesFromImplementation acepta data.implementation.files', () => {
    const files = extractFilesFromImplementation({
      data: { implementation: { files: [{ path: 'x.js', code: '1' }] } }
    });
    expect(files).toEqual([{ path: 'x.js', code: '1' }]);
  });

  test('extractFilesFromImplementation acepta result.implementation.files', () => {
    const files = extractFilesFromImplementation({
      result: { implementation: { files: [{ path: 'y.js', code: '2' }] } }
    });
    expect(files).toEqual([{ path: 'y.js', code: '2' }]);
  });

  test('diagnoseEmptyImplementation devuelve texto útil', () => {
    const s = diagnoseEmptyImplementation({ foo: 1 }, 'abc');
    expect(s).toMatch(/files/);
    expect(s).toMatch(/longitud raw/);
  });

  test('executionReportForPrompt serializa pasos', () => {
    const t = executionReportForPrompt({ steps: [{ name: 'npm install', ok: true }] });
    expect(t).toContain('npm install');
  });

  test('writeFilesToDir escribe y respeta raíz', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deliv-'));
    const { count, paths } = await writeFilesToDir(dir, [
      { path: 'foo/bar.txt', code: 'hi' }
    ]);
    expect(count).toBe(1);
    expect(paths).toEqual(['foo/bar.txt']);
    expect(await fs.readFile(path.join(dir, 'foo/bar.txt'), 'utf8')).toBe('hi');
    await fs.remove(dir);
  });
});
