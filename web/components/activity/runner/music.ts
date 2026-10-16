// The runner's soundtrack written down as data: what plays on every sixteenth of the song.
// Nothing here makes a sound, so the arrangement can be read and checked on its own; audio.ts
// turns it into sound.
//
// The song follows the sections the engine lays out (intro, verse, chorus, breakdown, drop) in
// A minor. Every part sits on a layer, and the layers come in as the combo grows: a run that
// stays on the beat builds the track up from a bare beat and bass to the full band, and losing
// the combo strips it back down.

import { BEATS_PER_SECTION, sectionKind, type SectionKind } from './engine';

export const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = 16;
const BARS_PER_SECTION = BEATS_PER_SECTION / 4;

export type Layer = 'base' | 'groove' | 'lead' | 'full' | 'fever';
export const LAYERS: Layer[] = ['base', 'groove', 'lead', 'full', 'fever'];

/** Combo at which each layer joins in. Fever brings in the last one. */
const LAYER_COMBO = { groove: 4, lead: 8, full: 16 };

export function layersFor(combo: number, fever: boolean): Record<Layer, boolean> {
  return {
    base: true,
    groove: combo >= LAYER_COMBO.groove,
    lead: combo >= LAYER_COMBO.lead,
    full: combo >= LAYER_COMBO.full,
    fever,
  };
}

export type Voice =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'openHat'
  | 'crash'
  | 'tom'
  | 'bass'
  | 'pad'
  | 'arp'
  | 'lead'
  | 'harmony'
  | 'sparkle'
  | 'riser';

export type MusicEvent = {
  voice: Voice;
  layer: Layer;
  /** 0 to 1. */
  velocity: number;
  midi?: number;
  /** Length in sixteenths, for voices that hold. */
  steps?: number;
  /** 0 to 1: how far the arpeggio filter has opened. */
  bright?: number;
};

export type Chord = { root: number; tones: number[] };

const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];
// Roots in the bass register.
const Am: Chord = { root: 45, tones: MINOR };
const F: Chord = { root: 41, tones: MAJOR };
const C: Chord = { root: 48, tones: MAJOR };
const G: Chord = { root: 43, tones: MAJOR };
const E: Chord = { root: 40, tones: MAJOR };

// One chord a bar. Every section that leads into a breakdown or a drop ends on E, so the next
// one lands on A minor like a resolution.
const PROGRESSIONS: Record<SectionKind, Chord[]> = {
  intro: [Am, F, C, G, Am, F, C, G],
  verse: [Am, F, C, G, Am, F, C, G],
  chorus: [F, G, C, Am, F, G, E, E],
  breakdown: [Am, Am, F, F, C, C, G, E],
  drop: [Am, F, C, G, Am, F, G, E],
};

// Melodies, one bar a line: [sixteenth, MIDI note, length in sixteenths].
type Phrase = [number, number, number][];

const VERSE_A: Phrase = [[0, 76, 3], [3, 72, 3], [6, 69, 2], [8, 72, 2], [10, 76, 4], [14, 74, 2]];
const VERSE: Phrase[] = [
  VERSE_A,
  [[0, 72, 6], [6, 69, 2], [8, 65, 2], [10, 69, 2], [12, 72, 4]],
  [[0, 79, 3], [3, 76, 3], [6, 72, 2], [8, 76, 2], [10, 79, 2], [12, 81, 4]],
  [[0, 79, 6], [6, 74, 2], [8, 71, 4], [12, 74, 4]],
  VERSE_A,
  [[0, 72, 3], [3, 77, 3], [6, 76, 2], [8, 72, 2], [10, 69, 2], [12, 72, 4]],
  [[0, 76, 3], [3, 79, 3], [6, 84, 2], [8, 83, 2], [10, 79, 2], [12, 76, 4]],
  [[0, 74, 4], [4, 71, 2], [6, 67, 2], [8, 71, 2], [10, 74, 2], [12, 79, 4]],
];

