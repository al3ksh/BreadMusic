const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-music-buttons-'));
const originalDbPath = process.env.BREAD_DB_PATH;
process.env.BREAD_DB_PATH = path.join(tempDir, 'bread.sqlite');

const { closeDatabases } = require('../src/state/sqliteStore');
const { setConfig } = require('../src/state/guildConfig');
const { createMusicButtons } = require('../src/music/buttons');

let guildCounter = 0;

function makeTrack(id, title = `Song ${id}`) {
  return {
    encoded: `encoded-${id}`,
    info: { identifier: `${id}abcdefghij`.slice(0, 11), title, author: 'Artist', sourceName: 'youtube', duration: 180000, uri: `https://youtu.be/${id}` },
  };
}

function setup({ tracks = [], previous = [], repeatMode = 'off', memberChannel = 'voice', paused = false } = {}) {
  guildCounter += 1;
  const guildId = `music-guild-${guildCounter}`;
  const calls = [];
  const player = {
    guildId,
    voiceChannelId: 'voice',
    textChannelId: 'text',
    paused,
    repeatMode,
    position: 0,
    queue: {
      current: makeTrack('current', 'Current'),
      tracks: [...tracks],
      previous: [...previous],
      async shiftPrevious() { return this.previous.shift() ?? null; },
      async add(track, index) { calls.push(['add', track.info.title, index]); this.tracks.splice(index ?? this.tracks.length, 0, track); },
      async shuffle() { calls.push(['shuffle']); },
    },
    async pause() { calls.push(['pause']); this.paused = true; },
    async resume() { calls.push(['resume']); this.paused = false; },
    async play(options) { calls.push(['play', options.clientTrack.info.title, options.startTime]); },
    async setRepeatMode(mode) { this.repeatMode = mode; },
    async stopPlaying() { calls.push(['stopPlaying']); },
    async destroy() { calls.push(['destroy']); },
  };
  const client = {
    lavalink: { useable: true, getPlayer: (id) => (id === guildId ? player : undefined) },
    musicUI: {
      refresh: async () => { calls.push(['refresh']); },
      clear: async (id) => { calls.push(['clear', id]); },
    },
    lyricsUI: { send: async (_interaction, _player, track) => { calls.push(['lyrics', track.info.title]); } },
  };
  const broadcasts = [];
  const buttons = createMusicButtons({ client, broadcastPlayerUpdate: (id) => broadcasts.push(id) });

  function interaction(customId, { userId = 'listener', channelId = memberChannel } = {}) {
    const replies = [];
    const record = (name) => async (payload) => { replies.push({ name, payload }); };
    return {
      replies,
      customId,
      guildId,
      channelId: 'text',
      client,
      user: { id: userId },
      guild: { channels: { cache: new Map() }, members: { me: { voice: { channel: null } } } },
      member: {
        id: userId,
        voice: { channelId },
        roles: { cache: { has: () => false } },
        permissions: { has: () => false },
        guild: { members: { me: { voice: { channel: null } } } },
      },
      reply: record('reply'),
      update: record('update'),
      deferUpdate: record('deferUpdate'),
      deferReply: record('deferReply'),
      followUp: record('followUp'),
      editReply: record('editReply'),
      launchActivity: record('launchActivity'),
    };
  }

  return { guildId, player, client, calls, broadcasts, buttons, interaction };
}

const press = (ctx, action, options) => {
  const event = ctx.interaction(`music:${action}:${ctx.guildId}`, options);
  return ctx.buttons.handleMusicButton(event).then(() => event);
};

