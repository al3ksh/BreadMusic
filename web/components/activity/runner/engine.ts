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
//
// Sections are built from authored eight-beat phrases rather than random gaps: a phrase plays
// twice so it can be learned, then a twist and a fill. Pans hang from above and must be run
// under, and grills are too long for a plain jump: holding the button past the top of a jump
// turns the fall into a slow float.

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

// Holding past the top of a jump caps the fall at this speed, for at most MAX_GLIDE seconds.
const GLIDE_FALL = 28;
const MAX_GLIDE = 1.1;
// Air time of a full float, from take-off back to the ground.
const GLIDE_AIRTIME = (() => {
  const apex = JUMP_VELOCITY / GRAVITY;
  const lowest = JUMP_HEIGHT - GLIDE_FALL * MAX_GLIDE;
  const fall = (-GLIDE_FALL + Math.sqrt(GLIDE_FALL * GLIDE_FALL + 2 * GRAVITY * lowest)) / GRAVITY;
  return apex + MAX_GLIDE + fall;
})();
// A grill's near edge meets the toast this long after the ideal press, safely off the ground.
const GRILL_LEAD = 0.15;

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
  /** Obstacles are jumped, notes are jumped for, overhead pans are run under. */
  type: 'obstacle' | 'note' | 'overhead';
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
  | { type: 'dodge'; points: number; event: RunnerEvent }
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
  /** Button held down: past the top of a jump the toast floats. */
  holding: boolean;
  glideTime: number;
  events: RunnerEvent[];
  /** Start of the next phrase still to be laid out. */
  nextPhraseBeat: number;
  /** Planning: song time of the last laid out press, and the earliest a next press can come. */
  lastPressTime: number;
  airtime: number;
  freeAt: number;
  phrases: { section: number; set: Phrase[] } | null;
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
    holding: false,
    glideTime: 0,
    events: [],
    nextPhraseBeat: 0,
    lastPressTime: -Infinity,
    airtime: AIRTIME,
    freeAt: timeAtBeat(FIRST_PRESS_BEAT),
    phrases: null,
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

function pickObstacle(random: () => number, section: number, big: boolean): ObstacleKind {
  if (big) return weighted(random, [['knives', 2], ['eqWide', 3], ['toaster', 1]]);
  if (sectionKind(section) === 'intro') return weighted(random, [['eq', 3], ['knife', 2], ['toaster', 1]]);
  return weighted(random, [['eq', 3], ['knife', 2], ['toaster', 2]]);
}

// Eight-beat phrases at half-beat resolution, sixteen steps each:
// '.' rest, 'o' small obstacle, 'O' big obstacle, 'n' note, 'h' hanging pan, 'g' grill, 'G' long grill.
// A section plays A, A, B, C: the first phrase twice so it can be learned, a twist, then a fill.
// Steps the toast cannot physically make at the current tempo are dropped when laid out.
type PhrasePool = { a: string[]; b: string[]; c: string[] };
type Phrase = { pattern: string; kinds: (ObstacleKind | null)[] };

const INTRO: PhrasePool = {
  a: ['o.......o.......', 'o.......o...n...'],
  b: ['o...o.......o...', 'o.......n...o...'],
  c: ['o...n...o...o...', 'o...o...o.......'],
};