const CHORUS_F: Phrase = [[0, 81, 2], [2, 81, 2], [4, 79, 2], [6, 77, 4], [10, 76, 2], [12, 77, 4]];
const CHORUS_G: Phrase = [[0, 79, 2], [2, 79, 2], [4, 77, 2], [6, 74, 4], [10, 71, 2], [12, 74, 4]];
const CHORUS: Phrase[] = [
  CHORUS_F,
  CHORUS_G,
  [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 83, 2], [10, 79, 2], [12, 76, 4]],
  [[0, 76, 6], [6, 72, 2], [8, 76, 2], [10, 81, 6]],
  CHORUS_F,
  CHORUS_G,
  [[0, 80, 2], [2, 83, 2], [4, 88, 4], [8, 86, 2], [10, 83, 2], [12, 80, 4]],
  [[0, 83, 6], [6, 80, 2], [8, 76, 4], [12, 71, 2], [14, 76, 2]],
];

// Long notes over the breakdown pads, left to ring in the echo.
const BREAKDOWN: Phrase[] = [
  [[0, 76, 8], [8, 72, 8]],
  [[0, 81, 16]],
  [[0, 81, 8], [8, 84, 8]],
  [[0, 81, 16]],
  [[0, 79, 8], [8, 76, 8]],
  [[0, 79, 16]],
  [[0, 83, 8], [8, 86, 8]],
  [[0, 80, 8], [8, 83, 8]],
];

// The drop riff: a pickup on the "and" of one, then a run up the chord.
const DROP_AM: Phrase = [[0, 81, 2], [3, 81, 1], [4, 79, 2], [6, 76, 2], [8, 81, 2], [10, 84, 2], [12, 83, 2], [14, 79, 2]];
const DROP_F: Phrase = [[0, 77, 2], [3, 77, 1], [4, 76, 2], [6, 72, 2], [8, 77, 2], [10, 81, 2], [12, 79, 2], [14, 76, 2]];
const DROP: Phrase[] = [
  DROP_AM,
  DROP_F,
  [[0, 76, 2], [3, 76, 1], [4, 79, 2], [6, 84, 2], [8, 83, 2], [10, 79, 2], [12, 76, 2], [14, 79, 2]],
  [[0, 79, 2], [3, 79, 1], [4, 83, 2], [6, 86, 4], [10, 83, 2], [12, 79, 4]],
  DROP_AM,
  DROP_F,
  [[0, 79, 2], [3, 79, 1], [4, 83, 2], [6, 86, 2], [8, 88, 4], [12, 86, 2], [14, 83, 2]],
  [[0, 83, 2], [2, 80, 2], [4, 83, 2], [6, 88, 6], [12, 86, 2], [14, 83, 2]],
];

const MELODIES: Record<SectionKind, Phrase[]> = {
  intro: VERSE,
  verse: VERSE,
  chorus: CHORUS,
  breakdown: BREAKDOWN,
  drop: DROP,
};

// Bass lines, one bar: [sixteenth, interval above the root, length in sixteenths].
const BASS: Record<SectionKind, [number, number, number][]> = {
  intro: [[0, 0, 3], [3, 0, 3], [6, 12, 2], [8, 0, 2], [10, 7, 2], [14, 12, 2]],
  verse: [[0, 0, 3], [3, 0, 3], [6, 12, 2], [8, 0, 2], [10, 7, 2], [14, 12, 2]],
  chorus: [[0, 0, 2], [2, 0, 2], [4, 12, 2], [6, 0, 2], [8, 0, 2], [10, 12, 2], [12, 7, 2], [14, 12, 2]],
  breakdown: [[0, 0, 16]],
  drop: [[0, 0, 1], [2, 12, 2], [4, 0, 1], [6, 12, 2], [8, 0, 1], [10, 12, 2], [12, 0, 1], [13, 0, 1], [14, 12, 2]],
};

// The arpeggio walks these chord degrees: 0, 1 and 2 are the triad, 3 the octave.
const ARP_UP_DOWN = [0, 1, 2, 3, 2, 1];
const ARP_ROLL = [0, 1, 2, 1];

