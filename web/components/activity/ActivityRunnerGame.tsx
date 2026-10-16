'use client';

import { useEffect, useRef, useState } from 'react';

// A small endless runner for the Activity error screens: a slice of toast jumps over kitchen hazards.
// Everything is drawn on a low-resolution canvas that CSS scales up with pixelated rendering.

const WIDTH = 200;
const HEIGHT = 64;
const GROUND = 54;
const GRAVITY = 1400;
const JUMP_VELOCITY = -330;
const JUMP_CUT_VELOCITY = -120;
const START_SPEED = 95;
const MAX_SPEED = 210;
const SPEED_RAMP = 3;
const BEST_KEY = 'bread-activity-runner-best';

const PALETTE: Record<string, string> = {
  C: '#8a5a2b', // crust
  B: '#e8b765', // crumb
  b: '#f6d898', // crumb highlight
  E: '#2a1b10', // eyes, mouth, feet
  P: '#f19a9a', // cheeks
  K: '#3b3c47', // outline
  S: '#b9bccb', // steel
  s: '#e6e8f2', // steel shine
  D: '#17171b', // slot
  R: '#d9534f', // lever
  W: '#7b4a26', // wooden handle
  N: '#5a5494', // notes
  G: '#2c2c33', // ground speckle
};

type Sprite = { rows: string[]; width: number; height: number };

function sprite(rows: string[]): Sprite {
  return { rows, width: rows[0].length, height: rows.length };
}

const TOAST_BODY = [
  '..CCCCCCCC..',
  '.CbbBBBBBBC.',
  'CbBBBBBBBBBC',
  'CBBBBBBBBBBC',
  'CBBEBBBBEBBC',
  'CBPEBBBBEPBC',
  'CBBBBEEBBBBC',
  'CBBBBBBBBBBC',
  '.CBBBBBBBBC.',
  '.CCCCCCCCCC.',
];
const TOAST_RUN_A = sprite([...TOAST_BODY, '..E......E..', '..E.......E.']);
const TOAST_RUN_B = sprite([...TOAST_BODY, '...E....E...', '..E.....E...']);
const TOAST_JUMP = sprite([...TOAST_BODY, '..E......E..', '.E........E.']);
const TOAST_HIT = sprite([
  '..CCCCCCCC..',
  '.CbbBBBBBBC.',
  'CbBBBBBBBBBC',
  'CBBBBBBBBBBC',
  'CBEBEBBEBEBC',
  'CBBEBBBBEBBC',
  'CBEBEBBEBEBC',
  'CBBBBEEBBBBC',
  '.CBBBEEBBBC.',
  '.CCCCCCCCCC.',
  '..E......E..',
  '..E......E..',
]);

const TOASTER = sprite([
  '.KKKKKKKKKKKK.',
  'KsssssssssssSK',
  'KsDDDDSSDDDDSK',
  'KSSSSSSSSSSSSK',
  'KsSSSSSSSSSRSK',
  'KsSSSSSSSSSRSK',
  'KsSSSSSSSSSSSK',
  'KSSSSSSSSSSSSK',
  'KKKKKKKKKKKKKK',
  '.K..........K.',
]);

const KNIFE = sprite([
  '..s..',
  '.sS..',
  '.sSS.',
  '.sSS.',
  '.sSS.',
  '.sSS.',
  '.sSS.',
  '.sSS.',
  '.KKK.',
  '.WWW.',
  '.WWW.',
  '.WWW.',
  '.WWW.',
]);

const NOTE = sprite([
  '...NN.',
  '...N.N',
  '...N..',
  '...N..',
  '.NNN..',
  'NNNN..',
  '.NN...',
]);

const OBSTACLES = [
  { sprite: TOASTER, count: 1 },
  { sprite: KNIFE, count: 1 },
  { sprite: KNIFE, count: 2 },
  { sprite: TOASTER, count: 2 },
];

