'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { RunnerAudio, type RunnerSound } from './runner/audio';
import { bpmAt, createWorld, inFever, multiplier, press, step, type RunnerCue, type RunnerWorld } from './runner/engine';
import { applyCues, clearFx, createFx, drawScene, smoulder, updateFx, type RunnerMode } from './runner/render';

// A rhythm runner for the Activity outage screens and the idle player: a slice of toast jumps
// kitchen hazards and equalizer bars to a chiptune loop. Jumps on the beat build a combo; the tempo
// climbs as you go.

const BEST_KEY = 'bread-activity-runner-best';
const MUTED_KEY = 'bread-activity-runner-muted';
const MAX_WIDTH = 300;
const MIN_HEIGHT = 72;
const MAX_HEIGHT = 120;
// Stops a jump meant for the toast from instantly restarting the run it just ended.
const RESTART_LOCK_MS = 450;

type Size = 'invite' | 'stage';

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked inside the Discord iframe; the value then lasts for the session.
  }
}

function soundFor(cue: RunnerCue): RunnerSound | null {
  if (cue.type === 'judge') return cue.grade;
  if (cue.type === 'jump' || cue.type === 'note' || cue.type === 'crash') return cue.type;
  if (cue.type === 'fever') return cue.on ? 'fever' : 'feverEnd';
  return null;
}

function hintFor(mode: RunnerMode, newBest: boolean) {
  switch (mode) {
    case 'idle':
      return 'Jump on the beat. Space or tap to play';
    case 'paused':
      return 'Paused. Tap to continue';
    case 'over':
      return newBest ? 'Burnt! New best. Tap to try again' : 'Burnt! Tap to try again';
    default:
      return '';
  }
}

/**
 * Picks a whole number of device pixels per game pixel, so the art stays crisp, then sizes the
 * game to the space it was given. On the stage the pixels grow along with the view.
 */
function measure(cssWidth: number, cssHeight: number, size: Size) {
  const ratio = window.devicePixelRatio || 1;
  const width = cssWidth * ratio;
  const height = cssHeight * ratio;
  // Narrow views trade a little look-ahead for pixels big enough to read.
  const minWidth = cssWidth < 480 ? 150 : 200;
  let scale: number;
  let gameHeight: number;
  if (size === 'stage') {
    scale = Math.max(1, Math.min(Math.floor(width / minWidth), Math.floor(height / MIN_HEIGHT)));
    gameHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(height / scale)));
  } else {
    scale = Math.max(1, Math.min(Math.round(2 * ratio), Math.floor(width / Math.min(minWidth, 160))));
    gameHeight = MIN_HEIGHT;
  }
  const gameWidth = Math.max(1, Math.min(MAX_WIDTH, Math.floor(width / scale)));
  return { scale, ratio, width: gameWidth, height: gameHeight };
}

type RunnerGameProps = {
  size: Size;
  onStart?: () => void;
  onModeChange?: (mode: RunnerMode) => void;
  /** Escape while no run is going asks to leave the game. */
  onExit?: () => void;
  /** The bot is playing: the loop steps aside so the game does not talk over the song. */
  ducked?: boolean;
  /** Something sits on top of the game; the run pauses and keys are left alone. */
  suspended?: boolean;
  autoFocus?: boolean;
};

