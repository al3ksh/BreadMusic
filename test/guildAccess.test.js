const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAccessDeniedMessage,
  createGuildAccessPolicy,
  isGuildAllowed,
} = require('../src/access/guildAccess');

test('public mode allows every guild', () => {
  const policy = createGuildAccessPolicy({ GUILD_ACCESS_MODE: 'public' });
  assert.equal(isGuildAllowed(policy, '123'), true);
});

test('allowlist mode admits only configured guild IDs', () => {
  const policy = createGuildAccessPolicy({
    GUILD_ACCESS_MODE: 'allowlist',
    ALLOWED_GUILD_IDS: '123, 456, invalid',
  });
  assert.equal(isGuildAllowed(policy, '123'), true);
  assert.equal(isGuildAllowed(policy, '456'), true);
  assert.equal(isGuildAllowed(policy, '789'), false);
});

test('empty allowlist is fail-safe and denies guilds', () => {
  const policy = createGuildAccessPolicy({
    GUILD_ACCESS_MODE: 'allowlist',
    ALLOWED_GUILD_IDS: '',
  });
  assert.equal(isGuildAllowed(policy, '123'), false);
});

test('denial message includes configured contact', () => {
  const policy = createGuildAccessPolicy({
    GUILD_ACCESS_MODE: 'allowlist',
    PRIVATE_ACCESS_CONTACT: 'aleksh8',
  });
  assert.match(buildAccessDeniedMessage(policy), /aleksh8/);
});
