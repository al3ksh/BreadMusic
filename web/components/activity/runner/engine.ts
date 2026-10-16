// Game rules for the Activity runner. Pure state and maths: no DOM, canvas or audio here.
//
// The world is laid out in beats, not pixels. One beat always spans PX_PER_BEAT pixels, so as
// the tempo rises the ground scrolls faster and every obstacle stays locked to the music.
// Each obstacle has a press beat: jumping exactly on it puts the top of the jump over the
// obstacle's centre.
//
// The run is shaped like a song. After a short intro the sections go verse, chorus, breakdown,
// drop and round again: the breakdown trades obstacles for a run of notes and a build, and the
// drop comes back harder. Hits in a row charge fever, a few bars of double points.

import { columnProfile, OBSTACLE_SPRITES, TOAST_HEIGHT, TOAST_WIDTH, type ObstacleKind } from './sprites';

export const PX_PER_BEAT = 56;
export const TOAST_X = 24;
export const TOAST_CENTER = TOAST_X + TOAST_WIDTH / 2;
export const GROUND_MARGIN = 10;
export const BEATS_PER_SECTION = 32;

const START_BPM = 112;
const BPM_STEP = 4;
const MAX_BPM = 168;
const MAX_SECTION = (MAX_BPM - START_BPM) / BPM_STEP;

const GRAVITY = 1400;
// Every jump has the same arc, so a press on the beat always peaks over the obstacle.
const JUMP_VELOCITY = 340;
export const AIRTIME = (2 * JUMP_VELOCITY) / GRAVITY;
export const JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

const PERFECT_WINDOW = 0.055;
const GOOD_WINDOW = 0.1;
const JUMP_BUFFER = 0.1;
const FIRST_PRESS_BEAT = 8;
// Time a player needs between two jumps: the airtime plus a moment on the ground.
const MIN_GAP_SECONDS = AIRTIME + 0.16;
const SUBSTEP = 1 / 240;
const MAX_FRAME = 0.05;

/** Hits in a row that charge fever, and how long it then lasts. */
export const FEVER_CHARGE = 24;
export const FEVER_BEATS = 16;
// Notes stop this many beats into a breakdown; the rest of it is the build into the drop.
const BREAKDOWN_NOTES_UNTIL = 26;

export type SectionKind = 'intro' | 'verse' | 'chorus' | 'breakdown' | 'drop';
const SONG_CYCLE: SectionKind[] = ['verse', 'chorus', 'breakdown', 'drop'];

export function sectionKind(section: number): SectionKind {
  return section <= 0 ? 'intro' : SONG_CYCLE[(section - 1) % SONG_CYCLE.length];
}

/** How many times the song has gone round, which sets how busy a section of each kind is. */
function lap(section: number) {
  return Math.floor(Math.max(0, section - 1) / SONG_CYCLE.length);
}

// Toast hitbox, relative to the toast's centre column.
const HIT_HALF_WIDTH = TOAST_WIDTH / 2 - 2;
const NOTE_LIFT = JUMP_HEIGHT + TOAST_HEIGHT / 2 - 2;

const SECTION_START = Array.from({ length: MAX_SECTION + 1 }, () => 0);
for (let section = 1; section <= MAX_SECTION; section += 1) {
  SECTION_START[section] = SECTION_START[section - 1] + (BEATS_PER_SECTION * 60) / bpmOfSection(section - 1);
}

function bpmOfSection(section: number) {
  return START_BPM + BPM_STEP * Math.min(MAX_SECTION, Math.max(0, section));
}

export function bpmAt(beat: number) {
  return bpmOfSection(Math.floor(beat / BEATS_PER_SECTION));
}

/** Song time in seconds at which a beat sounds. */
export function timeAtBeat(beat: number) {
  const section = Math.min(MAX_SECTION, Math.max(0, Math.floor(beat / BEATS_PER_SECTION)));
  return SECTION_START[section] + ((beat - section * BEATS_PER_SECTION) * 60) / bpmOfSection(section);
}

export function beatAtTime(time: number) {
  let section = MAX_SECTION;
  while (section > 0 && SECTION_START[section] > time) section -= 1;
  return section * BEATS_PER_SECTION + ((time - SECTION_START[section]) * bpmOfSection(section)) / 60;
}

export type Grade = 'perfect' | 'good';