// Indexed by lap: pans first turn up in the first chorus and grills in the first drop, then
// everything mixes from the second time round.
const PHRASES: Record<'verse' | 'chorus' | 'drop', PhrasePool[]> = {
  verse: [
    {
      a: ['o...o...o...n...', 'o.......o...o...', 'o...n...o.......', 'O.......o...n...'],
      b: ['o...o..o....n...', 'O.......n...O...', 'o...n...n...o...'],
      c: ['o...o...o...o...', 'O.......o..o....', 'n...n...o.......'],
    },
    {
      a: ['o...h.o.o...n...', 'O.......h.o.o...', 'o...o...g.......', 'o...n...O...h.o.'],
      b: ['h.o.....h.o.n...', 'g.........o...o.', 'O...o...h...O...'],
      c: ['o...o...o...O...', 'G...........n...', 'h.o.h.o.o...o...'],
    },
  ],
  chorus: [
    {
      a: ['o...h...o...h...', 'o.......h.o.....', 'o...o...h...o...', 'O...n...h.o.....'],
      b: ['h.o.....h.o.....', 'o...h.o.n...o...', 'O.......h...n...'],
      c: ['O...n...h...h.o.', 'o...o...h.o.n...', 'h...h...o...O...'],
    },
    {
      a: ['h.o.O...h.o.n...', 'o...h.o.O...h...', 'g.........h.o...', 'O...h...h.o.n...'],
      b: ['G...........h.o.', 'h.o.h.o.O...n...', 'o...g...........'],
      c: ['h.o.O...h.o.O...', 'g.........o...o.', 'O...h...n...h.o.'],
    },
  ],
  drop: [
    {
      a: ['g...........o...', 'o...o...g.......', 'O...o...O...n...', 'g.........o...o.'],
      b: ['O...h.o.O...h.o.', 'o...n...g.......', 'G...........o...'],
      c: ['g.......o...o...', 'O...o...O...o...', 'h.o.O...n...O...'],
    },
    {
      a: ['G.........h.o...', 'O...h.o.g.......', 'g.........O...n.', 'h.o.O...h.o.O...'],
      b: ['G...........O...', 'O...h.o.h.o.n...', 'g.........h.o.n.'],
      c: ['O...O...h.o.O...', 'G.........o...n.', 'h.o.g...........'],
    },
  ],
};

function choose<T>(random: () => number, options: T[]): T {
  return options[Math.floor(random() * options.length)];
}

function phrasesFor(world: RunnerWorld, section: number): Phrase[] {
  const kind = sectionKind(section);
  const pool = kind === 'intro' ? INTRO : PHRASES[kind as 'verse' | 'chorus' | 'drop'][Math.min(1, lap(section))];
  const make = (pattern: string): Phrase => ({
    pattern,
    kinds: [...pattern].map((step) => (step === 'o' || step === 'O' ? pickObstacle(world.random, section, step === 'O') : null)),
  });
  const first = make(choose(world.random, pool.a));
  return [first, first, make(choose(world.random, pool.b)), make(choose(world.random, pool.c))];
}

function addEvent(world: RunnerWorld, type: RunnerEvent['type'], kind: ObstacleKind | null, pressBeat: number) {
  const pressTime = timeAtBeat(pressBeat);
  const image = kind ? OBSTACLE_SPRITES[kind] : null;
  const width = image ? image.width : 6;
  let centerBeat = beatAtTime(pressTime + AIRTIME / 2);
  // A pan is over the toast on its beat; a grill starts just after take-off and runs under the float.
  if (type === 'overhead') centerBeat = pressBeat;
  else if (kind === 'grill' || kind === 'grillLong') centerBeat = beatAtTime(pressTime + GRILL_LEAD) + (HIT_HALF_WIDTH + width / 2) / PX_PER_BEAT;
  world.events.push({
    id: world.nextId,
    type,
    kind,
    pressBeat,
    centerBeat,
    width,
    profile: image ? columnProfile(image) : [],
    pressOffset: null,
    resolved: false,
    collected: false,
  });
  world.nextId += 1;
}

/** Seconds something this wide takes to pass from the toast's front edge to clear of its back. */
function passing(beat: number, width: number) {
  return (HIT_HALF_WIDTH + width / 2) / ((PX_PER_BEAT * bpmAt(beat)) / 60);
}

/** Lays one phrase step if the toast can make it after what came before, otherwise skips it. */
function placeStep(world: RunnerWorld, step: string, kind: ObstacleKind | null, beat: number) {
  const time = timeAtBeat(beat);
  if (step === 'h') {
    const reach = passing(beat, OBSTACLE_SPRITES.pan.width);
    // Back on the ground before the pan arrives, and no jump until it has gone.
    if (time - reach < world.lastPressTime + world.airtime + 0.06) return;
    addEvent(world, 'overhead', 'pan', beat);
    world.freeAt = Math.max(world.freeAt, time + reach + 0.04);
    return;
  }
  if (time < world.freeAt) return;
  const grill = step === 'g' || step === 'G';
  if (step === 'n') addEvent(world, 'note', null, beat);
  else if (grill) addEvent(world, 'obstacle', step === 'g' ? 'grill' : 'grillLong', beat);
  else addEvent(world, 'obstacle', kind, beat);
  world.lastPressTime = time;
  world.airtime = grill ? GLIDE_AIRTIME : AIRTIME;
  world.freeAt = time + world.airtime + (MIN_GAP_SECONDS - AIRTIME);
}

