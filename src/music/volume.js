// @ts-check
// Keeps loud settings clean. Lavalink applies the player volume after every filter and clips
// anything above 100, and the equalizer clips its own output, so neither may push past full
// scale. Instead the player volume stops at unity, the rest of the boost moves into the volume
// filter, and the LavaDSPX normalization filter (first in the chain) pulls peaks down by exactly
// as much as the equalizer and the boost will add back.

const { eqPeakGain } = require('./eqResponse');

const VOLUME_DECREMENTER = 0.75;
// The player volume that reaches Lavalink as 100, i.e. no gain at all.
const UNITY_VOLUME = 100 / VOLUME_DECREMENTER;
// Room left under full scale for the filters between the limiter and the output.
const PEAK_CEILING = 0.97;

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function volumeOf(player) {
  return Number.isFinite(player?.volume) ? player.volume : 100;
}

/**
 * @param {Array<{ band: number, gain: number }>} equalizer
 * @param {number} volume
 */
function buildGainStage(equalizer, volume) {
  const boost = Math.max(1, volume / UNITY_VOLUME);
  const needed = eqPeakGain(equalizer) * boost;
  return {
    volume: round(boost),
    normalization: needed > 1.001 ? { maxAmplitude: round(PEAK_CEILING / needed), adaptive: true } : null,
  };
}

function writeGainStage(manager, stage) {
  manager.data = manager.data ?? {};
  manager.data.volume = stage.volume;
  if (manager.filters) manager.filters.volume = stage.volume !== 1;
  const pluginFilters = { ...(manager.data.pluginFilters || {}) };
  if (stage.normalization) pluginFilters.normalization = stage.normalization;
  else delete pluginFilters.normalization;
  manager.data.pluginFilters = pluginFilters;
  manager.gainStage = stage;
}

function sameStage(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const NEUTRAL_STAGE = { volume: 1, normalization: null };

// Resends the filters only when the gain stage actually moved, since every filter update
// rebuilds Lavalink's chain.
async function syncGainStage(player) {
  const manager = player?.filterManager;
  if (!manager) return;
  const stage = buildGainStage(manager.equalizerBands || [], volumeOf(player));
  if (sameStage(stage, manager.gainStage ?? NEUTRAL_STAGE)) return;
  writeGainStage(manager, stage);
  await manager.applyPlayerFilters();
}

// lavalink-client sends player.volume * decrementer; above unity that would clip.
function capLavalinkVolume(player) {
  if (!player) return;
  player.lavalinkVolume = Math.min(100, Math.round(volumeOf(player) * VOLUME_DECREMENTER));
}

/**
 * Sets the volume users see while Lavalink itself never goes above unity.
 * @param {any} player
 * @param {number} volume
 */
async function setPlayerVolume(player, volume) {
  const target = Math.round(Math.max(0, Math.min(1000, Number(volume) || 0)));
  await player.setVolume(Math.min(target, UNITY_VOLUME));
  player.volume = target;
  capLavalinkVolume(player);
  await syncGainStage(player);
  return target;
}

module.exports = {
  PEAK_CEILING,
  UNITY_VOLUME,
  VOLUME_DECREMENTER,
  buildGainStage,
  capLavalinkVolume,
  setPlayerVolume,
  syncGainStage,
  volumeOf,
  writeGainStage,
};
