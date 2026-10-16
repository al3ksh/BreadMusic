// Pixel art for the Activity runner. Sprites are strings of palette keys; '.' is transparent.
// Light comes from the top left: highlights sit on the upper left edges, shade on the lower right.

export const PALETTE: Record<string, string> = {
  // Toast
  O: '#4a2914', // outline
  C: '#a8622a', // crust
  c: '#d38c45', // crust highlight
  B: '#f0c27a', // crumb
  b: '#fde2a6', // crumb highlight
  d: '#d9a35e', // crumb shade
  E: '#2a160a', // eyes and mouth
  w: '#fff8e8', // eye glint
  P: '#f2928a', // cheeks
  l: '#8a5228', // legs
  r: '#e0574f', // sneakers
  // Burnt toast
  X: '#140d09', // charred outline
  x: '#33231a', // char
  y: '#4f3829', // char highlight
  z: '#251912', // char shade
  g: '#b9aca2', // ash eyes
  e: '#ff7a3d', // embers
  // Kitchen steel
  K: '#262634', // outline
  S: '#a9adc1', // steel
  s: '#e6e9f5', // steel shine
  T: '#72768d', // steel shade
  h: '#7a2e14', // toaster slot
  H: '#ff9445', // toaster slot glow
  R: '#e0574f', // lever
  o: '#3d3f52', // dial
  W: '#8a5328', // wooden handle
  V: '#5e3719', // handle shade
  v: '#d9d3c7', // rivets
  // Notes and equalizer
  N: '#a29ce5', // note
  n: '#ece9ff', // note shine
  M: '#6c66b8', // note shade
  Q: '#3f3a72', // equalizer, low
  U: '#5d56a6', // equalizer, mid
  u: '#8b84d8', // equalizer, high
  q: '#d6d2ff', // equalizer peak
};

export type Sprite = { rows: string[]; width: number; height: number };

export function sprite(rows: string[]): Sprite {
  return { rows, width: rows[0].length, height: rows.length };
}

/** Places sprites side by side, bottom aligned, with a gap between them. */
function joinSprites(parts: Sprite[], gap: number): Sprite {
  const height = Math.max(...parts.map((part) => part.height));
  const rows = Array.from({ length: height }, (_, rowIndex) => parts.map((part) => {
    const offset = height - part.height;
    return rowIndex < offset ? '.'.repeat(part.width) : part.rows[rowIndex - offset];
  }).join('.'.repeat(gap)));
  return sprite(rows);
}

/** Equalizer columns lit in two-row segments like a hardware meter, cooler at the bottom. */
function equalizer(heights: number[]): Sprite {
  const height = Math.max(...heights);
  const rows = Array.from({ length: height }, (_, rowIndex) => heights.map((barHeight) => {
    const fromTop = rowIndex - (height - barHeight);
    const fromBottom = height - rowIndex;
    if (fromTop < 0) return '...';
    if (fromTop === 0) return 'qqq';
    if (fromBottom % 2 === 0) return '...';
    const key = fromBottom <= 3 ? 'Q' : fromBottom <= 6 ? 'U' : 'u';
    return key.repeat(3);
  }).join('.'));
  return sprite(rows);
}

// Rows 0-10 are the slice, rows 11-12 the legs.
const TOAST_BODY = [
  '..OOOOOOOO..',
  '.OccccccCCO.',
  'OcbbbbbbBBCO',
  'OcbBBBBBBBCO',
  'OCBwBBBBwBCO',
  'OCBEBBBBEBCO',
  'OCPBBEEBBPCO',
  'OCBBBBBBBdCO',
  'OCdBBBBBddCO',
  '.OCCCCCCCCO.',
  '..OOOOOOOO..',
];

// Eyes shut for a blink: the glint row turns to crumb and the pupils stay as a closed line.
const TOAST_BLINK_BODY = TOAST_BODY.map((row, index) => (index === 4 ? row.replace(/w/g, 'B') : row));
// Mid-air the mouth opens.
const TOAST_AIR_BODY = TOAST_BODY.map((row, index) => (index === 7 ? 'OCBBBEEBBdCO' : row));

const LEGS_STAND = ['...l....l...', '...rr...rr..'];
const LEGS_RUN_A = ['..l......l..', '.rr.......rr'];
const LEGS_RUN_B = ['....l..l....', '....rr.rr...'];
const LEGS_JUMP = ['...ll..ll...', '..rr....rr..'];