export type SongPosition = {
  section: number;
  kind: SectionKind;
  /** Bar within the section, 0 to 7. */
  bar: number;
  /** Sixteenth within the bar, 0 to 15. */
  inBar: number;
  chord: Chord;
};

export function positionAt(step: number): SongPosition {
  const whole = Math.max(0, Math.floor(step));
  const section = Math.floor(whole / (BEATS_PER_SECTION * STEPS_PER_BEAT));
  const kind = sectionKind(section);
  const bar = Math.floor(whole / STEPS_PER_BAR) % BARS_PER_SECTION;
  return { section, kind, bar, inBar: whole % STEPS_PER_BAR, chord: PROGRESSIONS[kind][bar] };
}

/** The chord under a beat, so sound effects can play in key. */
export function chordAt(beat: number) {
  return positionAt(beat * STEPS_PER_BEAT).chord;
}

/** A chord tone, counting up through the triad and on into the next octaves. */
export function chordTone(chord: Chord, degree: number) {
  const octave = Math.floor(degree / chord.tones.length);
  const index = degree - octave * chord.tones.length;
  return chord.root + octave * 12 + chord.tones[index];
}

/** The nearest chord tone at least a minor third under a note, for a second voice. */
function chordToneBelow(chord: Chord, midi: number) {
  for (let candidate = midi - 3; candidate > midi - 12; candidate -= 1) {
    const interval = (((candidate - chord.root) % 12) + 12) % 12;
    if (chord.tones.includes(interval)) return candidate;
  }
  return midi - 12;
}

function drums(position: SongPosition, out: MusicEvent[]) {
  const { kind, bar, inBar } = position;
  const add = (voice: Voice, layer: Layer, velocity: number, midi?: number) => out.push({ voice, layer, velocity, midi });
  const lastBar = bar === BARS_PER_SECTION - 1;
  const quarter = inBar % 4 === 0;
  const offEighth = inBar % 4 === 2;

  if (kind === 'breakdown') {
    // The beat drops out. Bar 7 brings the kick back on the quarters, bar 8 rolls the snare
    // faster and faster, and the last sixteenth is left empty so the drop lands on silence.
    if (bar === 0 && inBar === 0) {
      add('crash', 'base', 0.7);
      add('kick', 'base', 0.9);
    }
    if (bar < 6 && offEighth) add('hat', 'groove', 0.35);
    if (bar === 6) {
      if (quarter) add('kick', 'base', 0.8);
      if (quarter) add('snare', 'groove', 0.45);
      if (inBar === 0) add('riser', 'base', 0.8);
    }
    if (bar === 7 && inBar < 15) {
      const roll = inBar < 8 ? inBar % 2 === 0 : true;
      if (roll) add('snare', 'base', 0.35 + (inBar / 15) * 0.55);
      if (quarter) add('kick', 'base', 0.8);
    }
    return;
  }

  // Kicks: two a bar in the verse, four on the floor from the chorus on.
  const fourOnFloor = kind === 'chorus' || kind === 'drop';
  if (inBar === 0 || inBar === 8) add('kick', 'base', 1);
  else if (quarter && fourOnFloor) add('kick', 'base', 0.9);
  else if (kind === 'verse' && bar % 2 === 1 && inBar === 10) add('kick', 'base', 0.75);
  else if (kind === 'drop' && bar % 4 === 3 && inBar === 14) add('kick', 'base', 0.8);

  // A fill closes every section and hands over to the next.
  if (lastBar && inBar >= 12) {
    if (kind === 'verse' || kind === 'intro') add('tom', 'groove', 0.8, [55, 52, 48, 45][inBar - 12]);
    else add('snare', 'groove', 0.5 + (inBar - 12) * 0.15);
  } else if (inBar === 4 || inBar === 12) {
    add('snare', 'groove', 0.9);
    if (fourOnFloor) add('clap', 'full', 0.6);
  } else if (kind === 'drop' && inBar === 15 && bar % 2 === 1) {
    add('snare', 'full', 0.3);
  }

  // Hats: eighths at first, sixteenths once the band is in.
  if (inBar % 2 === 0) add('hat', 'base', offEighth ? 0.6 : 0.35);
  else if (kind !== 'intro') add('hat', 'full', 0.22);
  if (offEighth && fourOnFloor) add('openHat', 'full', 0.4);
  if (offEighth && !fourOnFloor) add('openHat', 'fever', 0.4);

  if (inBar === 0 && bar === 0 && kind !== 'intro') add('crash', kind === 'drop' ? 'base' : 'groove', 0.75);
  if (inBar === 0 && bar === 4 && fourOnFloor) add('crash', 'groove', 0.5);
  if (inBar === 0 && bar % 2 === 0) add('crash', 'fever', 0.45);
}

