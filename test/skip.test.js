const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { handleSkipRequest, clearVoteSkip } = require('../src/music/skipManager');

function createMember(id, voiceChannel) {
  return {
    id,
    user: { id, bot: false },
    voice: { channel: voiceChannel },
    roles: { cache: { has: () => false } },
    permissions: { has: () => false },
  };
}

test('listener votes share one message and skip at the configured threshold', async () => {
  const guildId = 'skip-guild';
  const voiceChannel = { id: 'voice', members: new Collection() };
  const alice = createMember('alice', voiceChannel);
  const bob = createMember('bob', voiceChannel);
  const owner = createMember('owner', voiceChannel);
  voiceChannel.members.set(alice.id, alice).set(bob.id, bob).set(owner.id, owner);

  let sends = 0;
  let edits = 0;
  const message = {
    edit: async () => { edits += 1; },
    delete: async () => {},
  };
  const channel = {
    isTextBased: () => true,
    send: async () => { sends += 1; return message; },
  };
  const guild = { channels: { cache: new Map([['voice', voiceChannel]]) } };
  const player = {
    guildId,
    voiceChannelId: voiceChannel.id,
    textChannelId: null,
    position: 0,
    queue: {
      current: { info: { identifier: 'track-1', title: 'Track One' }, requester: { id: owner.id } },
      tracks: [{}],
    },
    skip: async () => { player.skipped = true; },
  };
  const notices = [];
  const client = {
    channels: { cache: new Map(), fetch: async () => null },
    emit: (event, payload) => notices.push({ event, payload }),
  };
  const config = { djRoleId: 'dj', voteSkipPercent: 0.6 };

  const first = await handleSkipRequest({ member: alice, user: alice.user, guild, channel }, player, config, client);
  assert.equal(first.skipped, false);
  assert.equal(first.vote.votes, 1);
  assert.equal(first.vote.requiredVotes, 2);
  assert.equal(sends, 1);

  const duplicate = await handleSkipRequest({ member: alice, user: alice.user, guild, channel }, player, config, client);
  assert.equal(duplicate.vote.votes, 1);
  assert.match(duplicate.message, /already counted/);
  assert.equal(sends, 1);

  const second = await handleSkipRequest({ member: bob, user: bob.user, guild, channel }, player, config, client);
  assert.equal(second.skipped, true);
  assert.equal(player.skipped, true);
  assert.equal(edits >= 2, true);
  assert.equal(notices[0].event, 'breadPlayerNotice');
  assert.match(notices[0].payload.message, /Vote passed/);
  await clearVoteSkip(guildId);
});
