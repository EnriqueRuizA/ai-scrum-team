// __tests__/skills.test.js - U1: descubrimiento de skills opencode.
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { parseSkillFrontmatter, discoverSkills, missingSkills } = require('../utils/skills');

describe('parseSkillFrontmatter', () => {
  test('extrae name/description', () => {
    const fm = parseSkillFrontmatter('---\nname: mis-docs\ndescription: Lee docs\n---\n\n# body\n');
    expect(fm).toEqual({ name: 'mis-docs', description: 'Lee docs' });
  });
  test('sin frontmatter devuelve {}', () => {
    expect(parseSkillFrontmatter('# solo titulo')).toEqual({});
  });
});

describe('discoverSkills', () => {
  test('lista SKILL.md del workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-'));
    await fs.outputFile(
      path.join(root, '.opencode', 'skills', 'mis-docs', 'SKILL.md'),
      '---\nname: mis-docs\ndescription: Docs del proyecto\n---\n\nHola\n'
    );
    await fs.ensureDir(path.join(root, '.opencode', 'skills', 'vacia'));
    const out = await discoverSkills(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'mis-docs', description: 'Docs del proyecto' });
    await fs.remove(root);
  });

  test('sin directorio devuelve []', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noskills-'));
    expect(await discoverSkills(root)).toEqual([]);
    await fs.remove(root);
  });
});

describe('missingSkills', () => {
  test('detecta referenciadas ausentes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'misss-'));
    const config = {
      agents: {
        roles: [
          { id: 'a', enabled: true, skills: ['existe', 'falta'] },
          { id: 'b', enabled: false, skills: ['otra'] }
        ]
      }
    };
    await fs.outputFile(path.join(root, '.opencode', 'skills', 'existe', 'SKILL.md'), '---\nname: existe\ndescription: x\n---\n');
    expect(await missingSkills(config, root)).toEqual(['falta']);
    await fs.remove(root);
  });
});
