// Times of day the runner passes through. Every section of the song, where the tempo steps up,
// moves the clock on: a long run goes from midnight through sunrise and back into the night.

import { BEATS_PER_SECTION } from './engine';

export type Theme = {
  /** Six sky bands, from the top of the view down to the horizon. */
  sky: string[];
  stars: number;
  city: string;
  /** Share of city windows with a light on. */
  windows: number;
  windowCool: string;
  windowWarm: string;
  label: string;
  labelRing: string;
  /** Halo round the record once the sky is bright enough for it to stand in for the sun. */
  glow: string;
  glowStrength: number;
  bar: string;
  barTop: string;
  /** What lights up on the beat. */
  accent: string;
};

const NO_GLOW = { glow: '#000000', glowStrength: 0 };

export const THEMES: Theme[] = [
  {
    // Midnight
    sky: ['#0b0a13', '#0f0d1a', '#141122', '#19152c', '#201a38', '#2a2148'],
    stars: 1,
    city: '#120f20',
    windows: 0.16,
    windowCool: '#2d2850',
    windowWarm: '#7a6238',
    label: '#5d56a6',
    labelRing: '#3f3a72',
    ...NO_GLOW,
    bar: '#221d3c',
    barTop: '#3a3369',
    accent: '#a29ce5',
  },
  {
    // Neon, when the clubs are full
    sky: ['#0d0816', '#140a1f', '#1d0c2a', '#2a0f36', '#3d1442', '#5a1a4c'],
    stars: 0.6,
    city: '#150a1d',
    windows: 0.3,
    windowCool: '#43215f',
    windowWarm: '#c0407a',
    label: '#b0407a',
    labelRing: '#6e2450',
    ...NO_GLOW,
    bar: '#2a1236',
    barTop: '#5a1f5e',
    accent: '#ff7ab4',
  },
  {
    // The small hours, cold and quiet
    sky: ['#070a12', '#0a0f1a', '#0d1424', '#111a2e', '#152139', '#1b2a45'],
    stars: 1,
    city: '#0a0e18',
    windows: 0.06,
    windowCool: '#1f2e4a',
    windowWarm: '#6a5a3a',
    label: '#3f6aa6',
    labelRing: '#2a4672',
    ...NO_GLOW,
    bar: '#14203a',
    barTop: '#24406a',
    accent: '#7ab8f0',
  },
  {
    // Dawn, the horizon warming under a blue sky
    sky: ['#151a33', '#1e2342', '#2e2b4f', '#4a3458', '#7a4560', '#c26a5e'],
    stars: 0.35,
    city: '#2a1e40',
    windows: 0.08,
    windowCool: '#3a3358',
    windowWarm: '#e0a050',
    label: '#d06a5a',
    labelRing: '#8a3e48',
    ...NO_GLOW,
    bar: '#1e1734',
    barTop: '#3e2c58',
    accent: '#ff9a7a',
  },
  {
    // Sunrise
    sky: ['#3a3a6a', '#5a4a78', '#8a5a78', '#c0707a', '#e8956e', '#f8c27a'],
    stars: 0,
    city: '#5a3a5a',
    windows: 0.03,
    windowCool: '#6a4a6a',
    windowWarm: '#ffd08a',
    label: '#ffb347',
    labelRing: '#e07a3a',
    glow: '#ffd08a',
    glowStrength: 1,
    bar: '#2e1c3a',
    barTop: '#5a3050',
    accent: '#ffd08a',
  },
  {
    // Morning, breakfast time
    sky: ['#2e5a96', '#3a68a4', '#4a78b0', '#5e8aba', '#7aa0c4', '#a8c0cc'],
    stars: 0,
    city: '#4a6c9c',
    windows: 0,
    windowCool: '#5a7cac',
    windowWarm: '#5a7cac',
    label: '#ffe08a',
    labelRing: '#f0b84a',
    glow: '#fff4c8',
    glowStrength: 1,
    bar: '#2e4670',
    barTop: '#46648e',
    accent: '#fff0b0',
  },
  {
    // Golden hour
    sky: ['#3a3060', '#5a3a6a', '#8a4a62', '#b85a52', '#d8784a', '#f0a04a'],
    stars: 0,
    city: '#6a3442',
    windows: 0.05,
    windowCool: '#7a4452',
    windowWarm: '#ffc070',
    label: '#ffb347',
    labelRing: '#d0703a',
    glow: '#ffc070',
    glowStrength: 1,
    bar: '#3a1c34',
    barTop: '#6a2c44',
    accent: '#ffd27a',
  },
  {
    // Dusk, the lights coming back on
    sky: ['#120f24', '#1a1532', '#261c40', '#3a224a', '#56284e', '#7a3450'],
    stars: 0.5,
    city: '#140e1e',
    windows: 0.12,
    windowCool: '#3a2450',
    windowWarm: '#c08a4a',
    label: '#a0507a',
    labelRing: '#5e2c50',
    ...NO_GLOW,
    bar: '#251a3a',
    barTop: '#4a2c5a',
    accent: '#e08ab4',
  },
];