function bass(position: SongPosition, out: MusicEvent[]) {
  const { kind, bar, inBar, chord } = position;
  if (kind === 'breakdown' && bar >= 6) {
    // The build: quarters, then eighths climbing the octave.
    const every = bar === 6 ? 4 : 2;
    if (inBar % every === 0 && inBar < 15) {
      out.push({ voice: 'bass', layer: 'base', velocity: 0.8, midi: chord.root + (bar === 7 && inBar >= 8 ? 12 : 0), steps: every - 0.5 });
    }
    return;
  }
  for (const [at, interval, steps] of BASS[kind]) {
    if (at === inBar) out.push({ voice: 'bass', layer: 'base', velocity: kind === 'breakdown' ? 0.6 : 0.85, midi: chord.root + interval, steps });
  }
}

function harmony(position: SongPosition, out: MusicEvent[]) {
  const { kind, bar, inBar, chord, section } = position;

  if (kind === 'breakdown' && inBar === 0) {
    // Pads hold the chord for the whole bar.
    for (let degree = 3; degree < 6; degree += 1) {
      out.push({ voice: 'pad', layer: 'base', velocity: 0.5, midi: chordTone(chord, degree), steps: 16 });
    }
  }

  // Arpeggio: eighths in the verse, sixteenths when things pick up. In the breakdown its filter
  // opens bar by bar towards the drop.
  const sixteenths = kind !== 'intro' && kind !== 'verse';
  if (sixteenths || inBar % 2 === 0) {
    const index = sixteenths ? inBar : inBar / 2;
    const shape = kind === 'verse' || kind === 'intro' ? ARP_ROLL : ARP_UP_DOWN;
    const degree = 6 + shape[index % shape.length];
    const bright = kind === 'breakdown' ? (bar * STEPS_PER_BAR + inBar) / (BARS_PER_SECTION * STEPS_PER_BAR) : 1;
    out.push({ voice: 'arp', layer: 'groove', velocity: kind === 'breakdown' ? 0.75 : 0.55, midi: chordTone(chord, degree), bright });
  }

  // Fever sparkles an octave over the arpeggio, against the beat.
  if (inBar % 2 === 1) {
    const degree = 9 + ARP_UP_DOWN[((inBar - 1) / 2 + section) % ARP_UP_DOWN.length];
    out.push({ voice: 'sparkle', layer: 'fever', velocity: 0.5, midi: chordTone(chord, degree) });
  }
}

function melody(position: SongPosition, out: MusicEvent[]) {
  const { kind, bar, inBar, chord } = position;
  const phrase = MELODIES[kind][bar];
  for (const [at, midi, steps] of phrase) {
    if (at !== inBar) continue;
    out.push({ voice: 'lead', layer: 'lead', velocity: kind === 'breakdown' ? 0.7 : 0.85, midi, steps });
    // A second voice under the tune once the band is full, and the tune an octave up in fever.
    out.push({ voice: 'harmony', layer: 'full', velocity: 0.55, midi: chordToneBelow(chord, midi), steps });
    out.push({ voice: 'lead', layer: 'fever', velocity: 0.35, midi: midi + 12, steps });
  }
}

/** Everything the song plays on a sixteenth, on every layer. The audio decides what is heard. */
export function arrange(step: number): MusicEvent[] {
  const position = positionAt(step);
  const out: MusicEvent[] = [];
  drums(position, out);
  bass(position, out);
  harmony(position, out);
  melody(position, out);
  return out;
}
