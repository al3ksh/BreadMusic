const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-library-command-'));

const discord = require('discord.js');
const library = require('../src/music/library');
const { createLibraryCommands } = require('../src/commands/domains/library');
const { CommandError } = require('../src/music/utils');
const { closeDatabases } = require('../src/state/sqliteStore');

test.after(() => {
  closeDatabases();
  fs.rmSync(process.env.BREAD_DATA_DIR, { recursive: true, force: true });
});

function track(title, identifier) {
  return {
    encoded: `enc-${identifier}`,
    info: { title, author: 'Bread Band', identifier, uri: `https://youtu.be/${identifier}`, duration: 200_000, sourceName: 'youtube' },
  };
}

function setup(userId) {
  const seeds = [];
  const player = {
    guildId: 'guild',
    playing: false,
    paused: false,
    queue: { current: track('Now', 'now'), tracks: [track('Next', 'next')], async add(tracks) { this.tracks.push(...tracks); } },
    async play() { this.playing = true; },
  };
  const context = {
    ...discord,
    CommandError,
    BRAND_COLORS: { primary: 0x6c65bd },
    formatDuration: (ms) => `${Math.round(ms / 1000)}s`,
    addManualSeed: (_guildId, seed) => seeds.push(seed.info.title),
    queuePersist: async () => {},
    ensureVoice: async () => ({ player, voiceChannelId: 'voice' }),
  };
  const commands = Object.fromEntries(createLibraryCommands(context).map((command) => [command.data.name, command]));
  const run = async (name, subcommand, options = {}) => {
    const replies = [];
    const interaction = {
      user: { id: userId, username: 'tester' },
      guildId: 'guild',
      client: { lavalink: { getPlayer: () => player } },
      options: {
        getSubcommand: () => subcommand,
        getString: (key) => options[key] ?? null,
        getBoolean: (key) => options[key] ?? null,
        getFocused: () => options.focused ?? '',
      },
      deferReply: async () => {},
      editReply: async (payload) => replies.push(payload),
      reply: async (payload) => replies.push(payload),
      respond: async (choices) => replies.push(choices),
    };
    const command = commands[name];
    await (subcommand === 'autocomplete' ? command.autocomplete(interaction) : command.execute(interaction));
    return replies.at(-1);
  };
  return { run, player, seeds };
}

test('/playlist save, add, list, autocomplete and delete', async () => {
  const { run } = setup('cmd-user-1');
  assert.match(await run('playlist', 'save', { name: 'Gym' }), /Saved \*\*2\*\* tracks to \*\*Gym\*\*/);
  assert.match(await run('playlist', 'add', { name: 'gym' }), /already in \*\*Gym\*\*/);
  assert.match(await run('playlist', 'add', { name: 'Chill' }), /Created \*\*Chill\*\*/);
  await assert.rejects(run('playlist', 'save', { name: 'GYM' }), /already have a playlist/);

  const listed = await run('playlist', 'list');
  assert.match(listed.embeds[0].data.description, /\*\*Gym\*\* - 2 tracks/);
  assert.deepEqual((await run('playlist', 'autocomplete', { focused: 'ch' })).map((choice) => choice.value), ['Chill']);

  assert.match((await run('playlist', 'delete', { name: 'chill' })).content, /Deleted \*\*Chill\*\*/);
  await assert.rejects(run('playlist', 'delete', { name: 'chill' }), /no playlist called/);
});

test('/playlist play and /liked queue saved tracks', async () => {
  const userId = 'cmd-user-2';
  const { run, player, seeds } = setup(userId);
  library.createPlaylist(userId, 'Road', [track('R1', 'r1'), track('R2', 'r2')]);
  const reply = await run('playlist', 'play', { name: 'road' });
  assert.equal(reply.embeds[0].data.description, '**Road**');
  assert.deepEqual(player.queue.tracks.slice(1).map((entry) => entry.encoded), ['enc-r1', 'enc-r2']);
  assert.deepEqual(seeds, ['R1', 'R2']);
  assert.equal(player.playing, true);

  await assert.rejects(run('liked', undefined), /not liked anything/);
  library.setLiked(userId, track('Fav', 'fav'), true);
  await run('liked', undefined, { shuffle: true });
  assert.equal(player.queue.tracks.at(-1).encoded, 'enc-fav');
});

test('/playlist share gives a code that /playlist import copies', async () => {
  const owner = setup('cmd-share-owner');
  const friend = setup('cmd-share-friend');
  library.createPlaylist('cmd-share-owner', 'Mix', [track('M1', 'm1'), track('M2', 'm2')]);
  await assert.rejects(owner.run('playlist', 'share', { name: 'nope' }), /no playlist called/);

  const shared = await owner.run('playlist', 'share', { name: 'mix' });
  const code = shared.content.match(/`([A-Z0-9]{8})`/)[1];
  assert.match((await owner.run('playlist', 'list')).embeds[0].data.description, new RegExp(`shared as \`${code}\``));

  assert.match((await friend.run('playlist', 'import', { url: code.toLowerCase() })).content, /Copied \*\*2\*\* tracks to \*\*Mix\*\*/);
  await assert.rejects(owner.run('playlist', 'import', { url: code }), /your own playlist/);

  assert.match((await owner.run('playlist', 'share', { name: 'Mix', stop: true })).content, /no longer shared/);
  await assert.rejects(friend.run('playlist', 'import', { url: code }), /No shared playlist/);
  await assert.rejects(friend.run('playlist', 'import', { url: 'not a link' }), /share code/);
});
