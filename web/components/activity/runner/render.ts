// Draws the Activity runner on a low-resolution canvas and keeps the short-lived effects
// (crumbs, sparks, score popups, smoke, screen shake) that react to what the engine reports.
//
// The scene is a kitchen counter in a city: a dithered sky, a vinyl record hanging where the
// moon would be, a skyline, and a row of equalizer bars that bounce with the music. The time of
// day moves on with every section of the song (see themes.ts).
//
// The song's structure shows on screen too: each section announces itself, the breakdown counts
// down into the drop, and fever turns everything gold for as long as it lasts.

import {
  BEATS_PER_SECTION,
  eventOffset,
  feverLevel,
  GROUND_MARGIN,
  inFever,
  multiplier,
  noteLift,
  PX_PER_BEAT,
  sectionKind,
  TOAST_CENTER,
  TOAST_X,
  type RunnerCue,
  type RunnerEvent,
  type RunnerWorld,
  type SectionKind,
} from './engine';
import {
  drawSprite,
  drawText,
  NOTE,
  OBSTACLE_SPRITES,
  textWidth,
  TOAST_BURNT,
  TOAST_JUMP,
  TOAST_RUN_A,
  TOAST_RUN_A_BLINK,
  TOAST_RUN_B,
  TOAST_RUN_B_BLINK,
  TOAST_SQUASH,
  TOAST_STAND,
  TOAST_STAND_BLINK,
  TOASTER_SLOTS,
  type Sprite,
} from './sprites';
import { mix, rgbOf, THEMES, timeOfDay, TRANSITION_STEPS, type Theme, type TimeOfDay } from './themes';

export type RunnerMode = 'idle' | 'running' | 'paused' | 'over';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  max: number;
  color: string;
  spark: boolean;
};
type Popup = { text: string; x: number; y: number; life: number; color: string };

export type RunnerFx = {
  particles: Particle[];
  popups: Popup[];
  shake: number;
  flash: number;
  smoke: number;
};

export type RunnerScene = {
  world: RunnerWorld;
  fx: RunnerFx;
  mode: RunnerMode;
  width: number;
  height: number;
  reducedMotion: boolean;
};

const STAR = '#3a3656';
const STAR_LIT = '#b7b1f2';
const RECORD = '#0d0c15';
const RECORD_GROOVE = '#17152a';
const RECORD_RIM = '#302b4d';
const RECORD_SHEEN = '#3a3560';
const LIP = '#4a456e';
const UNDER_LIP = '#211d35';
const TILE_A = '#17142a';
const TILE_B = '#1b1830';
const GROUT = '#100e1d';
const MARKER = '#a29ce5';
const SHADOW = '#0e0c1a';
const CRUMBS = ['#a8622a', '#d38c45', '#f0c27a'];
const FEVER = '#ffd36b';
const FEVER_HOT = '#ff9a4a';
const FEVER_PALE = '#fff4cf';
const METER_EMPTY = '#2a2645';
const METER_CHARGE = '#a29ce5';
const SECTION_LABELS: Record<SectionKind, string> = {
  intro: '',
  verse: 'VERSE',
  chorus: 'CHORUS',
  breakdown: 'BREAKDOWN',
  drop: 'DROP!',
};
/** Beats a section's name stays up once the section starts. */
const BANNER_BEATS = 3;
const POPUP_LIFE = 0.75;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function createFx(): RunnerFx {
  return { particles: [], popups: [], shake: 0, flash: 0, smoke: 0 };
}

function hash(value: number) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function groundY(height: number) {
  return height - GROUND_MARGIN;
}

/** How hard the current beat hits, from 1 on the beat fading towards 0. */
function beatPulse(beat: number) {
  return Math.exp(-(beat - Math.floor(beat)) * 4);
}

function burst(
  fx: RunnerFx,
  x: number,
  y: number,
  count: number,
  colors: string[],
  spread: number,
  lift: number,
  gravity: number,
  life: number,
  spark = false,
) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = spread * (0.4 + Math.random() * 0.6);
    fx.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - lift,
      gravity,
      life: life * (0.6 + Math.random() * 0.4),
      max: life,
      color: colors[index % colors.length],
      spark: spark && index % 3 === 0,
    });
  }
}

function toastTop(world: RunnerWorld, height: number, image: Sprite) {
  return groundY(height) - image.height - Math.round(world.lift);
}

