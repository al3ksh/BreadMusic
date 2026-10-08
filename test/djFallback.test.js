const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { canActAsDJ, assertDJ } = require('../src/state/guildConfig');
const { resolveActivityCapabilities } = require('../src/dashboard/access');

const config = { djRoleId: 'dj-role', openWithoutDJ: true };

function createGuild() {
  const botChannel = { id: 'vc-bot', members: new Collection() };
  const guild = { members: { me: { voice: { channel: botChannel } } } };
  return { guild, botChannel };
}

function createMember(guild, id, { channel = null, dj = false } = {}) {
  const member = {
    id,
    guild,
    user: { id, bot: false },
    voice: { channelId: channel?.id ?? null, channel },
    roles: { cache: { has: (roleId) => dj && roleId === 'dj-role' } },
    permissions: { has: () => false },
  };
  channel?.members.set(id, member);
  return member;
}

test('anyone can act as DJ when no DJ role is configured', () => {
  const { guild } = createGuild();
  assert.equal(canActAsDJ(createMember(guild, 'a'), { djRoleId: null }), true);
});

test('listeners act as DJ while no DJ is in the bot channel', () => {
  const { guild, botChannel } = createGuild();
  const alice = createMember(guild, 'alice', { channel: botChannel });
  createMember(guild, 'bob', { channel: botChannel });
  assert.equal(canActAsDJ(alice, config), true);
  assert.doesNotThrow(() => assertDJ({ member: alice }, config));
});

test('a DJ in the bot channel takes the controls back', () => {
  const { guild, botChannel } = createGuild();
  const alice = createMember(guild, 'alice', { channel: botChannel });
  const dj = createMember(guild, 'dj', { channel: botChannel, dj: true });
  assert.equal(canActAsDJ(alice, config), false);
  assert.equal(canActAsDJ(dj, config), true);
  assert.throws(() => assertDJ({ member: alice }, config), /A DJ is listening/);
});

test('the fallback needs the member in the bot channel and can be turned off', () => {
  const { guild, botChannel } = createGuild();
  const elsewhere = createMember(guild, 'carol', { channel: { id: 'vc-other', members: new Collection() } });
  assert.equal(canActAsDJ(elsewhere, config), false);

  const alice = createMember(guild, 'alice', { channel: botChannel });
  assert.equal(canActAsDJ(alice, { ...config, openWithoutDJ: false }), false);

  const { guild: idleGuild } = createGuild();
  idleGuild.members.me.voice.channel = null;
  assert.equal(canActAsDJ(createMember(idleGuild, 'dave', { channel: botChannel }), config), false);
});

test('the Activity DJ policy opens up while no DJ is listening', () => {
  const member = { permissions: { has: () => false }, roles: { cache: { has: () => false } } };
  const policy = { ...config, activityControl: 'dj' };
  const voice = { memberVoiceChannelId: 'vc-1', botVoiceChannelId: 'vc-1' };

  assert.equal(resolveActivityCapabilities(member, policy, { ...voice, djListening: false }).canControlPlayer, true);
  assert.equal(resolveActivityCapabilities(member, policy, { ...voice, djListening: true }).canControlPlayer, false);
  assert.equal(resolveActivityCapabilities(member, { ...policy, openWithoutDJ: false }, { ...voice, djListening: false }).canControlPlayer, false);
  assert.equal(resolveActivityCapabilities(member, { ...policy, activityControl: 'admin' }, { ...voice, djListening: false }).canControlPlayer, false);
  assert.equal(resolveActivityCapabilities(member, policy, { memberVoiceChannelId: 'vc-2', botVoiceChannelId: 'vc-1', djListening: false }).canControlPlayer, false);
  assert.equal(resolveActivityCapabilities(member, { ...config, dashboardAccess: 'members' }, { ...voice, djListening: false }).canControlPlayer, true);
});