/** Beats at the end of a section over which the next time of day dissolves in, one step a beat. */
export const TRANSITION_STEPS = 4;

export type TimeOfDay = {
  from: number;
  to: number;
  /** 0 shows `from`, TRANSITION_STEPS shows `to`. */
  step: number;
  theme: Theme;
};

const rgbCache = new Map<string, number[]>();

function rgb(hex: string) {
  let value = rgbCache.get(hex);
  if (!value) {
    const number = Number.parseInt(hex.slice(1), 16);
    value = [(number >> 16) & 255, (number >> 8) & 255, number & 255];
    rgbCache.set(hex, value);
  }
  return value;
}

export function rgbOf(hex: string) {
  return rgb(hex);
}

export function mix(from: string, to: string, amount: number) {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  const a = rgb(from);
  const b = rgb(to);
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function blend(a: Theme, b: Theme, amount: number): Theme {
  const glowStrength = a.glowStrength + (b.glowStrength - a.glowStrength) * amount;
  return {
    sky: a.sky.map((color, index) => mix(color, b.sky[index], amount)),
    stars: a.stars + (b.stars - a.stars) * amount,
    city: mix(a.city, b.city, amount),
    windows: a.windows + (b.windows - a.windows) * amount,
    windowCool: mix(a.windowCool, b.windowCool, amount),
    windowWarm: mix(a.windowWarm, b.windowWarm, amount),
    label: mix(a.label, b.label, amount),
    labelRing: mix(a.labelRing, b.labelRing, amount),
    // A halo fading in or out keeps its colour rather than fading through black.
    glow: a.glowStrength === 0 ? b.glow : b.glowStrength === 0 ? a.glow : mix(a.glow, b.glow, amount),
    glowStrength,
    bar: mix(a.bar, b.bar, amount),
    barTop: mix(a.barTop, b.barTop, amount),
    accent: mix(a.accent, b.accent, amount),
  };
}

/** The time of day at a beat. Before the run starts it always stays midnight. */
export function timeOfDay(beat: number, started: boolean): TimeOfDay {
  if (!started) return { from: 0, to: 0, step: 0, theme: THEMES[0] };
  const section = Math.floor(beat / BEATS_PER_SECTION);
  const from = section % THEMES.length;
  const to = (section + 1) % THEMES.length;
  const intoSection = Math.floor(beat - section * BEATS_PER_SECTION);
  const step = Math.max(0, Math.min(TRANSITION_STEPS, intoSection - (BEATS_PER_SECTION - TRANSITION_STEPS - 1)));
  if (step === 0) return { from, to: from, step: 0, theme: THEMES[from] };
  return { from, to, step, theme: blend(THEMES[from], THEMES[to], step / TRANSITION_STEPS) };
}
