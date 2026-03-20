const { normalizeTeam, getEnabledRoles, defaultTeam } = require('../lib/default-team');

describe('lib/default-team', () => {
  test('defaultTeam tiene 4 roles', () => {
    expect(defaultTeam()).toHaveLength(4);
  });

  test('normalizeTeam respeta enabled false', () => {
    const team = normalizeTeam({
      agents: {
        team: [
          { role: 'scrumMaster', enabled: true, label: 'X' },
          { role: 'productOwner', enabled: false, label: 'Y' }
        ]
      }
    });
    const on = getEnabledRoles(team);
    expect(on.has('scrumMaster')).toBe(true);
    expect(on.has('productOwner')).toBe(false);
  });
});