export type RunnerEvent = {
  id: number;
  type: 'obstacle' | 'note';
  kind: ObstacleKind | null;
  pressBeat: number;
  /** Beat at which the event's centre passes the toast's centre. */
  centerBeat: number;
  width: number;
  profile: number[];
  /** Seconds between the ideal press and the take-off that was matched to this event. */
  pressOffset: number | null;
  resolved: boolean;
  collected: boolean;
};

export type RunnerCue =
  | { type: 'beat'; beat: number }
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'judge'; grade: Grade | 'offbeat'; points: number; event: RunnerEvent }
  | { type: 'note'; points: number; event: RunnerEvent }
  | { type: 'crash'; event: RunnerEvent }
  | { type: 'section'; section: number; kind: SectionKind }
  | { type: 'fever'; on: boolean };

export type RunnerWorld = {
  random: () => number;
  songTime: number;
  beat: number;
  lift: number;
  velocity: number;
  bufferedUntil: number;
  landedAt: number;
  events: RunnerEvent[];
  nextPressBeat: number;
  nextId: number;
  score: number;
  combo: number;
  /** Hits towards the next fever. */
  feverCharge: number;
  /** Beat at which the current fever ends. */
  feverUntil: number;
  over: boolean;
};

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(random: () => number, options: [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = random() * total;
  for (const [value, weight] of options) {
    pick -= weight;
    if (pick < 0) return value;
  }
  return options[options.length - 1][0];
}

export function createWorld(seed = Math.floor(Math.random() * 2 ** 32)): RunnerWorld {
  return {
    random: seeded(seed),
    songTime: 0,
    beat: 0,
    lift: 0,
    velocity: 0,
    bufferedUntil: -Infinity,
    landedAt: -Infinity,
    events: [],
    nextPressBeat: FIRST_PRESS_BEAT,
    nextId: 1,
    score: 0,
    combo: 0,
    feverCharge: 0,
    feverUntil: -Infinity,
    over: false,
  };
}

export function multiplier(combo: number) {
  return Math.min(4, 1 + Math.floor(combo / 8));
}

export function inFever(world: RunnerWorld) {
  return world.beat < world.feverUntil;
}

/** How full the fever meter is: charging up between fevers, draining during one. */
export function feverLevel(world: RunnerWorld) {
  if (inFever(world)) return Math.max(0, (world.feverUntil - world.beat) / FEVER_BEATS);
  return world.feverCharge / FEVER_CHARGE;
}

function countHit(world: RunnerWorld, cues: RunnerCue[]) {
  world.combo += 1;
  if (inFever(world)) return;
  world.feverCharge += 1;
  if (world.feverCharge >= FEVER_CHARGE) {
    world.feverCharge = 0;
    world.feverUntil = world.beat + FEVER_BEATS;
    cues.push({ type: 'fever', on: true });
  }
}

function breakCombo(world: RunnerWorld, cues: RunnerCue[]) {
  world.combo = 0;
  world.feverCharge = 0;
  if (inFever(world)) {
    world.feverUntil = world.beat;
    cues.push({ type: 'fever', on: false });
  }
}

function award(world: RunnerWorld, base: number) {
  const points = base * multiplier(world.combo) * (inFever(world) ? 2 : 1);
  world.score += points;
  return points;
}

export function grounded(world: RunnerWorld) {
  return world.lift <= 0 && world.velocity <= 0;
}

function minGapBeats(beat: number) {
  return (MIN_GAP_SECONDS * bpmAt(beat)) / 60;
}

function pickObstacle(random: () => number, section: number): ObstacleKind {
  const kind = sectionKind(section);
  if (kind === 'intro') return weighted(random, [['eq', 3], ['knife', 2], ['toaster', 1]]);
  if (kind === 'drop') return weighted(random, [['eq', 1], ['knife', 1], ['toaster', 2], ['knives', 2], ['eqWide', 3]]);
  const options: [ObstacleKind, number][] = [['eq', 3], ['knife', 2], ['toaster', 2], ['knives', 1]];
  if (section >= 2) options.push(['eqWide', 2]);
  return weighted(random, options);
}

// Beats from one obstacle to the next. Verses breathe, choruses fill up, drops come in a rush,
// and each lap round the song is busier than the one before.
const GAPS: Record<Exclude<SectionKind, 'breakdown'>, [number, number][][]> = {
  intro: [[[4, 3], [3, 1], [6, 1]]],
  verse: [
    [[4, 3], [3, 2], [6, 1]],
    [[4, 2], [3, 2], [2, 2]],
    [[4, 1], [3, 2], [2, 3], [2.5, 1]],
  ],
  chorus: [
    [[4, 2], [3, 2], [2, 2]],
    [[4, 1], [3, 2], [2, 3], [2.5, 1], [1.5, 1]],
    [[4, 1], [3, 2], [2, 3], [2.5, 2], [1.5, 2]],
  ],
  drop: [
    [[2, 3], [3, 2], [4, 1], [2.5, 1]],
    [[2, 3], [3, 1], [2.5, 2], [1.5, 2], [4, 1]],
    [[2, 3], [1.5, 3], [2.5, 2], [3, 1]],
  ],
};

function pickGap(random: () => number, section: number, kind: Exclude<SectionKind, 'breakdown'>): number {
  const tables = GAPS[kind];
  return weighted(random, tables[Math.min(tables.length - 1, lap(section))]);
}

function addEvent(world: RunnerWorld, type: RunnerEvent['type'], kind: ObstacleKind | null, pressBeat: number) {
  const pressTime = timeAtBeat(pressBeat);
  const centerBeat = beatAtTime(pressTime + AIRTIME / 2);
  const image = kind ? OBSTACLE_SPRITES[kind] : null;
  world.events.push({
    id: world.nextId,
    type,
    kind,
    pressBeat,
    centerBeat,
    width: image ? image.width : 6,
    profile: image ? columnProfile(image) : [],
    pressOffset: null,
    resolved: false,
    collected: false,
  });
  world.nextId += 1;
}

/** A breakdown has no obstacles: a run of notes to jump for, then a few empty beats of build. */
function planBreakdown(world: RunnerWorld, section: number) {
  const start = section * BEATS_PER_SECTION;
  let beat = Math.max(world.nextPressBeat, start + 2);
  while (beat <= start + BREAKDOWN_NOTES_UNTIL) {
    addEvent(world, 'note', null, beat);
    let gap = weighted(world.random, [[2, 3], [1.5, 2], [1, 2], [3, 1]]);
    while (gap < minGapBeats(beat)) gap += 0.5;
    beat += gap;
  }
  // The drop lands with an obstacle on its very first beat.
  world.nextPressBeat = start + BEATS_PER_SECTION;
}

/** Lays out obstacles and notes ahead of the toast, far enough to fill the visible width. */
function plan(world: RunnerWorld, untilBeat: number) {
  while (world.nextPressBeat < untilBeat) {
    const press = world.nextPressBeat;
    const section = Math.floor(press / BEATS_PER_SECTION);
    const kind = sectionKind(section);
    if (kind === 'breakdown') {
      planBreakdown(world, section);
      continue;
    }
    addEvent(world, 'obstacle', pickObstacle(world.random, section), press);

    let gap = pickGap(world.random, section, kind);
    // Off-beat gaps are fine at moderate tempo; at full speed they would ask for a jump mid-air.
    while (gap < minGapBeats(press)) gap += 0.5;
    const half = gap / 2;
    // Fever is planned for as it starts, so the notes thicken a little after it does.
    const noteChance = inFever(world) ? 0.9 : kind === 'drop' ? 0.4 : 0.6;
    if (gap >= 3 && half >= minGapBeats(press) && world.random() < noteChance) {
      addEvent(world, 'note', null, press + half);
    }
    world.nextPressBeat = press + gap;
  }
}

/** Horizontal distance in pixels from the toast's centre to an event's centre. */
export function eventOffset(world: RunnerWorld, event: RunnerEvent) {
  return (event.centerBeat - world.beat) * PX_PER_BEAT;
}

export function noteLift() {
  return NOTE_LIFT;
}

function takeOff(world: RunnerWorld, cues: RunnerCue[]) {
  world.velocity = JUMP_VELOCITY;
  world.bufferedUntil = -Infinity;
  cues.push({ type: 'jump' });

  // Match the take-off to the nearest obstacle still waiting for a jump.
  let match: RunnerEvent | null = null;
  let best = GOOD_WINDOW;
  for (const event of world.events) {
    if (event.type !== 'obstacle' || event.resolved || event.pressOffset !== null) continue;
    const offset = world.songTime - timeAtBeat(event.pressBeat);
    if (Math.abs(offset) <= best) {
      best = Math.abs(offset);
      match = event;
    }
  }
  if (match) match.pressOffset = world.songTime - timeAtBeat(match.pressBeat);
}

export function press(world: RunnerWorld): RunnerCue[] {
  const cues: RunnerCue[] = [];
  if (world.over) return cues;
  if (grounded(world)) takeOff(world, cues);
  // Pressed just before landing: jump the moment the toast touches down.
  else world.bufferedUntil = world.songTime + JUMP_BUFFER;
  return cues;
}

function resolveObstacle(world: RunnerWorld, event: RunnerEvent, cues: RunnerCue[]) {
  event.resolved = true;
  const offset = event.pressOffset;
  if (offset === null) {
    // Cleared, but not on the beat: the toast survives and the combo does not.
    cues.push({ type: 'judge', grade: 'offbeat', points: 0, event });
    breakCombo(world, cues);
    return;
  }
  const grade: Grade = Math.abs(offset) <= PERFECT_WINDOW ? 'perfect' : 'good';
  countHit(world, cues);
  const points = award(world, grade === 'perfect' ? 10 : 5);
  cues.push({ type: 'judge', grade, points, event });
}

function collides(world: RunnerWorld, event: RunnerEvent) {
  const left = eventOffset(world, event) - event.width / 2;
  for (let column = 0; column < event.width; column += 1) {
    const x = left + column;
    // One pixel of forgiveness on each side and on top.
    if (x + 1 <= -HIT_HALF_WIDTH + 1 || x >= HIT_HALF_WIDTH - 1) continue;
    if (event.profile[column] - 1 > world.lift) return true;
  }
  return false;
}

function touchesNote(world: RunnerWorld, event: RunnerEvent) {
  const centre = world.lift + TOAST_HEIGHT / 2;
  return Math.abs(eventOffset(world, event)) <= 6 && Math.abs(centre - NOTE_LIFT) <= 8;
}

function substep(world: RunnerWorld, dt: number, cues: RunnerCue[]) {
  const previousBeat = world.beat;
  world.songTime += dt;
  world.beat = beatAtTime(world.songTime);
  if (Math.floor(world.beat) > Math.floor(previousBeat)) {
    world.score += 1;
    cues.push({ type: 'beat', beat: Math.floor(world.beat) });
    const section = Math.floor(world.beat / BEATS_PER_SECTION);
    if (section > Math.floor(previousBeat / BEATS_PER_SECTION)) cues.push({ type: 'section', section, kind: sectionKind(section) });
  }
  if (previousBeat < world.feverUntil && world.beat >= world.feverUntil) cues.push({ type: 'fever', on: false });

  if (!grounded(world)) {
    world.velocity -= GRAVITY * dt;
    world.lift += world.velocity * dt;
    if (world.lift <= 0) {
      world.lift = 0;
      world.velocity = 0;
      world.landedAt = world.songTime;
      cues.push({ type: 'land' });
      if (world.songTime <= world.bufferedUntil) takeOff(world, cues);
    }
  }

  for (const event of world.events) {
    if (event.resolved) continue;
    const offset = eventOffset(world, event);
    if (event.type === 'note') {
      if (touchesNote(world, event)) {
        event.resolved = true;
        event.collected = true;
        countHit(world, cues);
        cues.push({ type: 'note', points: award(world, 15), event });
      } else if (offset < -10) {
        event.resolved = true;
      }
      continue;
    }
    if (collides(world, event)) {
      world.over = true;
      cues.push({ type: 'crash', event });
      return;
    }
    if (offset + event.width / 2 < -HIT_HALF_WIDTH) resolveObstacle(world, event, cues);
  }
}

/** Advances the world by a frame. Long frames are capped so a stall cannot skip an obstacle. */
export function step(world: RunnerWorld, frameSeconds: number, viewWidth: number): RunnerCue[] {
  const cues: RunnerCue[] = [];
  if (world.over) return cues;
  plan(world, world.beat + (viewWidth - TOAST_X) / PX_PER_BEAT + 2);

  let remaining = Math.min(MAX_FRAME, Math.max(0, frameSeconds));
  while (remaining > 1e-9 && !world.over) {
    const dt = Math.min(SUBSTEP, remaining);
    substep(world, dt, cues);
    remaining -= dt;
  }
  world.events = world.events.filter((event) => eventOffset(world, event) > -80);
  return cues;
}