export function applyCues(fx: RunnerFx, cues: RunnerCue[], world: RunnerWorld, height: number) {
  const feet = groundY(height);
  for (const cue of cues) {
    switch (cue.type) {
      case 'jump':
        burst(fx, TOAST_CENTER - 2, feet - 1, 5, CRUMBS, 24, 14, 160, 0.4);
        break;
      case 'land':
        burst(fx, TOAST_CENTER, feet - 1, 6, CRUMBS, 30, 16, 180, 0.35);
        break;
      case 'judge': {
        const y = toastTop(world, height, TOAST_JUMP) - 9;
        if (cue.grade === 'perfect') {
          fx.popups.push({ text: 'PERFECT', x: TOAST_CENTER, y, life: POPUP_LIFE, color: '#ffe3a3' });
          burst(fx, TOAST_CENTER, y + 11, 12, ['#ffe3a3', '#ece9ff', '#a29ce5'], 50, 8, 40, 0.5, true);
        } else if (cue.grade === 'good') {
          fx.popups.push({ text: 'GOOD', x: TOAST_CENTER, y, life: POPUP_LIFE, color: '#b7b1f2' });
          burst(fx, TOAST_CENTER, y + 11, 5, ['#b7b1f2', '#8b84d8'], 32, 6, 40, 0.35);
        } else {
          fx.popups.push({ text: 'OFF BEAT', x: TOAST_CENTER, y, life: POPUP_LIFE, color: '#7b7796' });
        }
        break;
      }
      case 'note': {
        const x = TOAST_CENTER + eventOffset(world, cue.event);
        const y = feet - noteLift();
        burst(fx, x, y, 14, ['#ece9ff', '#a29ce5', '#8b84d8'], 54, 4, 30, 0.55, true);
        fx.popups.push({ text: `+${cue.points}`, x, y: y - 11, life: POPUP_LIFE, color: '#ece9ff' });
        break;
      }
      case 'fever': {
        if (!cue.on) break;
        const y = toastTop(world, height, TOAST_JUMP) - 17;
        fx.popups.push({ text: 'FEVER!', x: TOAST_CENTER + 4, y, life: POPUP_LIFE * 1.6, color: FEVER });
        burst(fx, TOAST_CENTER, y + 14, 22, [FEVER, FEVER_HOT, FEVER_PALE], 72, 10, 30, 0.8, true);
        fx.flash = Math.max(fx.flash, 0.08);
        break;
      }
      case 'section':
        // The drop lands with a jolt.
        if (cue.kind === 'drop') fx.shake = Math.max(fx.shake, 0.14);
        break;
      case 'crash': {
        const y = toastTop(world, height, TOAST_BURNT);
        burst(fx, TOAST_CENTER, y + 2, 14, ['#6b6880', '#4a4760', '#8a8799'], 18, 34, -20, 1.1);
        burst(fx, TOAST_CENTER, y + 6, 10, [...CRUMBS, '#ff7a3d'], 64, 34, 180, 0.65);
        fx.shake = 0.3;
        fx.flash = 0.18;
        break;
      }
      default:
        break;
    }
  }
}

/** Keeps a thin line of smoke rising from the burnt toast while the run is over. */
export function smoulder(fx: RunnerFx, height: number, dt: number) {
  fx.smoke += dt;
  while (fx.smoke > 0.14) {
    fx.smoke -= 0.14;
    const top = groundY(height) - TOAST_BURNT.height;
    fx.particles.push({
      x: TOAST_CENTER - 2 + Math.random() * 4,
      y: top + 1,
      vx: 3 + Math.random() * 4,
      vy: -10 - Math.random() * 6,
      gravity: -4,
      life: 1.4,
      max: 1.4,
      color: Math.random() < 0.5 ? '#4e4a62' : '#3a3750',
      spark: false,
    });
  }
}

export function updateFx(fx: RunnerFx, dt: number) {
  for (const particle of fx.particles) {
    particle.life -= dt;
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }
  fx.particles = fx.particles.filter((particle) => particle.life > 0);
  for (const popup of fx.popups) {
    popup.life -= dt;
    popup.y -= 14 * dt;
  }
  fx.popups = fx.popups.filter((popup) => popup.life > 0);
  fx.shake = Math.max(0, fx.shake - dt);
  fx.flash = Math.max(0, fx.flash - dt);
}

export function clearFx(fx: RunnerFx) {
  fx.particles = [];
  fx.popups = [];
  fx.shake = 0;
  fx.flash = 0;
  fx.smoke = 0;
}

