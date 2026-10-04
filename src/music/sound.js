// One source of truth for what the player sounds like: a preset, six EQ bands, speed and pitch.
// Every change rebuilds the whole Lavalink filter payload from this state, so presets never
// stack on top of each other and the dashboard, Activity and /filter always agree.

const BAND_COUNT = 15;
const EQ_RANGE_DB = 6;
const TEMPO_MIN = 0.5;
const TEMPO_MAX = 2;

// Lavalink bands: 25, 40, 63, 100, 160, 250, 400, 630, 1k, 1.6k, 2.5k, 4k, 6.3k, 10k, 16k Hz.
const EQ_GROUPS = [
  { id: 'sub', label: 'Sub', bands: [0, 1] },
  { id: 'bass', label: 'Bass', bands: [2, 3, 4] },
  { id: 'lowmid', label: 'Low-mid', bands: [5, 6] },
  { id: 'mid', label: 'Mid', bands: [7, 8, 9] },
  { id: 'presence', label: 'Presence', bands: [10, 11, 12] },
  { id: 'air', label: 'Air', bands: [13, 14] },
];

const SOUND_PRESETS = {
  bassboost: {
    label: 'Bassboost',
    description: 'Deep, punchy bass boost.',
    eq: [0.15, 0.2, 0.18, 0.12, 0.06, 0, -0.03, -0.03, 0, 0, 0.03, 0.03, 0, 0, 0],
  },
  nightcore: {
    label: 'Nightcore',
    description: 'Faster tempo (1.25x) + higher pitch.',
    timescale: { speed: 1.25, pitch: 1.2, rate: 1 },
  },
  vaporwave: {
    label: 'Vaporwave',
    description: 'Slower tempo (0.85x) + lower pitch.',
    timescale: { speed: 0.85, pitch: 0.8, rate: 1 },
  },
  soft: {
    label: 'Soft',
    description: 'Warm EQ with enhanced mids for vocals.',
    eq: [0.625, 0.275, 0.2625, 0.25, 0.25, 0.2375, 0.225, 0.2325, 0.25, 0.25, 0.2625, 0.275, 0.625, 0.375, 0.375],
  },
  karaoke: {
    label: 'Karaoke',
    description: 'Reduces center vocals (mono channel).',
    karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 },
  },
  '8d': {
    label: '8D Audio',
    description: 'Rotating stereo panning effect.',
    rotation: { rotationHz: 0.15 },
  },
  vibrato: {
    label: 'Vibrato',
    description: 'Pitch modulation (retro/synth vibe).',
    vibrato: { frequency: 8, depth: 1 },
  },
  tremolo: {
    label: 'Tremolo',
    description: 'Volume modulation (pulsating effect).',
    tremolo: { frequency: 4, depth: 0.6 },
  },
  radio: {
    label: 'Radio',
    description: 'Lo-fi radio/telephone effect.',
    eq: [-0.25, -0.2, -0.15, -0.1, 0, 0.1, 0.15, 0.2, 0.15, 0.1, 0, -0.1, -0.15, -0.2, -0.25],
    lowPass: { smoothing: 15 },
  },
};

const SOUND_PRESET_CHOICES = Object.entries(SOUND_PRESETS).map(([value, { label, description }]) => ({
  value,
  label,
  description,
}));

const NEUTRAL_FILTERS = {
  timescale: { speed: 1, pitch: 1, rate: 1 },
  rotation: { rotationHz: 0 },
  vibrato: { frequency: 0, depth: 0 },
  tremolo: { frequency: 0, depth: 0 },
  karaoke: { level: 0, monoLevel: 0, filterBand: 0, filterWidth: 0 },
  lowPass: { smoothing: 0 },
};

function defaultSoundState() {
  return { preset: null, eq: EQ_GROUPS.map(() => 0), speed: 1, pitch: 1 };
}

function clampStep(value, min, max, step, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return Math.round(Math.round(clamped / step) * step * 1000) / 1000;
}