export const TOAST_STAND = sprite([...TOAST_BODY, ...LEGS_STAND]);
export const TOAST_STAND_BLINK = sprite([...TOAST_BLINK_BODY, ...LEGS_STAND]);
export const TOAST_RUN_A = sprite([...TOAST_BODY, ...LEGS_RUN_A]);
export const TOAST_RUN_B = sprite([...TOAST_BODY, ...LEGS_RUN_B]);
export const TOAST_RUN_A_BLINK = sprite([...TOAST_BLINK_BODY, ...LEGS_RUN_A]);
export const TOAST_RUN_B_BLINK = sprite([...TOAST_BLINK_BODY, ...LEGS_RUN_B]);
export const TOAST_JUMP = sprite([...TOAST_AIR_BODY, ...LEGS_JUMP]);
// Two rows shorter with splayed feet: drawn for a few frames after landing.
export const TOAST_SQUASH = sprite([
  '..OOOOOOOO..',
  'OcbbbbbbbBCO',
  'OcbBBBBBBBCO',
  'OCBwBBBBwBCO',
  'OCBEBBBBEBCO',
  'OCPBBEEBBPCO',
  'OCdBBBBBddCO',
  '.OCCCCCCCCO.',
  '..OOOOOOOO..',
  '..l......l..',
  '.rr......rr.',
]);
export const TOAST_BURNT = sprite([
  '..XXXXXXXX..',
  '.XyyyxxxxzX.',
  'XyxxexxxxxzX',
  'XxxxxxxxxxzX',
  'XxgxgxxgxgzX',
  'XxxgxxxxgxzX',
  'XxgxgxxgxgzX',
  'XxxxxxxxxxzX',
  'XzxxxggxxzzX',
  '.XzzxxxezzX.',
  '..XXXXXXXX..',
  '...l....l...',
  '...rr...rr..',
]);

export const TOAST_WIDTH = TOAST_STAND.width;
export const TOAST_HEIGHT = TOAST_STAND.height;

const TOASTER = sprite([
  '..KKKKKKKKKK..',
  '.KssssssssssK.',
  'KsShHhSSShHhSK',
  'KsSSSSSSSSSRRK',
  'KssSSSSSSSSSTK',
  'KSssSSSSSSoSTK',
  'KSSssSSSSSSSTK',
  'KTTTTTTTTTTTTK',
  'KKKKKKKKKKKKKK',
  '.KK........KK.',
]);

// Toaster slot pixels, so the renderer can make them glow on the beat.
export const TOASTER_SLOTS: [number, number][] = TOASTER.rows.flatMap((row, y) => [...row].flatMap((key, x) => (key === 'H' || key === 'h' ? [[x, y] as [number, number]] : [])));

const KNIFE = sprite([
  '.s.',
  'sS.',
  'sST',
  'sST',
  'sST',
  'sST',
  'sST',
  'sST',
  'KKK',
  'WWV',
  'WvV',
  'WWV',
  'VvV',
]);

export const NOTE = sprite([
  '...nN.',
  '...NMN',
  '...N.M',
  '...N..',
  '.nNN..',
  'nNNM..',
  '.MM...',
]);

export type ObstacleKind = 'knife' | 'knives' | 'toaster' | 'eq' | 'eqWide';

export const OBSTACLE_SPRITES: Record<ObstacleKind, Sprite> = {
  knife: KNIFE,
  knives: joinSprites([KNIFE, KNIFE], 2),
  toaster: TOASTER,
  eq: equalizer([5, 9, 7]),
  eqWide: equalizer([4, 7, 9, 7, 4]),
};

/** Height of the topmost solid pixel in every column, used for pixel-accurate collisions. */
export function columnProfile(image: Sprite): number[] {
  return Array.from({ length: image.width }, (_, column) => {
    const top = image.rows.findIndex((row) => row[column] !== '.');
    return top < 0 ? 0 : image.height - top;
  });
}

// A 3x5 bitmap font for the few words the canvas writes.
const GLYPHS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '#.#', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  ' ': ['...', '...', '...', '...', '...'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
};

export function textWidth(text: string) {
  return text.length * 4 - 1;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, shadow = '#0b0a12') {
  const left = Math.round(x);
  const top = Math.round(y);
  for (const [fill, offset] of [[shadow, 1], [color, 0]] as const) {
    ctx.fillStyle = fill;
    [...text.toUpperCase()].forEach((char, index) => {
      const glyph = GLYPHS[char];
      if (!glyph) return;
      glyph.forEach((row, rowIndex) => {
        for (let column = 0; column < 3; column += 1) {
          if (row[column] === '#') ctx.fillRect(left + index * 4 + column + offset, top + rowIndex + offset, 1, 1);
        }
      });
    });
  }
}

// Each sprite is painted once into a canvas of its own and then stamped, rather than filling
// every pixel every frame.
const painted = new WeakMap<Sprite, HTMLCanvasElement>();

function paint(image: Sprite) {
  let canvas = painted.get(image);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    image.rows.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        const color = PALETTE[row[column]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(column, rowIndex, 1, 1);
      }
    });
  }
  painted.set(image, canvas);
  return canvas;
}

export function drawSprite(ctx: CanvasRenderingContext2D, image: Sprite, x: number, y: number) {
  ctx.drawImage(paint(image), Math.round(x), Math.round(y));
}
