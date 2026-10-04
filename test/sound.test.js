const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applySound,
  buildFilterData,
  defaultSoundState,
  getSoundState,
  normalizeSoundState,
  sliderToGain,
} = require('../src/music/sound');

function fakePlayer() {
  const sent = [];
  const filterManager = {
    filters: { nightcore: true, vaporwave: false },
    data: { volume: 1, timescale: { speed: 1.25, pitch: 1.2, rate: 1 }, rotation: { rotationHz: 0.15 } },
    equalizerBands: [{ band: 0, gain: 0.5 }],
    async applyPlayerFilters() {
      sent.push({ data: structuredClone(this.data), equalizer: [...this.equalizerBands] });
    },
  };
  return { player: { filterManager }, sent };
}

test('normalizeSoundState clamps and snaps every field', () => {
  const state = normalizeSoundState({ preset: 'NIGHTCORE', eq: [9, -9, 1.26, 'x'], speed: 3, pitch: 0.12 });
  assert.deepEqual(state, { preset: 'nightcore', eq: [6, -6, 1.5, 0, 0, 0], speed: 2, pitch: 0.5 });
  assert.equal(normalizeSoundState({ preset: 'nope' }).preset, null);
  assert.equal(normalizeSoundState({ speed: 1.234 }).speed, 1.25);
});

test('slider gains follow a dB curve for boosts and a linear cut', () => {
  assert.ok(Math.abs(sliderToGain(6) - 0.9953) < 0.001);
  assert.equal(sliderToGain(0), 0);
  assert.equal(sliderToGain(-6), -0.25);
  assert.equal(sliderToGain(-3), -0.125);
});

test('the default state produces neutral filters and no equalizer', () => {
  const { data, equalizer } = buildFilterData(defaultSoundState());
  assert.deepEqual(equalizer, []);
  assert.deepEqual(data.timescale, { speed: 1, pitch: 1, rate: 1 });
  assert.equal(data.rotation.rotationHz, 0);
  assert.equal(data.karaoke.level, 0);
  assert.equal(data.lowPass.smoothing, 0);
});

test('EQ sliders add onto the preset curve and stay inside Lavalink limits', () => {
  const { equalizer } = buildFilterData({ preset: 'bassboost', eq: [6, 0, 0, 0, 0, -6] });
  assert.equal(equalizer.length, 15);
  assert.equal(equalizer[0].gain, 1);
  assert.equal(equalizer[2].gain, 0.18);
  assert.equal(equalizer[14].gain, -0.25);
});

test('speed and pitch multiply the preset timescale', () => {
  const { data } = buildFilterData({ preset: 'nightcore', speed: 0.8, pitch: 1 });
  assert.deepEqual(data.timescale, { speed: 1, pitch: 1.2, rate: 1 });
});

test('applySound replaces the previous preset in one request', async () => {
  const { player, sent } = fakePlayer();
  const state = await applySound(player, { preset: 'radio', eq: [0, 0, 0, 0, 0, 0] });
  assert.equal(sent.length, 1);
  const [{ data, equalizer }] = sent;
  assert.deepEqual(data.timescale, { speed: 1, pitch: 1, rate: 1 });
  assert.equal(data.rotation.rotationHz, 0);
  assert.equal(data.lowPass.smoothing, 15);
  assert.equal(data.volume, 1);
  assert.equal(equalizer[0].gain, -0.25);
  assert.equal(player.filterManager.filters.nightcore, false);
  assert.equal(player.filterManager.activePreset, 'radio');
  assert.deepEqual(getSoundState(player), state);
});

test('getSoundState falls back to the legacy active preset', () => {
  const player = { filterManager: { activePreset: '8d' } };
  assert.equal(getSoundState(player).preset, '8d');
  assert.deepEqual(getSoundState({}), defaultSoundState());
});