test.after(() => {
  closeDatabases();
  if (originalDbPath === undefined) delete process.env.BREAD_DB_PATH;
  else process.env.BREAD_DB_PATH = originalDbPath;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('player buttons from another guild are refused', async () => {
  const ctx = setup();
  const event = ctx.interaction('music:skip:some-other-guild');
  await ctx.buttons.handleMusicButton(event);
  assert.equal(event.replies[0].payload.content, 'Invalid button.');
  assert.deepEqual(ctx.calls, []);
});

test('play/pause toggles the player and refreshes the panel', async () => {
  const ctx = setup();
  await press(ctx, 'playpause');
  assert.equal(ctx.player.paused, true);
  await press(ctx, 'playpause');
  assert.equal(ctx.player.paused, false);
  assert.deepEqual(ctx.calls, [['pause'], ['refresh'], ['resume'], ['refresh']]);
});

test('player buttons require the listener to share the bot voice channel', async () => {
  const ctx = setup({ memberChannel: 'other-voice' });
  await assert.rejects(press(ctx, 'playpause'), /same voice channel/);
  await assert.rejects(press(ctx, 'stop', { channelId: null }), /must be in a voice channel/);
  assert.deepEqual(ctx.calls, []);
});

test('DJ-only buttons stay locked for listeners when the server requires a DJ', async () => {
  const ctx = setup();
  setConfig(ctx.guildId, { djRoleId: 'dj-role', openWithoutDJ: false });
  await assert.rejects(press(ctx, 'stop'), /requires the DJ role/);
  await assert.rejects(press(ctx, 'loop'), /requires the DJ role/);
  assert.deepEqual(ctx.calls, []);
});

test('loop cycles off, track, queue and back to off', async () => {
  const ctx = setup();
  const modes = [];
  for (let i = 0; i < 3; i += 1) {
    await press(ctx, 'loop');
    modes.push(ctx.player.repeatMode);
  }
  assert.deepEqual(modes, ['track', 'queue', 'off']);
});

test('shuffle explains an empty queue instead of shuffling', async () => {
  const empty = setup();
  const event = await press(empty, 'shuffle');
  assert.match(event.replies.at(-1).payload.content, /No tracks to shuffle/);
  assert.deepEqual(empty.calls, []);

  const full = setup({ tracks: [makeTrack('a'), makeTrack('b')] });
  await press(full, 'shuffle');
  assert.deepEqual(full.calls, [['shuffle'], ['refresh']]);
});

test('back plays the previous track and puts the current one first in the queue', async () => {
  const ctx = setup({ previous: [makeTrack('prev', 'Previous')] });
  await press(ctx, 'back');
  assert.deepEqual(ctx.calls, [['add', 'Current', 0], ['play', 'Previous', undefined], ['refresh']]);

  const none = setup();
  const event = await press(none, 'back');
  assert.match(event.replies.at(-1).payload.content, /No previous track/);
});

test('skip and back restart the song while it is looping', async () => {
  const ctx = setup({ repeatMode: 'track', tracks: [makeTrack('next')] });
  await press(ctx, 'skip');
  await press(ctx, 'back');
  assert.deepEqual(ctx.calls, [['play', 'Current', 0], ['refresh'], ['play', 'Current', 0], ['refresh']]);
  assert.equal(ctx.player.queue.tracks.length, 1, 'the queue is untouched');
});

test('stop empties the queue, destroys the player and clears the panel', async () => {
  const ctx = setup({ tracks: [makeTrack('a'), makeTrack('b')] });
  await press(ctx, 'stop');
  assert.equal(ctx.player.queue.tracks.length, 0);
  assert.deepEqual(ctx.calls, [['stopPlaying'], ['destroy'], ['clear', ctx.guildId]]);
});

test('the heart saves to the listener library and a second press removes it', async () => {
  const ctx = setup();
  const saved = await press(ctx, 'heart', { userId: 'heart-user' });
  assert.match(saved.replies[0].payload.content, /Saved \*\*Current\*\*/);
  const removed = await press(ctx, 'heart', { userId: 'heart-user' });
  assert.match(removed.replies[0].payload.content, /Removed \*\*Current\*\*/);
  assert.equal(ctx.broadcasts.length, 2);
});

test('a second dislike takes the first one back', async () => {
  const ctx = setup();
  const first = await press(ctx, 'dislike', { userId: 'dislike-user' });
  assert.match(first.replies[0].payload.content, /Disliked/);
  const second = await press(ctx, 'dislike', { userId: 'dislike-user' });
  assert.match(second.replies[0].payload.content, /Removed your dislike/);
});

test('lyrics hand the current track to the lyrics panel', async () => {
  const ctx = setup();
  await press(ctx, 'lyrics');
  assert.deepEqual(ctx.calls, [['lyrics', 'Current']]);
});

test('queue pages only turn for the person who opened the queue', async () => {
  const ctx = setup({ tracks: Array.from({ length: 25 }, (_, i) => makeTrack(`q${i}`)) });
  const stranger = ctx.interaction(`queue:next:${ctx.guildId}:0:owner`, { userId: 'someone-else' });
  await ctx.buttons.handleQueueButton(stranger);
  assert.match(stranger.replies[0].payload.content, /Only the author/);

  const owner = ctx.interaction(`queue:next:${ctx.guildId}:0:owner`, { userId: 'owner' });
  await ctx.buttons.handleQueueButton(owner);
  assert.equal(owner.replies[0].name, 'update');
  assert.ok(owner.replies[0].payload.embeds.length > 0);
});

test('a vote-skip button for a track that already ended is refused', async () => {
  const ctx = setup();
  const event = ctx.interaction(`voteskip:${ctx.guildId}:stale-token`);
  ctx.client.lavalink.getPlayer = () => ctx.player;
  await ctx.buttons.handleVoteSkipButton(event);
  assert.match(event.replies[0].payload.content, /no longer playing/);

  const wrongGuild = ctx.interaction('voteskip:another-guild:token');
  await ctx.buttons.handleVoteSkipButton(wrongGuild);
  assert.match(wrongGuild.replies[0].payload.content, /no longer valid/);
});