function bayer(x: number, y: number) {
  return (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

// Backdrops only change with the size of the view and the time of day, so each one is painted
// once and kept. Only a handful are ever alive at a time.
const backdrops = new Map<string, HTMLCanvasElement>();

function cachedCanvas(key: string, width: number, height: number, paint: (image: ImageData) => void) {
  const found = backdrops.get(key);
  if (found) return found;
  if (backdrops.size > 32) backdrops.clear();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const image = ctx.createImageData(width, height);
    paint(image);
    ctx.putImageData(image, 0, 0);
  }
  backdrops.set(key, canvas);
  return canvas;
}

function put(image: ImageData, x: number, y: number, color: number[]) {
  const offset = (y * image.width + x) * 4;
  image.data[offset] = color[0];
  image.data[offset + 1] = color[1];
  image.data[offset + 2] = color[2];
  image.data[offset + 3] = 255;
}

/**
 * The sky, with ordered dithering between bands the way old consoles faked gradients. While the
 * time of day changes, the next sky dissolves in through the same kind of pattern, a step a beat.
 */
function skyCanvas(width: number, height: number, time: TimeOfDay) {
  const key = `sky:${width}x${height}:${time.from}:${time.to}:${time.step}`;
  return cachedCanvas(key, width, height, (image) => {
    const from = THEMES[time.from].sky.map(rgbOf);
    const to = THEMES[time.to].sky.map(rgbOf);
    const reveal = time.step / TRANSITION_STEPS;
    const horizon = groundY(height);
    for (let y = 0; y < height; y += 1) {
      const position = Math.min(1, y / horizon) * (from.length - 1);
      const band = Math.floor(position);
      const blend = position - band;
      for (let x = 0; x < width; x += 1) {
        const stops = bayer(x + 2, y + 1) < reveal ? to : from;
        put(image, x, y, stops[Math.min(stops.length - 1, blend > bayer(x, y) ? band + 1 : band)]);
      }
    }
  });
}

function recordShape(width: number, height: number) {
  const horizon = groundY(height);
  const radius = Math.max(12, Math.min(30, Math.round(horizon * 0.3)));
  return {
    radius,
    x: width - radius - Math.max(10, Math.round(width * 0.12)),
    y: Math.round(horizon * 0.4),
  };
}

const HALO = 4;

function recordCanvas(radius: number, theme: Theme) {
  const size = (radius + HALO) * 2 + 1;
  const key = `record:${radius}:${theme.label}:${theme.labelRing}:${theme.glow}:${theme.glowStrength.toFixed(2)}`;
  return cachedCanvas(key, size, size, (image) => {
    const centre = radius + HALO;
    const label = radius * 0.34;
    const colors = {
      body: rgbOf(RECORD),
      groove: rgbOf(RECORD_GROOVE),
      rim: rgbOf(RECORD_RIM),
      label: rgbOf(theme.label),
      ring: rgbOf(theme.labelRing),
      glow: rgbOf(theme.glow),
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const distance = Math.hypot(x - centre, y - centre);
        if (distance > radius + 0.3) {
          // By day the record stands in for the sun, with a dithered halo round it.
          const falloff = 1 - (distance - radius) / HALO;
          if (falloff > 0 && theme.glowStrength * falloff * 0.7 > bayer(x, y)) put(image, x, y, colors.glow);
          continue;
        }
        let color: number[];
        if (distance > radius - 0.7) color = colors.rim;
        else if (distance <= 1.2) color = colors.body;
        else if (distance <= label - 1) color = colors.label;
        else if (distance <= label) color = colors.ring;
        else color = Math.floor(distance) % 2 === 0 ? colors.groove : colors.body;
        put(image, x, y, color);
      }
    }
  });
}

/** A vinyl record where the moon would be. Light catches its grooves as it spins with the beat. */
function drawRecord(ctx: CanvasRenderingContext2D, scene: RunnerScene, theme: Theme) {
  const { world, width, height, reducedMotion } = scene;
  const { radius, x, y } = recordShape(width, height);
  ctx.drawImage(recordCanvas(radius, theme), x - radius - HALO, y - radius - HALO);
  const angle = reducedMotion ? -0.7 : -0.7 + (world.beat * Math.PI) / 4;
  ctx.fillStyle = RECORD_SHEEN;
  for (const side of [angle, angle + Math.PI]) {
    for (let ring = Math.ceil(radius * 0.42); ring <= radius - 2; ring += 1) {
      if (ring % 2 === 1) continue;
      const step = 1 / ring;
      for (let turn = -0.2; turn <= 0.2; turn += step) {
        ctx.fillRect(Math.round(x + Math.cos(side + turn) * ring), Math.round(y + Math.sin(side + turn) * ring), 1, 1);
      }
    }
  }
  // A mark on the label shows the spin even where the grooves are hidden.
  const mark = radius * 0.2;
  ctx.fillStyle = mix(theme.label, '#ffffff', 0.6);
  ctx.fillRect(Math.round(x + Math.cos(angle) * mark), Math.round(y + Math.sin(angle) * mark), 1, 1);
}

