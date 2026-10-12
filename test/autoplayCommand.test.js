const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-autoplay-command-'));

const discord = require('discord.js');
const { createMusicControlCommands } = require('../src/commands/domains/musicControls');
const { dislikeTrack, getTrackFeedback, isAutoplayEnabled, setAutoplay } = require('../src/music/autoplay');
const { closeDatabases } = require('../src/state/sqliteStore');
const library = require('../src/music/library');
const userTaste = require('../src/music/autoplay/userTaste');

const baseContext = { ...discord, BRAND_COLORS: { secondary: '#213d7c' }, CommandError: class extends Error {} };

test.after(() => {
  closeDatabases();
  fs.rmSync(process.env.BREAD_DATA_DIR, { recursive: true, force: true });
});

function setup(guildId, { skipResult } = {}) {
  const current = {
    encoded: 'enc-midnight',
    info: {
      title: 'Midnight City',
      author: 'M83',
      identifier: 'dX3k_QDnzHE',
      uri: 'https://www.youtube.com/watch?v=dX3k_QDnzHE',
      duration: 240_000,
      sourceName: 'youtube',
    },
  };
  const player = { guildId, queue: { current, tracks: [] } };
  const calls = [];
  const command = createMusicControlCommands({
    ...baseContext,
    ensurePlayer: async () => ({ player, config: {} }),
    assertDJ: () => calls.push('assertDJ'),
    withGuildMutex: (_id, task) => task(),
    handleSkipRequest: async () => {
      calls.push('skip');
      return skipResult ?? { skipped: true };
    },
    queuePersist: async () => {},
    toggleAutoplay: (id) => {
      setAutoplay(id, !isAutoplayEnabled(id));
      return isAutoplayEnabled(id);
    },
  }).find((entry) => entry.data.name === 'autoplay');

  const run = async (subcommand, flags = {}) => {
    const replies = [];
    await command.execute({
      guildId,
      user: { id: 'listener-1' },
      client: { musicUI: { refresh: async () => calls.push('refresh') } },
      options: { getSubcommand: () => subcommand, getBoolean: (name) => flags[name] ?? null },
      deferReply: async () => {},
      editReply: async (reply) => replies.push(reply),
    });
    return replies.at(-1);
  };
  return { run, calls, current };
}

test('/autoplay offers toggle, like, dislike, next and disliked', () => {
  const { data } = createMusicControlCommands(baseContext).find((entry) => entry.data.name === 'autoplay');
  assert.deepEqual(data.toJSON().options.map((option) => option.name), ['toggle', 'like', 'dislike', 'next', 'disliked']);
});

test('/autoplay like toggles the like on the current track for any listener', async () => {
  const guildId = 'command-like';
  const { run, calls, current } = setup(guildId);
  assert.match(await run('like'), /Liked \*\*Midnight City\*\*\. Autoplay will pick more like it/);
  assert.equal(getTrackFeedback('listener-1', current), 'like');
  // The autoplay like only steers autoplay; the library stays untouched.
  assert.equal(library.isLiked('listener-1', current), false);
  assert.match(await run('like'), /Removed your like/);
  assert.equal(getTrackFeedback('listener-1', current), null);
  assert.equal(library.isLiked('listener-1', current), false);
  assert.ok(!calls.includes('assertDJ'));
  assert.ok(calls.includes('refresh'));
});

test('/autoplay dislike records the dislike and keeps the track playing', async () => {
  const { run, calls, current } = setup('command-dislike');
  assert.match(await run('dislike'), /Disliked \*\*Midnight City\*\*\. Autoplay will steer clear of it/);
  assert.equal(getTrackFeedback('listener-1', current), 'dislike');
  assert.ok(!calls.includes('skip'));
});

test('a like and a dislike of the same track cancel each other out', async () => {
  const { run, current } = setup('command-exclusive');
  await run('like');
  await run('dislike');
  assert.equal(getTrackFeedback('listener-1', current), 'dislike');
  assert.equal(userTaste.listLikes('listener-1').length, 0);
  userTaste.removeDislike('listener-1', userTaste.listDislikes('listener-1').at(-1).key);
});

test('/autoplay dislike artist:true blocks the artist for that person', async () => {
  const { run } = setup('command-dislike-artist');
  assert.match(await run('dislike', { artist: true }), /Blocked \*\*M83\*\* for your autoplay\./);
  assert.deepEqual(userTaste.listBlockedArtists('listener-1').map((artist) => artist.author), ['M83']);
});

test('/autoplay next explains why it cannot reroll', async () => {
  const guildId = 'command-next';
  setAutoplay(guildId, false);
  const { run } = setup(guildId);
  assert.equal(await run('next'), 'Autoplay is off.');
});

test('/autoplay toggle stays DJ-only', async () => {
  const guildId = 'command-toggle';
  setAutoplay(guildId, false);
  const { run, calls } = setup(guildId);
  const reply = await run('toggle');
  assert.equal(reply.embeds[0].data.title, 'Autoplay Enabled');
  assert.deepEqual(calls, ['assertDJ']);
});

test('/autoplay disliked lists blocks and dislikes and undoes them from the menu', async () => {
  const userId = 'listener-disliked';
  const tracks = ['One', 'Two'].map((title) => ({
    encoded: `enc-${title}`,
    info: { title, author: 'Mogwai', identifier: `id-${title}`, uri: `https://youtu.be/${title}`, duration: 1000, sourceName: 'youtube' },
  }));
  dislikeTrack('command-disliked', userId, tracks[0]);
  dislikeTrack('command-disliked', 'someone-else', tracks[1]);

  const command = createMusicControlCommands(baseContext).find((entry) => entry.data.name === 'autoplay');
  let reply;
  await command.execute({
    guildId: 'command-disliked',
    user: { id: userId },
    options: { getSubcommand: () => 'disliked' },
    deferReply: async () => {},
    editReply: async (value) => { reply = value; },
  });
  assert.match(reply.embeds[0].data.description, /One/);
  assert.doesNotMatch(reply.embeds[0].data.description, /Two/);
  const menu = reply.components[0].components[0].toJSON();
  assert.equal(menu.custom_id, `autoplay:dislikes:${userId}`);
  const [option] = menu.options;
  assert.match(option.value, /^t:/);

  await assert.rejects(command.handleComponent({
    customId: menu.custom_id,
    user: { id: 'intruder' },
    values: [option.value],
    update: async () => {},
  }), /belongs to someone else/);

  await command.handleComponent({
    customId: menu.custom_id,
    user: { id: userId },
    values: [option.value],
    update: async (value) => { reply = value; },
  });
  assert.match(reply.embeds[0].data.description, /Undid your dislike of \*\*One\*\*/);
  assert.equal(reply.components.length, 0);
  assert.equal(userTaste.getDislikes(userId).tracks.length, 0);
});
