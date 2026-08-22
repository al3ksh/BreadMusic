const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveActivityCapabilities, resolveDashboardCapabilities } = require('../src/dashboard/access');
const { normalizeVolumeConfig } = require('../src/state/guildConfig');

function memberWith({ permissions = [], roles = [] } = {}) {
  return {
    permissions: { has: (permission) => permissions.includes(permission) },
    roles: { cache: { has: (roleId) => roles.includes(roleId) } },
  };
}

test('admin always has full dashboard capabilities', () => {
  const access = resolveDashboardCapabilities(
    memberWith({ permissions: ['ManageGuild'] }),
    { dashboardAccess: 'admin', djRoleId: null },
  );
  assert.equal(access.accessLevel, 'admin');
  assert.equal(access.canAccess, true);
  assert.equal(access.canManageConfig, true);
  assert.equal(access.canUseRemoteControl, true);
  assert.equal(access.maxVolume, 100);
});

test('DJ access admits configured DJ but not regular member', () => {
  const config = { dashboardAccess: 'dj', djRoleId: 'dj-role' };
  assert.equal(resolveDashboardCapabilities(memberWith({ roles: ['dj-role'] }), config).canAccess, true);
  assert.equal(resolveDashboardCapabilities(memberWith(), config).canAccess, false);
});

test('everyone is treated as DJ when no DJ role is configured', () => {
  const config = { dashboardAccess: 'dj', djRoleId: null };
  const access = resolveDashboardCapabilities(memberWith(), config);
  assert.equal(access.canAccess, true);
  assert.equal(access.accessLevel, 'dj');
  assert.equal(access.canControlPlayer, true);
  assert.equal(access.canUpload, true);
  assert.equal(access.canManageConfig, false);
  assert.equal(access.maxVolume, 100);
});

test('member access remains view-only for users without the DJ policy', () => {
  const access = resolveDashboardCapabilities(memberWith(), {
    dashboardAccess: 'members',
    djRoleId: 'dj-role',
  });
  assert.equal(access.canAccess, true);
  assert.equal(access.canControlPlayer, false);
  assert.equal(access.canUpload, false);
  assert.equal(access.canManageConfig, false);
  assert.equal(access.canUseRemoteControl, false);
});

test('activity is viewable without granting dashboard player controls', () => {
  const access = resolveActivityCapabilities(memberWith(), {
    dashboardAccess: 'dj',
    djRoleId: 'dj-role',
  });
  assert.equal(access.canAccess, true);
  assert.equal(access.canView, true);
  assert.equal(access.canControlPlayer, false);
  assert.equal(access.canUpload, false);
});

test('activity respects the configured DJ policy even when viewable by everyone', () => {
  const access = resolveActivityCapabilities(memberWith(), {
    dashboardAccess: 'members',
    djRoleId: 'dj-role',
  });
  assert.equal(access.canAccess, true);
  assert.equal(access.canControlPlayer, false);
});

test('activity capabilities expose the configured volume limit', () => {
  const access = resolveActivityCapabilities(memberWith(), {
    dashboardAccess: 'members',
    djRoleId: null,
    maxVolume: 240,
  });
  assert.equal(access.maxVolume, 240);
});

test('default volume cannot exceed the configured maximum', () => {
  assert.deepEqual(
    normalizeVolumeConfig({ defaultVolume: 90, maxVolume: 40 }),
    { defaultVolume: 40, maxVolume: 40, autoplayMode: 'ai_assisted' },
  );
  assert.deepEqual(
    normalizeVolumeConfig({ defaultVolume: 300, maxVolume: 900 }),
    { defaultVolume: 100, maxVolume: 500, autoplayMode: 'ai_assisted' },
  );
});
