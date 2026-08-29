const sharp = require('sharp');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { buildArcadeSvg } = require('./arcadeRenderer');

const WIDTH = 800;
const HEIGHT = 467;
const MAX_BYTES = 7_500_000;
const SLOT_SYMBOLS = ['🍞', '🍒', '🔔', '💎', '7️⃣'];

async function encodeFrames(frames) {
  const gif = GIFEncoder();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const rgba = await sharp(Buffer.from(buildArcadeSvg(frame.input)))
      .resize(WIDTH, HEIGHT).ensureAlpha().raw().toBuffer();
    const palette = quantize(rgba, 128, { format: 'rgb444' });
    const indexed = applyPalette(rgba, palette, 'rgb444');
    gif.writeFrame(indexed, WIDTH, HEIGHT, {
      palette,
      delay: frame.delay,
      repeat: index === 0 ? -1 : undefined,
    });
  }
  gif.finish();
  const output = Buffer.from(gif.bytes());
  if (output.length > MAX_BYTES) throw new Error(`Animation exceeds ${MAX_BYTES} bytes`);
  return output;
}

function renderSlotsAnimation(input) {
  const frameCount = 15;
  const settleAt = [frameCount - 6, frameCount - 3, frameCount - 1];
  return encodeFrames(Array.from({ length: frameCount }, (_, index) => {
    const finished = index === frameCount - 1;
    const symbols = input.data.symbols.map((target, reel) => (
      index >= settleAt[reel] ? target : SLOT_SYMBOLS[(index * 2 + reel * 3) % SLOT_SYMBOLS.length]
    ));
    return {
      input: {
        ...input,
        status: finished ? input.status : 'SPINNING',
        detail: finished ? input.detail : 'The reels are slowing down',
        accent: finished ? input.accent : '#8f82eb',
        data: { ...input.data, symbols },
      },
      delay: finished ? 1400 : 90,
    };
  }));
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function renderRouletteAnimation(input) {
  const frameCount = 20;
  return encodeFrames(Array.from({ length: frameCount }, (_, index) => {
    const eased = easeOutCubic(index / (frameCount - 1));
    const finished = index === frameCount - 1;
    return {
      input: {
        ...input,
        status: finished ? input.status : 'SPINNING',
        detail: finished ? input.detail : 'The wheel is in motion',
        accent: finished ? input.accent : '#8f82eb',
        data: {
          ...input.data,
          number: finished ? input.data.number : '?',
          color: finished ? input.data.color : 'black',
          ballAngle: -Math.PI / 2 + (1 - eased) * Math.PI * 8,
          rotation: -(1 - eased) * 720,
        },
      },
      delay: finished ? 1400 : 85,
    };
  }));
}

function renderCoinflipAnimation(input) {
  const frameCount = 16;
  return encodeFrames(Array.from({ length: frameCount }, (_, index) => {
    const finished = index === frameCount - 1;
    const angle = index * Math.PI * 0.72;
    return {
      input: {
        ...input,
        status: finished ? input.status : 'FLIPPING',
        detail: finished ? input.detail : 'The coin is in the air',
        accent: finished ? input.accent : '#8f82eb',
        data: {
          ...input.data,
          result: finished ? input.data.result : (Math.cos(angle) >= 0 ? 'heads' : 'tails'),
          scaleX: finished ? 1 : Math.cos(angle),
        },
      },
      delay: finished ? 1400 : 85,
    };
  }));
}

function renderDiceAnimation(input) {
  const frameCount = 13;
  const sides = Math.max(2, Number.parseInt(String(input.data.notation || 'd6').split('d')[1], 10) || 6);
  const target = input.data.rolls;
  return encodeFrames(Array.from({ length: frameCount }, (_, index) => {
    const finished = index === frameCount - 1;
    const rolls = finished ? target : target.map((_, dieIndex) => ((index * 7 + dieIndex * 11) % sides) + 1);
    return {
      input: {
        ...input,
        status: finished ? input.status : 'ROLLING',
        detail: finished ? input.detail : `${input.data.notation} is rolling`,
        accent: finished ? input.accent : '#8f82eb',
        data: { ...input.data, rolls },
      },
      delay: finished ? 1400 : 90,
    };
  }));
}

const renderers = {
  slots: renderSlotsAnimation,
  roulette: renderRouletteAnimation,
  coinflip: renderCoinflipAnimation,
  dice: renderDiceAnimation,
};

function renderAnimation(type, input) {
  const renderer = renderers[type];
  if (!renderer) throw new Error(`Unknown animation type: ${type}`);
  return renderer(input);
}

module.exports = { WIDTH, HEIGHT, renderAnimation };
