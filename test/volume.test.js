const test = require('node:test');
const assert = require('node:assert/strict');

const { eqPeakGain } = require('../src/music/eqResponse');
const { PEAK_CEILING, buildGainStage, setPlayerVolume, syncGainStage } = require('../src/music/volume');

function fakePlayer({ volume = 100, equalizerBands = [] } = {}) {
  const sent = [];
  const player = {
    volume,
    lavalinkVolume: Math.round(volume * 0.75),
    async setVolume(value) {
      this.volume = Math.round(value);
      this.lavalinkVolume = Math.round(this.volume * 0.75);
      sent.push({ volume: this.lavalinkVolume });
    },
    filterManager: {
      filters: { volume: false },
      data: { volume: 1 },
      equalizerBands,
      async applyPlayerFilters() {
        sent.push({ filters: structuredClone(this.data) });
      },
    },
  };
  return { player, sent };
}

test('the equalizer model matches lavaplayer: 0.25 doubles a band, nothing set is flat', () => {
  assert.equal(eqPeakGain([]), 1);
  assert.ok(Math.abs(eqPeakGain([{ band: 8, gain: 0.25 }]) - 2) < 0.01);
  assert.ok(eqPeakGain([{ band: 8, gain: -0.25 }]) <= 1.01);
});

test('volume up to unity with a flat EQ leaves the audio untouched', () => {
  assert.deepEqual(buildGainStage([], 100), { volume: 1, normalization: null });
  assert.deepEqual(buildGainStage([], 133), { volume: 1, normalization: null });
});

test('boosts past unity or from the EQ are paid for with headroom up front', () => {
  const loud = buildGainStage([], 200);
  assert.equal(loud.volume, 1.5);
  assert.ok(Math.abs(loud.normalization.maxAmplitude * 1.5 - PEAK_CEILING) < 0.001);

  const both = buildGainStage([{ band: 8, gain: 0.25 }], 200);
  assert.ok(both.normalization.maxAmplitude * 1.5 * 2 <= PEAK_CEILING + 0.01);
});

test('setPlayerVolume keeps Lavalink at unity and moves the rest into filters', async () => {
  const { player, sent } = fakePlayer();
  const target = await setPlayerVolume(player, 300);
  assert.equal(target, 300);
  assert.equal(player.volume, 300);
  assert.equal(player.lavalinkVolume, 100);
  assert.equal(sent[0].volume, 100);
  assert.equal(sent[1].filters.volume, 2.25);
  assert.ok(sent[1].filters.pluginFilters.normalization);
  assert.equal(player.filterManager.filters.volume, true);
});

test('quiet volume changes do not resend filters', async () => {
  const { player, sent } = fakePlayer();
  await setPlayerVolume(player, 60);
  await setPlayerVolume(player, 90);
  assert.equal(sent.filter((entry) => entry.filters).length, 0);
  assert.equal(player.lavalinkVolume, 68);
});

test('coming back down from a boost clears the limiter', async () => {
  const { player, sent } = fakePlayer();
  await setPlayerVolume(player, 250);
  await setPlayerVolume(player, 80);
  const last = sent.filter((entry) => entry.filters).at(-1).filters;
  assert.equal(last.volume, 1);
  assert.equal(last.pluginFilters.normalization, undefined);
});

test('syncGainStage catches a player created at a loud default volume', async () => {
  const { player, sent } = fakePlayer({ volume: 200 });
  await syncGainStage(player);
  await syncGainStage(player);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].filters.volume, 1.5);
});