/** A breakdown has no obstacles: a run of notes to jump for, then a few empty beats of build. */
function planBreakdown(world: RunnerWorld, section: number) {
  const start = section * BEATS_PER_SECTION;
  let beat = Math.ceil(Math.max(beatAtTime(world.freeAt), start + 2) * 2) / 2;
  while (beat <= start + BREAKDOWN_NOTES_UNTIL) {
    placeStep(world, 'n', null, beat);
    let gap = weighted(world.random, [[2, 3], [1.5, 2], [1, 2], [3, 1]]);
    while (gap < minGapBeats(beat)) gap += 0.5;
    beat += gap;
  }
  world.nextPhraseBeat = start + BEATS_PER_SECTION;
}

/** Lays out obstacles and notes ahead of the toast, far enough to fill the visible width. */
function plan(world: RunnerWorld, untilBeat: number) {
  while (world.nextPhraseBeat < untilBeat) {
    const start = world.nextPhraseBeat;
    const section = Math.floor(start / BEATS_PER_SECTION);
    if (sectionKind(section) === 'breakdown') {
      planBreakdown(world, section);
      continue;
    }
    if (world.phrases?.section !== section) world.phrases = { section, set: phrasesFor(world, section) };
    // The intro's first phrase stays empty so there is time to find the beat.
    if (start >= FIRST_PRESS_BEAT) {
      const phrase = world.phrases.set[Math.floor((start - section * BEATS_PER_SECTION) / 8)];
      [...phrase.pattern].forEach((step, position) => {
        if (step !== '.') placeStep(world, step, phrase.kinds[position], start + position / 2);
      });
    }
    world.nextPhraseBeat = start + 8;
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
  world.glideTime = 0;
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
  world.holding = true;
  if (grounded(world)) takeOff(world, cues);
  // Pressed just before landing: jump the moment the toast touches down.
  else world.bufferedUntil = world.songTime + JUMP_BUFFER;
  return cues;
}

/** Button let go: the float, if any, ends and the toast falls. */
export function release(world: RunnerWorld) {
  world.holding = false;
}

/** Whether the toast is floating right now, for the trail behind it. */
export function gliding(world: RunnerWorld) {
  return world.holding && !grounded(world) && world.velocity <= -GLIDE_FALL + 1 && world.glideTime > 0 && world.glideTime < MAX_GLIDE;
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

// A pan hangs with its bottom just above a standing toast: any jump under it hits.
const PAN_BOTTOM = TOAST_HEIGHT + 3;

export function panBottom() {
  return PAN_BOTTOM;
}

function hitsOverhead(world: RunnerWorld, event: RunnerEvent) {
  const offset = eventOffset(world, event);
  if (offset + event.width / 2 <= -HIT_HALF_WIDTH + 1 || offset - event.width / 2 >= HIT_HALF_WIDTH - 1) return false;
  return world.lift + TOAST_HEIGHT - 1 > PAN_BOTTOM;
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
    if (world.holding && world.velocity < -GLIDE_FALL && world.glideTime < MAX_GLIDE) {
      world.velocity = -GLIDE_FALL;
      world.glideTime += dt;
    }
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
    if (event.type === 'overhead') {
      if (hitsOverhead(world, event)) {
        world.over = true;
        cues.push({ type: 'crash', event });
        return;
      }
      if (offset + event.width / 2 < -HIT_HALF_WIDTH) {
        event.resolved = true;
        countHit(world, cues);
        cues.push({ type: 'dodge', points: award(world, 5), event });
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