type Obstacle = { x: number; sprite: Sprite; count: number };
type Note = { x: number; y: number };
type GameState = 'idle' | 'running' | 'paused' | 'over';

function drawSprite(ctx: CanvasRenderingContext2D, image: Sprite, x: number, y: number) {
  const left = Math.round(x);
  const top = Math.round(y);
  image.rows.forEach((row, rowIndex) => {
    for (let column = 0; column < row.length; column += 1) {
      const color = PALETTE[row[column]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + column, top + rowIndex, 1, 1);
    }
  });
}

function readBest() {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(value: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be blocked inside the Discord iframe; the best score then lasts for the session.
  }
}

const HINTS: Record<GameState, string> = {
  idle: 'Press space or tap to play',
  running: '',
  paused: 'Paused. Tap to continue',
  over: 'Burnt! Tap to try again',
};

export function ActivityRunnerGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scoreRef = useRef<HTMLSpanElement | null>(null);
  const pressRef = useRef<(() => void) | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<GameState>('idle');
  const [best, setBest] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let gameState: GameState = 'idle';
    let y = GROUND - TOAST_RUN_A.height;
    let velocity = 0;
    let speed = START_SPEED;
    let distance = 0;
    let nextSpawn = 0;
    let obstacles: Obstacle[] = [];
    let notes: Note[] = [{ x: 40, y: 12 }, { x: 110, y: 22 }, { x: 170, y: 8 }];
    let groundOffset = 0;
    let bestScore = readBest();
    let frame = 0;
    let last = 0;
    setBest(bestScore);

    const toastX = 18;
    const grounded = () => y >= GROUND - TOAST_RUN_A.height;
    const score = () => Math.floor(distance / 10);
    const changeState = (next: GameState) => {
      gameState = next;
      setState(next);
    };

    const reset = () => {
      y = GROUND - TOAST_RUN_A.height;
      velocity = 0;
      speed = START_SPEED;
      distance = 0;
      nextSpawn = 0;
      obstacles = [];
    };

    const draw = () => {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      notes.forEach((note) => {
        ctx.globalAlpha = 0.45;
        drawSprite(ctx, NOTE, note.x, note.y);
      });
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#5a5a6a';
      ctx.fillRect(0, GROUND, WIDTH, 1);
      ctx.fillStyle = PALETTE.G;
      for (let x = -(groundOffset % 17); x < WIDTH; x += 17) {
        ctx.fillRect(Math.round(x), GROUND + 3, 2, 1);
        ctx.fillRect(Math.round(x + 9), GROUND + 5, 1, 1);
      }

      obstacles.forEach((obstacle) => {
        for (let index = 0; index < obstacle.count; index += 1) {
          drawSprite(ctx, obstacle.sprite, obstacle.x + index * (obstacle.sprite.width + 1), GROUND - obstacle.sprite.height);
        }
      });

      const toast = gameState === 'over'
        ? TOAST_HIT
        : !grounded()
          ? TOAST_JUMP
          : gameState === 'running' && Math.floor(distance / 8) % 2 ? TOAST_RUN_B : TOAST_RUN_A;
      drawSprite(ctx, toast, toastX, y + (TOAST_RUN_A.height - toast.height));
    };

    const update = (dt: number) => {
      speed = Math.min(MAX_SPEED, speed + SPEED_RAMP * dt);
      const step = speed * dt;
      distance += step;
      groundOffset += step;

      velocity += GRAVITY * dt;
      y = Math.min(GROUND - TOAST_RUN_A.height, y + velocity * dt);
      if (grounded()) velocity = 0;

      notes = notes.map((note) => ({ ...note, x: note.x - step * 0.25 }));
      notes = notes.map((note) => (note.x < -NOTE.width ? { x: WIDTH + Math.random() * 30, y: 6 + Math.random() * 18 } : note));

      obstacles = obstacles
        .map((obstacle) => ({ ...obstacle, x: obstacle.x - step }))
        .filter((obstacle) => obstacle.x + obstacle.count * (obstacle.sprite.width + 1) > 0);

      nextSpawn -= step;
      if (nextSpawn <= 0) {
        const options = speed < 130 ? OBSTACLES.slice(0, 3) : OBSTACLES;
        const pick = options[Math.floor(Math.random() * options.length)];
        obstacles.push({ x: WIDTH + 4, sprite: pick.sprite, count: pick.count });
        nextSpawn = speed * (0.7 + Math.random() * 0.8) + 30;
      }

      const toastBox = { left: toastX + 2, right: toastX + TOAST_RUN_A.width - 2, top: y + 1, bottom: y + TOAST_RUN_A.height - 1 };
      const hit = obstacles.some((obstacle) => {
        const left = obstacle.x + 1;
        const right = obstacle.x + obstacle.count * (obstacle.sprite.width + 1) - 2;
        const top = GROUND - obstacle.sprite.height + 1;
        return toastBox.right > left && toastBox.left < right && toastBox.bottom > top;
      });
      if (hit) {
        const final = score();
        if (final > bestScore) {
          bestScore = final;
          writeBest(final);
          setBest(final);
        }
        changeState('over');
      }

      if (scoreRef.current) scoreRef.current.textContent = String(score()).padStart(5, '0');
    };

    const loop = (time: number) => {
      // Clamp the step so a stalled tab or slow frame cannot teleport the toast through an obstacle.
      const dt = last ? Math.min(0.034, (time - last) / 1000) : 0;
      last = time;
      if (gameState === 'running') update(dt);
      draw();
      frame = gameState === 'running' ? window.requestAnimationFrame(loop) : 0;
    };

    const start = () => {
      last = 0;
      if (!frame) frame = window.requestAnimationFrame(loop);
    };

    pressRef.current = () => {
      if (gameState === 'over' || gameState === 'idle') {
        reset();
        changeState('running');
        velocity = JUMP_VELOCITY;
        start();
        return;
      }
      if (gameState === 'paused') {
        changeState('running');
        start();
        return;
      }
      if (grounded()) velocity = JUMP_VELOCITY;
    };
    releaseRef.current = () => {
      if (gameState === 'running' && velocity < JUMP_CUT_VELOCITY) velocity = JUMP_CUT_VELOCITY;
    };

    const handleVisibility = () => {
      if (document.hidden && gameState === 'running') changeState('paused');
    };

    draw();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (frame) window.cancelAnimationFrame(frame);
      pressRef.current = null;
      releaseRef.current = null;
    };
  }, []);

  useEffect(() => {
    const isJumpKey = (event: KeyboardEvent) => event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW';
    const ownsKeyboard = (event: KeyboardEvent) => {
      // Space on a focused button should still press that button.
      const target = event.target as HTMLElement | null;
      return !target?.closest('button, a, input, textarea, select');
    };
    const handleDown = (event: KeyboardEvent) => {
      if (!isJumpKey(event) || !ownsKeyboard(event)) return;
      event.preventDefault();
      if (!event.repeat) pressRef.current?.();
    };
    const handleUp = (event: KeyboardEvent) => {
      if (isJumpKey(event) && ownsKeyboard(event)) releaseRef.current?.();
    };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
    };
  }, []);

  return (
    <div
      className="activity-runner"
      data-state={state}
      onPointerDown={(event) => {
        event.preventDefault();
        pressRef.current?.();
      }}
      onPointerUp={() => releaseRef.current?.()}
      onPointerCancel={() => releaseRef.current?.()}
    >
      <div className="activity-runner-score" aria-hidden="true">
        {best > 0 && <span>HI {String(best).padStart(5, '0')}</span>}
        <span ref={scoreRef}>00000</span>
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Toast runner minigame. Press space or tap to jump."
      />
      <p className="activity-runner-hint" aria-live="polite">{HINTS[state]}</p>
    </div>
  );
}
