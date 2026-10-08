const test = require('node:test');
const assert = require('node:assert/strict');
const discord = require('discord.js');

const { createHistoryCommands, PAGE_SIZE } = require('../src/commands/domains/history');

class CommandError extends Error {}

function makeHistory(count) {
  const events = Array.from({ length: count }, (_, index) => ({
    id: `e${index}`,
    playedAt: 1_700_000_000_000 - index * 60_000,
    autoplay: index === 1,
    track: { title: `Song ${index + 1}`, author: 'Band', uri: index === 2 ? '' : `https://youtu.be/s${index + 1}` },
  }));
  return (guildId, { page = 0, limit = 30 } = {}) => ({
    items: events.slice(page * limit, page * limit + limit),
    page,
    limit,
    total: events.length,
    totalPages: Math.max(1, Math.ceil(events.length / limit)),
  });
}

function setup(count = 12) {
  const calls = [];
  const queue = { tracks: [{ isAutoplay: true }], add: async () => calls.push('add') };
  const player = {
    guildId: 'g1',
    playing: true,
    paused: false,
    queue,
    search: async (query) => {
      calls.push(['search', query]);
      return { tracks: [{ info: { title: 'Song 4' } }] };
    },
    play: async () => calls.push('play'),
  };
  const [command] = createHistoryCommands({
    ...discord,
    BRAND_COLORS: { secondary: '#213d7c' },
    CommandError,
    history: makeHistory(count),
    ensureVoice: async () => ({ player, voiceChannelId: 'v1' }),
    addManualSeed: () => calls.push('seed'),
    buildTrackEmbed: (track) => new discord.EmbedBuilder().setTitle(track.info.title),
    classifyPlaybackError: () => ({ title: 'x', description: 'y' }),
    queuePersist: async () => calls.push('persist'),
  });
  return { command, calls, player };
}

test('/history shows the latest page with a queue-again menu and paging', async () => {
  const { command } = setup();
  let reply;
  await command.execute({ guildId: 'g1', reply: async (value) => { reply = value; } });
  const lines = reply.embeds[0].data.description.split('\n');
  assert.equal(lines.length, PAGE_SIZE);
  assert.match(lines[0], /^`1\.` \*\*Song 1\*\* — Band · <t:\d+:R>$/);
  assert.match(lines[1], /🤖$/);
  const menu = reply.components[0].components[0].toJSON();
  assert.equal(menu.custom_id, 'history:g1:play:0');
  assert.equal(menu.options.length, PAGE_SIZE - 1, 'entries without a link cannot be queued');
  const [newer, older] = reply.components[1].components.map((button) => button.toJSON());
  assert.equal(newer.disabled, true);
  assert.equal(older.custom_id, 'history:g1:page:1');
});

test('/history paging and queue again', async () => {
  const { command, calls, player } = setup();
  let panel;
  await command.handleComponent({ guildId: 'g1', customId: 'history:g1:page:1', update: async (value) => { panel = value; } });
  assert.match(panel.embeds[0].data.description, /^`11\.` \*\*Song 11\*\*/);

  let reply;
  await command.handleComponent({
    guildId: 'g1',
    customId: 'history:g1:play:0',
    values: [String(1_700_000_000_000 - 3 * 60_000)],
    user: { id: 'u1' },
    deferReply: async () => {},
    editReply: async (value) => { reply = value; },
  });
  assert.deepEqual(calls, [['search', 'https://youtu.be/s4'], 'seed', 'persist']);
  assert.equal(player.queue.tracks[0].info.title, 'Song 4', 'goes in front of autoplay picks');
  assert.equal(reply.embeds[0].data.title, 'Song 4');

  await assert.rejects(command.handleComponent({
    guildId: 'g1',
    customId: 'history:g1:play:0',
    values: ['123'],
    deferReply: async () => {},
  }), /no longer in the history/);
});
