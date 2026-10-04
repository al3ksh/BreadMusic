const test = require('node:test');
const assert = require('node:assert/strict');
const discord = require('discord.js');

const { createSoundCommands, adjustSound, eqBar } = require('../src/commands/domains/sound');
const { defaultSoundState } = require('../src/music/sound');

class CommandError extends Error {}

function setup() {
  const calls = [];
  const player = {
    guildId: 'g1',
    filterManager: {
      filters: {},
      data: {},
      equalizerBands: [],
      applyPlayerFilters: async () => calls.push('apply'),
    },
  };
  const [command] = createSoundCommands({
    ...discord,
    BRAND_COLORS: { primary: '#5a5494', secondary: '#213d7c' },
    CommandError,
    ensurePlayer: async () => ({ player, config: {} }),
    assertDJ: () => calls.push('assertDJ'),
    queuePersist: async () => calls.push('persist'),
  });
  const client = { musicUI: { refresh: async () => calls.push('refresh') } };
  const click = async (customId, values) => {
    let panel;
    await command.handleComponent({ guildId: 'g1', customId, values, client, update: async (value) => { panel = value; } });
    return panel;
  };
  return { command, player, calls, client, click };
}

const customIds = (panel) => panel.components.flatMap((row) => row.components.map((component) => component.toJSON().custom_id));

test('adjustSound moves one knob within range and centers it again', () => {
  let state = adjustSound(defaultSoundState(), 'bass', 1);
  assert.deepEqual(state.eq, [0, 1, 0, 0, 0, 0]);
  for (let i = 0; i < 10; i += 1) state = adjustSound(state, 'bass', 1);
  assert.equal(state.eq[1], 6);
  assert.equal(adjustSound(state, 'bass', null).eq[1], 0);
  assert.equal(adjustSound(defaultSoundState(), 'speed', -1).speed, 0.95);
  assert.equal(adjustSound(defaultSoundState(), 'pitch', null).pitch, 1);
});

test('eqBar draws cuts left and boosts right of the center line', () => {
  assert.equal(eqBar(0), '──────┃──────');
  assert.equal(eqBar(2), '──────┃██────');
  assert.equal(eqBar(-6), '██████┃──────');
});

test('/sound opens the panel and applies a preset passed as an option', async () => {
  const { command, player, calls, client } = setup();
  let panel;
  await command.execute({
    guildId: 'g1',
    client,
    options: { getString: () => 'nightcore', getBoolean: () => null },
    deferReply: async () => {},
    editReply: async (value) => { panel = value; },
  });
  assert.equal(player.filterManager.soundState.preset, 'nightcore');
  assert.deepEqual(calls, ['assertDJ', 'apply', 'persist', 'refresh']);
  assert.match(panel.embeds[0].data.description, /Preset: \*\*Nightcore\*\*/);
  assert.deepEqual(customIds(panel), ['sound:g1:preset:bass', 'sound:g1:knob', 'sound:g1:down:bass', 'sound:g1:up:bass', 'sound:g1:zero:bass', 'sound:g1:reset:bass']);
});

test('/sound panel buttons change the selected knob and reset everything', async () => {
  const { player, click } = setup();
  let panel = await click('sound:g1:knob', ['speed']);
  assert.ok(customIds(panel).includes('sound:g1:up:speed'));
  assert.equal(player.filterManager.soundState, undefined);

  panel = await click('sound:g1:up:speed');
  assert.equal(player.filterManager.soundState.speed, 1.05);
  assert.match(panel.embeds[0].data.description, /▶ Speed\s+1\.05x/);

  await click('sound:g1:up:mid');
  await click('sound:g1:preset:mid', ['vaporwave']);
  assert.deepEqual(player.filterManager.soundState, { preset: 'vaporwave', eq: [0, 0, 0, 1, 0, 0], speed: 1.05, pitch: 1 });

  await click('sound:g1:reset:mid');
  assert.deepEqual(player.filterManager.soundState, defaultSoundState());
});

test('/sound panel refuses clicks from another server', async () => {
  const { command } = setup();
  await assert.rejects(
    command.handleComponent({ guildId: 'other', customId: 'sound:g1:up:bass', update: async () => {} }),
    CommandError,
  );
});