/** Far-off pixels drifting slowly; a few catch the beat as it passes. */
function drawStars(ctx: CanvasRenderingContext2D, scene: RunnerScene, theme: Theme) {
  const { world, width, height, reducedMotion } = scene;
  if (theme.stars <= 0) return;
  ctx.globalAlpha = theme.stars;
  const skyBottom = Math.round(groundY(height) * 0.55);
  const cell = 11;
  const scroll = world.beat * PX_PER_BEAT * 0.04;
  for (let index = Math.floor(scroll / cell); index * cell - scroll < width; index += 1) {
    if (hash(index + 300) < 0.45) continue;
    const x = Math.round(index * cell - scroll + hash(index + 400) * (cell - 2));
    const y = 2 + Math.round(hash(index + 500) * (skyBottom - 2));
    const lit = !reducedMotion && (Math.floor(world.beat) + index) % 9 === 0;
    ctx.fillStyle = lit ? STAR_LIT : STAR;
    ctx.fillRect(x, y, 1, 1);
    if (lit && hash(index + 600) > 0.5) {
      ctx.fillStyle = STAR;
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y - 1, 1, 1);
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawCity(ctx: CanvasRenderingContext2D, scene: RunnerScene, theme: Theme) {
  const { world, width, height } = scene;
  const horizon = groundY(height);
  const tallest = Math.round(horizon * 0.46);
  const cell = 9;
  const scroll = world.beat * PX_PER_BEAT * 0.1;
  for (let index = Math.floor(scroll / cell) - 1; index * cell - scroll < width; index += 1) {
    if (hash(index + 900) < 0.16) continue;
    const left = Math.round(index * cell - scroll);
    const buildingWidth = 6 + Math.floor(hash(index + 1000) * 4);
    const district = 0.55 + 0.45 * hash(Math.floor(index / 4) + 1200);
    const buildingHeight = Math.round(tallest * (0.3 + 0.7 * hash(index + 1100) * district));
    const top = horizon - buildingHeight;
    ctx.fillStyle = theme.city;
    ctx.fillRect(left, top, buildingWidth, buildingHeight);
    if (buildingHeight > tallest * 0.7 && hash(index + 1300) > 0.5) {
      ctx.fillRect(left + Math.floor(buildingWidth / 2), top - 3, 1, 3);
    }
    for (let row = 2; row < buildingHeight - 3; row += 3) {
      for (let column = 1; column < buildingWidth - 1; column += 2) {
        const light = hash(index * 97 + row * 13 + column * 7);
        if (light < 1 - theme.windows) continue;
        ctx.fillStyle = light > 1 - theme.windows / 4 ? theme.windowWarm : theme.windowCool;
        ctx.fillRect(left + column, top + row, 1, 1);
      }
    }
  }
}

/** Equalizer bars along the horizon, bouncing with the kick. */
function drawBars(ctx: CanvasRenderingContext2D, scene: RunnerScene, theme: Theme, pulse: number, fever: boolean) {
  const { world, width, height, reducedMotion } = scene;
  const horizon = groundY(height);
  const scroll = world.beat * PX_PER_BEAT * 0.3;
  const first = Math.floor(scroll / 4);
  const tallest = Math.max(8, Math.floor(horizon * 0.3));
  const bounce = reducedMotion ? 0.85 : fever ? 0.6 + 0.55 * pulse : 0.7 + 0.3 * pulse;
  const lit = fever ? FEVER : theme.accent;
  const cap = fever ? mix(theme.barTop, FEVER, 0.6) : theme.barTop;
  for (let index = first; index * 4 - scroll < width; index += 1) {
    const x = Math.round(index * 4 - scroll);
    const base = 2 + Math.round((hash(index) * 0.55 + hash(Math.floor(index / 3) + 50) * 0.45) * tallest);
    const barHeight = Math.max(2, Math.round(base * bounce));
    for (let row = 0; row < barHeight; row += 2) {
      const top = row + 2 >= barHeight;
      ctx.fillStyle = top ? (pulse > 0.75 && !reducedMotion ? lit : cap) : theme.bar;
      ctx.fillRect(x, horizon - 2 - row, 3, 1);
    }
  }
}

/** The counter top: a lip that flashes on the beat over a run of tiles whose seams mark the beats. */
function drawCounter(ctx: CanvasRenderingContext2D, scene: RunnerScene, theme: Theme, pulse: number, fever: boolean) {
  const { world, width, height, reducedMotion } = scene;
  const beatSeam = mix(GROUT, theme.accent, 0.35);
  const ground = groundY(height);
  const scroll = world.beat * PX_PER_BEAT;
  const bottom = height + 4;

  ctx.fillStyle = TILE_A;
  ctx.fillRect(-4, ground + 2, width + 8, bottom - ground);

  // Two courses of tiles, the lower one offset by half a tile.
  const tile = PX_PER_BEAT / 4;
  const courses = [
    { top: ground + 2, shift: 0 },
    { top: ground + 7, shift: tile / 2 },
  ];
  for (const [courseIndex, course] of courses.entries()) {
    const courseHeight = courseIndex === 0 ? 4 : bottom - course.top;
    const first = Math.floor((scroll - course.shift) / tile) - 1;
    for (let index = first; (index * tile + course.shift) - scroll < width + tile; index += 1) {
      const x = Math.round(index * tile + course.shift - scroll);
      if (index % 2 === 0) {
        ctx.fillStyle = TILE_B;
        ctx.fillRect(x + 1, course.top, tile - 1, courseHeight);
      }
      ctx.fillStyle = courseIndex === 0 && index % 4 === 0 ? beatSeam : GROUT;
      ctx.fillRect(x, course.top, 1, courseHeight);
    }
    ctx.fillStyle = GROUT;
    ctx.fillRect(-4, course.top + courseHeight, width + 8, 1);
  }

  // The beat seams line up with the spot that reaches the toast on each beat.
  ctx.fillStyle = UNDER_LIP;
  ctx.fillRect(-4, ground + 1, width + 8, 1);
  ctx.fillStyle = fever ? mix(LIP, FEVER, 0.45) : LIP;
  ctx.fillRect(-4, ground, width + 8, 1);
  if (!reducedMotion && scene.mode === 'running' && pulse > 0.05) {
    ctx.globalAlpha = fever ? Math.min(1, pulse * 1.2) : pulse * 0.75;
    ctx.fillStyle = fever ? FEVER_PALE : mix(theme.accent, '#ffffff', 0.4);
    ctx.fillRect(-4, ground, width + 8, 1);
    ctx.globalAlpha = 1;
  }
}

/** A small arrow on the counter where the jump for an obstacle should start. */
function drawMarker(ctx: CanvasRenderingContext2D, scene: RunnerScene, event: RunnerEvent) {
  const { world, height } = scene;
  if (event.resolved || event.pressOffset !== null) return;
  const x = Math.round(TOAST_CENTER + (event.pressBeat - world.beat) * PX_PER_BEAT);
  const ground = groundY(height);
  const near = Math.abs(event.pressBeat - world.beat) < 0.12;
  ctx.fillStyle = near ? '#ece9ff' : MARKER;
  ctx.globalAlpha = near ? 1 : 0.6;
  ctx.fillRect(x - 1, ground + 2, 3, 1);
  ctx.fillRect(x, ground + 3, 1, 1);
  ctx.globalAlpha = 1;
}

function drawObstacle(ctx: CanvasRenderingContext2D, scene: RunnerScene, event: RunnerEvent, pulse: number) {
  if (!event.kind) return;
  const image = OBSTACLE_SPRITES[event.kind];
  const left = Math.round(TOAST_CENTER + eventOffset(scene.world, event) - image.width / 2);
  const top = groundY(scene.height) - image.height;
  ctx.fillStyle = SHADOW;
  ctx.fillRect(left, top + image.height, image.width, 1);
  drawSprite(ctx, image, left, top);
  if (scene.reducedMotion) return;

  if (event.kind === 'toaster') {
    // The slots glow hotter on the beat, and heat rises off them.
    ctx.globalAlpha = pulse * 0.85;
    ctx.fillStyle = '#ffd9a1';
    for (const [x, y] of TOASTER_SLOTS) ctx.fillRect(left + x, top + y, 1, 1);
    const rise = scene.world.beat - Math.floor(scene.world.beat);
    ctx.globalAlpha = (1 - rise) * 0.55;
    ctx.fillStyle = '#ff9445';
    ctx.fillRect(left + 4, top - 1 - Math.floor(rise * 5), 1, 1);
    ctx.fillRect(left + 10, top - 2 - Math.floor(rise * 5), 1, 1);
    ctx.globalAlpha = 1;
  } else if ((event.kind === 'eq' || event.kind === 'eqWide') && pulse > 0.2) {
    // Equalizer obstacles light up on the beat, like a meter catching the kick.
    ctx.globalAlpha = (pulse - 0.2) * 0.9;
    ctx.fillStyle = '#ffffff';
    for (let column = 0; column < image.width; column += 4) {
      const topRow = image.rows.findIndex((row) => row[column] !== '.');
      if (topRow >= 0) ctx.fillRect(left + column, top + topRow, 3, 1);
    }
    ctx.globalAlpha = 1;
  }
}

function drawNote(ctx: CanvasRenderingContext2D, scene: RunnerScene, event: RunnerEvent, pulse: number) {
  if (event.collected) return;
  const { world, height, reducedMotion } = scene;
  const bob = reducedMotion ? 0 : Math.round(Math.sin(world.beat * Math.PI) * 1.2);
  const x = Math.round(TOAST_CENTER + eventOffset(world, event) - NOTE.width / 2);
  const y = Math.round(groundY(height) - noteLift() - NOTE.height / 2 + bob);
  ctx.globalAlpha = event.resolved ? 0.35 : 1;
  drawSprite(ctx, NOTE, x, y);
  if (!event.resolved && !reducedMotion && pulse > 0.6) {
    // A glint that winks on each beat.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + NOTE.width, y - 1, 1, 1);
    ctx.fillStyle = '#a29ce5';
    ctx.fillRect(x + NOTE.width - 1, y - 1, 1, 1);
    ctx.fillRect(x + NOTE.width + 1, y - 1, 1, 1);
    ctx.fillRect(x + NOTE.width, y - 2, 1, 1);
    ctx.fillRect(x + NOTE.width, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}

function blinking(time: number) {
  return time % 3.4 < 0.12;
}

function toastSprite(scene: RunnerScene): Sprite {
  const { world, mode, reducedMotion } = scene;
  const blink = !reducedMotion && blinking(world.songTime);
  if (mode === 'over') return TOAST_BURNT;
  if (world.lift > 0) return TOAST_JUMP;
  if (mode === 'running' && world.songTime - world.landedAt < 0.09) return TOAST_SQUASH;
  if (mode === 'running') {
    const stride = Math.floor(world.beat * 2) % 2;
    if (stride) return blink ? TOAST_RUN_B_BLINK : TOAST_RUN_B;
    return blink ? TOAST_RUN_A_BLINK : TOAST_RUN_A;
  }
  return blink ? TOAST_STAND_BLINK : TOAST_STAND;
}

/** Streaks behind the toast once the combo is paying a multiplier. */
function drawSpeedLines(ctx: CanvasRenderingContext2D, scene: RunnerScene) {
  const { world, height, mode, reducedMotion } = scene;
  const fever = inFever(world);
  const mult = multiplier(world.combo);
  if (mode !== 'running' || mult < 2 || reducedMotion) return;
  const top = toastTop(world, height, TOAST_RUN_A);
  const seed = Math.floor(world.beat * 4);
  ctx.fillStyle = fever ? FEVER : mult >= 4 ? '#ffe3a3' : '#a29ce5';
  for (let index = 0; index < (fever ? 6 : mult); index += 1) {
    const y = top + 2 + Math.floor(hash(seed * 3 + index) * 8);
    const length = 3 + Math.floor(hash(seed * 5 + index) * 6);
    ctx.globalAlpha = 0.25 + 0.3 * hash(seed * 7 + index);
    ctx.fillRect(TOAST_X - 2 - length, y, length, 1);
  }
  ctx.globalAlpha = 1;
}

function drawToast(ctx: CanvasRenderingContext2D, scene: RunnerScene) {
  const { world, height, mode, reducedMotion } = scene;
  const ground = groundY(height);
  const image = toastSprite(scene);

  // A shadow on the counter that shrinks as the toast rises.
  const shadow = Math.max(4, Math.round(10 - world.lift / 6));
  ctx.fillStyle = SHADOW;
  ctx.fillRect(Math.round(TOAST_CENTER - shadow / 2), ground, shadow, 1);

  if (mode === 'running' && !reducedMotion && inFever(world)) {
    // Gold afterimages trail the toast, each where it was a moment ago.
    for (const [ago, shift, alpha] of [[0.08, 10, 0.18], [0.04, 5, 0.35]]) {
      const lift = Math.max(0, world.lift - world.velocity * ago);
      ctx.globalAlpha = alpha;
      drawSilhouette(ctx, image, TOAST_X - shift, ground - image.height - Math.round(lift), ago > 0.05 ? FEVER_HOT : FEVER);
    }
    ctx.globalAlpha = 1;
  }

  const idleBob = mode === 'idle' && !reducedMotion && world.beat - Math.floor(world.beat) < 0.18 ? 1 : 0;
  drawSprite(ctx, image, TOAST_X, toastTop(world, height, image) - idleBob);
}

function drawSilhouette(ctx: CanvasRenderingContext2D, image: Sprite, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  image.rows.forEach((row, rowIndex) => {
    for (let column = 0; column < row.length; column += 1) {
      if (row[column] !== '.') ctx.fillRect(Math.round(x) + column, Math.round(y) + rowIndex, 1, 1);
    }
  });
}

/** Glints that come and go around the toast while fever lasts, a new set every sixteenth. */
function drawFeverSparkles(ctx: CanvasRenderingContext2D, scene: RunnerScene) {
  const { world, height, mode, reducedMotion } = scene;
  if (mode !== 'running' || reducedMotion || !inFever(world)) return;
  const quarter = world.beat * 4;
  const seed = Math.floor(quarter);
  const age = quarter - seed;
  const top = toastTop(world, height, TOAST_RUN_A);
  for (let index = 0; index < 3; index += 1) {
    const x = TOAST_X - 16 + Math.round(hash(seed * 13 + index) * 30);
    const y = top - 8 + Math.round(hash(seed * 17 + index * 5) * 20);
    ctx.fillStyle = index === 0 ? FEVER_PALE : FEVER;
    ctx.fillRect(x, y, 1, 1);
    if (age < 0.5) {
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y - 1, 1, 1);
      ctx.fillRect(x, y + 1, 1, 1);
      ctx.globalAlpha = 1;
    }
  }
}

/** A warm glow dithered down from the top of the sky while fever lasts. */
function feverGlowCanvas(width: number, height: number, level: number) {
  return cachedCanvas(`fever:${width}x${height}:${level}`, width, height, (image) => {
    const rows = Math.round(groundY(height) * 0.35);
    const gold = rgbOf(FEVER_HOT);
    for (let y = 0; y < rows; y += 1) {
      const strength = (level / 4) * (1 - y / rows) ** 1.5 * 0.45;
      for (let x = 0; x < width; x += 1) {
        if (strength > bayer(x + 1, y + 3)) put(image, x, y, gold);
      }
    }
  });
}

/**
 * Fills as on-beat hits build towards fever, two hits a segment. While fever lasts the segments
 * turn gold and drain away beat by beat.
 */
function drawFeverMeter(ctx: CanvasRenderingContext2D, scene: RunnerScene, pulse: number) {
  const { world, mode, reducedMotion } = scene;
  if (mode !== 'running' && mode !== 'paused') return;
  const fever = inFever(world);
  const level = feverLevel(world);
  if (!fever && level <= 0) return;
  const segments = 12;
  const filled = fever ? Math.ceil(level * segments) : Math.floor(level * segments);
  const left = 4;
  const top = 4;
  ctx.fillStyle = '#0b0a12';
  ctx.fillRect(left - 1, top - 1, segments * 3 + 1, 4);
  for (let index = 0; index < segments; index += 1) {
    const lit = index < filled;
    ctx.fillStyle = !lit ? METER_EMPTY : fever ? (pulse > 0.6 && !reducedMotion ? FEVER_PALE : FEVER) : METER_CHARGE;
    ctx.fillRect(left + index * 3, top, 2, 2);
  }
  if (fever && (reducedMotion || Math.floor(world.beat * 2) % 2 === 0 || level > 0.25)) {
    drawText(ctx, 'FEVER', left, top + 4, FEVER);
  }
}

/** Names each section for a moment as it starts. The drop gets it in big letters. */
function drawSectionBanner(ctx: CanvasRenderingContext2D, scene: RunnerScene, theme: Theme) {
  const { world, width, mode, reducedMotion } = scene;
  if (mode !== 'running') return;
  const section = Math.floor(world.beat / BEATS_PER_SECTION);
  const into = world.beat - section * BEATS_PER_SECTION;
  const kind = sectionKind(section);
  const text = SECTION_LABELS[kind];
  if (!text || into >= BANNER_BEATS) return;
  // Blinks out over the last half beat, like the popups.
  if (into > BANNER_BEATS - 0.5 && Math.floor(into * 8) % 2) return;
  const scale = kind === 'drop' ? 2 : 1;
  const textW = textWidth(text) * scale;
  const drop = reducedMotion ? 0 : Math.round(Math.max(0, 1 - into * 4) * 6);
  const x = Math.round((width - textW) / 2);
  const y = 4 - drop;
  const grow = reducedMotion ? 1 : Math.min(1, into * 2);
  const rule = Math.round(10 * grow);
  const middle = y + Math.floor((5 * scale) / 2);
  ctx.fillStyle = mix(theme.accent, '#ffffff', 0.2);
  ctx.fillRect(x - 3 - rule, middle, rule, 1);
  ctx.fillRect(x + textW + 2, middle, rule, 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  drawText(ctx, text, 0, 0, kind === 'drop' ? '#ffe3a3' : '#ece9ff');
  ctx.restore();
}

function drawEffects(ctx: CanvasRenderingContext2D, fx: RunnerFx) {
  for (const particle of fx.particles) {
    const x = Math.round(particle.x);
    const y = Math.round(particle.y);
    const alpha = Math.max(0, Math.min(1, particle.life / (particle.max * 0.5)));
    ctx.fillStyle = particle.color;
    if (particle.spark) {
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillRect(x - 1, y, 3, 1);
      ctx.fillRect(x, y - 1, 1, 3);
    }
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
  for (const popup of fx.popups) {
    // Popups blink out during their last moments instead of fading, in keeping with the pixels.
    if (popup.life < 0.2 && Math.floor(popup.life * 30) % 2) continue;
    drawText(ctx, popup.text, popup.x - textWidth(popup.text) / 2, popup.y, popup.color);
  }
}

function countText(beat: number) {
  if (beat >= 4 && beat < 8) return ['3', '2', '1', 'GO'][Math.floor(beat) - 4];
  const section = Math.floor(beat / BEATS_PER_SECTION);
  const into = Math.floor(beat - section * BEATS_PER_SECTION);
  if (sectionKind(section) === 'breakdown' && into >= BEATS_PER_SECTION - 4) return String(BEATS_PER_SECTION - into);
  return null;
}

/**
 * Counts the player in over the bar before the first obstacle, and counts the last bar of a
 * breakdown down into the drop, in time with the music.
 */
function drawCountIn(ctx: CanvasRenderingContext2D, scene: RunnerScene) {
  const { world, width, mode } = scene;
  const text = mode === 'running' ? countText(world.beat) : null;
  if (!text) return;
  const fade = world.beat - Math.floor(world.beat);
  if (fade > 0.7) return;
  ctx.save();
  ctx.translate(Math.round(width / 2 - textWidth(text)), Math.round(groundY(scene.height) * 0.2));
  ctx.scale(2, 2);
  drawText(ctx, text, 0, 0, text === 'GO' ? '#ffe3a3' : '#ece9ff');
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: RunnerScene) {
  const { world, fx, width, height, reducedMotion } = scene;
  const pulse = scene.mode === 'running' ? beatPulse(world.beat) : scene.mode === 'idle' ? beatPulse(world.beat) * 0.6 : 0;

  const time = timeOfDay(world.beat, scene.mode !== 'idle');
  const { theme } = time;
  const fever = scene.mode === 'running' && inFever(world);

  ctx.save();
  // The far scenery stays put when the screen shakes.
  ctx.drawImage(skyCanvas(width, height, time), 0, 0);
  if (fever) ctx.drawImage(feverGlowCanvas(width, height, reducedMotion ? 2 : 1 + Math.round(pulse * 3)), 0, 0);
  drawStars(ctx, scene, theme);
  drawRecord(ctx, scene, theme);
  drawCity(ctx, scene, theme);
  drawBars(ctx, scene, theme, pulse, fever);

  if (fx.shake > 0 && !reducedMotion) {
    const strength = Math.ceil(fx.shake * 8);
    ctx.translate(Math.round((Math.random() - 0.5) * strength), Math.round((Math.random() - 0.5) * strength));
  }
  drawCounter(ctx, scene, theme, pulse, fever);
  for (const event of world.events) {
    if (event.type === 'obstacle') drawMarker(ctx, scene, event);
  }
  for (const event of world.events) {
    if (event.type === 'obstacle') drawObstacle(ctx, scene, event, pulse);
    else drawNote(ctx, scene, event, pulse);
  }
  drawSpeedLines(ctx, scene);
  drawToast(ctx, scene);
  drawFeverSparkles(ctx, scene);
  drawEffects(ctx, fx);
  drawCountIn(ctx, scene);
  drawSectionBanner(ctx, scene, theme);
  drawFeverMeter(ctx, scene, pulse);

  if (fx.flash > 0) {
    ctx.globalAlpha = (fx.flash / 0.18) * 0.22;
    ctx.fillStyle = '#ffd7b0';
    ctx.fillRect(-4, -4, width + 8, height + 8);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