function normalizePreset(preset) {
  if (typeof preset !== 'string') return null;
  const key = preset.trim().toLowerCase();
  return Object.hasOwn(SOUND_PRESETS, key) ? key : null;
}

function normalizeSoundState(input = {}, base = defaultSoundState()) {
  const source = input && typeof input === 'object' ? input : {};
  const eqInput = Array.isArray(source.eq) ? source.eq : base.eq;
  return {
    preset: 'preset' in source ? normalizePreset(source.preset) : normalizePreset(base.preset),
    eq: EQ_GROUPS.map((_, index) => clampStep(eqInput[index], -EQ_RANGE_DB, EQ_RANGE_DB, 0.5, 0)),
    speed: clampStep(source.speed ?? base.speed, TEMPO_MIN, TEMPO_MAX, 0.05, 1),
    pitch: clampStep(source.pitch ?? base.pitch, TEMPO_MIN, TEMPO_MAX, 0.05, 1),
  };
}

function isDefaultSound(state) {
  return !state.preset && state.speed === 1 && state.pitch === 1 && state.eq.every((value) => value === 0);
}

// Boosts follow the dB curve (+6 dB ≈ gain 1.0); cuts are linear down to Lavalink's -0.25 floor.
function sliderToGain(db) {
  if (db >= 0) return 10 ** (db / 20) - 1;
  return (db / EQ_RANGE_DB) * 0.25;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildEqualizer(state) {
  const preset = SOUND_PRESETS[state.preset] || {};
  const gains = Array.from({ length: BAND_COUNT }, (_, band) => preset.eq?.[band] ?? 0);
  EQ_GROUPS.forEach((group, index) => {
    const gain = sliderToGain(state.eq[index] || 0);
    for (const band of group.bands) gains[band] += gain;
  });
  if (gains.every((gain) => Math.abs(gain) < 1e-6)) return [];
  return gains.map((gain, band) => ({ band, gain: round(Math.min(1, Math.max(-0.25, gain))) }));
}

function buildFilterData(input) {
  const state = normalizeSoundState(input);
  const preset = SOUND_PRESETS[state.preset] || {};
  const timescale = preset.timescale || NEUTRAL_FILTERS.timescale;
  const data = {};
  for (const [key, neutral] of Object.entries(NEUTRAL_FILTERS)) {
    data[key] = { ...(preset[key] || neutral) };
  }
  data.timescale = {
    speed: round(timescale.speed * state.speed),
    pitch: round(timescale.pitch * state.pitch),
    rate: timescale.rate ?? 1,
  };
  return { state, data, equalizer: buildEqualizer(state) };
}

function getSoundState(player) {
  const manager = player?.filterManager;
  if (manager?.soundState) return normalizeSoundState(manager.soundState);
  return normalizeSoundState({ preset: manager?.activePreset || null });
}

// Writes the whole filter payload in one request instead of calling the toggle helpers,
// which each send their own update and only know how to add to whatever is already on.
async function applySound(player, input) {
  const manager = player.filterManager;
  const { state, data, equalizer } = buildFilterData(input);
  manager.filters.nightcore = false;
  manager.filters.vaporwave = false;
  manager.data = { ...manager.data, ...data };
  manager.equalizerBands = equalizer;
  await manager.applyPlayerFilters();
  manager.soundState = state;
  manager.activePreset = state.preset;
  return state;
}

function resetSound(player) {
  return applySound(player, defaultSoundState());
}

module.exports = {
  EQ_GROUPS,
  EQ_RANGE_DB,
  SOUND_PRESETS,
  SOUND_PRESET_CHOICES,
  TEMPO_MAX,
  TEMPO_MIN,
  applySound,
  buildFilterData,
  defaultSoundState,
  getSoundState,
  isDefaultSound,
  normalizePreset,
  normalizeSoundState,
  resetSound,
  sliderToGain,
};