export function ActivityRunnerGame({ size, onStart, onModeChange, onExit, ducked = false, suspended = false, autoFocus = false }: RunnerGameProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scoreRef = useRef<HTMLSpanElement | null>(null);
  const comboRef = useRef<HTMLSpanElement | null>(null);
  const comboCountRef = useRef<HTMLSpanElement | null>(null);
  const comboMultRef = useRef<HTMLElement | null>(null);
  const onStartRef = useRef(onStart);
  const onModeChangeRef = useRef(onModeChange);
  const onExitRef = useRef(onExit);
  const duckedRef = useRef(ducked);
  const suspendedRef = useRef(suspended);
  const modeRef = useRef<RunnerMode>('idle');
  const viewRef = useRef({ scale: 1, width: 200, height: MIN_HEIGHT });
  const pressRef = useRef<(() => void) | null>(null);
  const pauseRef = useRef<(() => void) | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);
  const mutedRef = useRef(false);
  const audioRef = useRef<RunnerAudio | null>(null);
  const [mode, setMode] = useState<RunnerMode>('idle');
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    onStartRef.current = onStart;
    onModeChangeRef.current = onModeChange;
    onExitRef.current = onExit;
  }, [onStart, onModeChange, onExit]);

  useEffect(() => {
    duckedRef.current = ducked;
    audioRef.current?.setDucked(ducked);
  }, [ducked]);

  useEffect(() => {
    suspendedRef.current = suspended;
    if (suspended) pauseRef.current?.();
  }, [suspended]);

  useEffect(() => {
    if (autoFocus) wrapperRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    const storedMuted = readStored(MUTED_KEY) === '1';
    mutedRef.current = storedMuted;
    setMuted(storedMuted);
    setBest(Number(readStored(BEST_KEY)) || 0);
  }, []);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const board = boardRef.current;
    const screen = screenRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !board || !screen || !canvas) return;
    const resize = () => {
      // On the stage the board may use the height the wrapper was given, less the HUD and hint.
      const room = size === 'stage' ? wrapper.clientHeight - (board.offsetHeight - screen.offsetHeight) : 0;
      const next = measure(screen.clientWidth, room, size);
      viewRef.current = next;
      const pixelWidth = next.width * next.scale;
      const pixelHeight = next.height * next.scale;
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      canvas.style.width = `${pixelWidth / next.ratio}px`;
      canvas.style.height = `${pixelHeight / next.ratio}px`;
      redrawRef.current?.();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    observer.observe(screen);
    // Zooming or moving to another screen changes the device pixel ratio without a resize.
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener('change', resize);
    return () => {
      observer.disconnect();
      query.removeEventListener('change', resize);
    };
  }, [size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let gameMode: RunnerMode = 'idle';
    let world: RunnerWorld = createWorld();
    let idleTime = 0;
    const fx = createFx();
    let bestScore = Number(readStored(BEST_KEY)) || 0;
    let shownScore = -1;
    let shownCombo = -1;
    let shownFever = false;
    let lockedUntil = 0;
    let frame = 0;
    let last = 0;

    const changeMode = (next: RunnerMode) => {
      gameMode = next;
      modeRef.current = next;
      setMode(next);
      onModeChangeRef.current?.(next);
    };

    // Score and combo change many times a second, so they skip React and write to the DOM.
    const showScore = () => {
      if (world.score !== shownScore && scoreRef.current) {
        shownScore = world.score;
        scoreRef.current.textContent = String(world.score).padStart(5, '0');
      }
      const fever = inFever(world);
      if (world.combo === shownCombo && fever === shownFever) return;
      // Fever doubles every point, so the pill shows the multiplier that is really paid.
      const previousMult = multiplier(Math.max(0, shownCombo)) * (shownFever ? 2 : 1);
      shownCombo = world.combo;
      shownFever = fever;
      const mult = multiplier(world.combo) * (fever ? 2 : 1);
      const pill = comboRef.current;
      if (comboCountRef.current) comboCountRef.current.textContent = String(world.combo);
      if (comboMultRef.current) comboMultRef.current.textContent = `x${mult}`;
      if (!pill) return;
      pill.toggleAttribute('data-active', world.combo >= 2);
      pill.toggleAttribute('data-fever', fever);
      if (mult > previousMult) {
        // Restart the pop each time the multiplier steps up.
        pill.removeAttribute('data-pop');
        void pill.offsetWidth;
        pill.setAttribute('data-pop', '');
      }
    };

    const draw = () => {
      const view = viewRef.current;
      ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
      ctx.imageSmoothingEnabled = false;
      drawScene(ctx, { world, fx, mode: gameMode, width: view.width, height: view.height, reducedMotion: motionQuery.matches });
    };
    redrawRef.current = draw;

    const finish = () => {
      audioRef.current?.stopMusic();
      lockedUntil = performance.now() + RESTART_LOCK_MS;
      const beaten = world.score > bestScore;
      setNewBest(beaten && bestScore > 0);
      if (beaten) {
        bestScore = world.score;
        writeStored(BEST_KEY, String(bestScore));
        setBest(bestScore);
      }
      changeMode('over');
    };

    const handleCues = (cues: RunnerCue[]) => {
      if (!cues.length) return;
      applyCues(fx, cues, world, viewRef.current.height);
      for (const cue of cues) {
        const sound = soundFor(cue);
        if (sound) audioRef.current?.play(sound);
        if (cue.type === 'crash') finish();
      }
    };

    const loop = (time: number) => {
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
      last = time;
      if (gameMode === 'running') {
        handleCues(step(world, dt, viewRef.current.width));
        if (gameMode === 'running') audioRef.current?.update(world.songTime, { combo: world.combo, fever: inFever(world) });
        showScore();
      } else if (gameMode === 'idle') {
        // The idle screen keeps a gentle pulse going on a loop of its own.
        idleTime += dt;
        world.songTime = idleTime;
        world.beat = (idleTime * bpmAt(0)) / 60;
      } else if (gameMode === 'over' && !motionQuery.matches) {
        smoulder(fx, viewRef.current.height, dt);
      }
      updateFx(fx, dt);
      draw();
      frame = gameMode === 'paused' ? 0 : window.requestAnimationFrame(loop);
    };

    const run = () => {
      last = 0;
      if (!frame) frame = window.requestAnimationFrame(loop);
    };

    const begin = () => {
      world = createWorld();
      clearFx(fx);
      showScore();
      // Created inside the gesture: browsers only allow sound to start from one.
      if (!audioRef.current) audioRef.current = RunnerAudio.create(mutedRef.current, duckedRef.current);
      changeMode('running');
      wrapperRef.current?.focus({ preventScroll: true });
      run();
    };

    pressRef.current = () => {
      if (performance.now() < lockedUntil) return;
      if (gameMode === 'idle') {
        onStartRef.current?.();
        begin();
      } else if (gameMode === 'over') {
        begin();
      } else if (gameMode === 'paused') {
        changeMode('running');
        run();
      } else {
        handleCues(press(world));
      }
    };

    pauseRef.current = () => {
      if (gameMode !== 'running') return;
      audioRef.current?.stopMusic();
      changeMode('paused');
    };

    const handleVisibility = () => {
      if (document.hidden) pauseRef.current?.();
    };

    run();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (frame) window.cancelAnimationFrame(frame);
      pressRef.current = null;
      pauseRef.current = null;
      redrawRef.current = null;
      audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  const toggleMuted = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    writeStored(MUTED_KEY, next ? '1' : '0');
    audioRef.current?.setMuted(next);
  }, []);

  useEffect(() => {
    const ownsKeyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      // Space on a focused button should still press that button.
      const target = event.target as HTMLElement | null;
      return !target?.closest('button, a, input, textarea, select, [contenteditable="true"]');
    };
    const handleDown = (event: KeyboardEvent) => {
      if (suspendedRef.current || !ownsKeyboard(event)) return;
      if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault();
        if (!event.repeat) pressRef.current?.();
      } else if (event.code === 'KeyM' && !event.repeat) {
        toggleMuted();
      } else if (event.code === 'Escape' && modeRef.current !== 'running' && onExitRef.current) {
        onExitRef.current();
      } else if (event.code === 'Escape' || event.code === 'KeyP') {
        pauseRef.current?.();
      }
    };
    window.addEventListener('keydown', handleDown);
    return () => window.removeEventListener('keydown', handleDown);
  }, [toggleMuted]);

  return (
    <div
      ref={wrapperRef}
      className="activity-runner"
      data-state={mode}
      data-size={size}
      tabIndex={0}
      role="group"
      aria-label="Toast runner minigame"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        pressRef.current?.();
      }}
    >
      <div ref={boardRef} className="activity-runner-board">
      <div className="activity-runner-hud">
        <button
          type="button"
          className="activity-runner-mute"
          aria-label={muted ? 'Unmute game sound' : 'Mute game sound'}
          aria-pressed={muted}
          title={muted ? 'Unmute (M)' : 'Mute (M)'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={toggleMuted}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
        <span ref={comboRef} className="activity-runner-combo" aria-hidden="true">
          <span ref={comboCountRef}>0</span> combo <b ref={comboMultRef}>x1</b>
        </span>
        <span className="activity-runner-score" aria-hidden="true">
          {best > 0 && <span>HI {String(best).padStart(5, '0')}</span>}
          <span ref={scoreRef}>00000</span>
        </span>
      </div>
      <div ref={screenRef} className="activity-runner-screen">
        <canvas ref={canvasRef} role="img" aria-label="Toast rhythm runner. Jump on the beat with space or a tap." />
      </div>
      <p className="activity-runner-hint" aria-live="polite">{hintFor(mode, newBest)}</p>
      </div>
    </div>
  );
}
