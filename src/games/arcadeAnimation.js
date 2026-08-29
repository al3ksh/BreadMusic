const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WIDTH = 800;
const HEIGHT = 467;
const RENDER_TIMEOUT = 30_000;

function resolveWorkerCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(4, Math.max(1, parsed));
}

const WORKER_COUNT = resolveWorkerCount(process.env.ARCADE_ANIMATION_WORKERS);

const slots = Array.from({ length: WORKER_COUNT }, () => ({ worker: null, pending: null }));
let requestId = 0;

function finishPending(slot, error, output) {
  if (!slot.pending) return;
  const current = slot.pending;
  const activeWorker = slot.worker;
  slot.pending = null;
  slot.worker = null;
  clearTimeout(current.timer);
  activeWorker?.terminate().catch(() => {});
  if (error) current.reject(error);
  else current.resolve(Buffer.from(output));
}

function ensureWorker(slot) {
  if (slot.worker) return slot.worker;
  const activeWorker = new Worker(path.join(__dirname, 'arcadeAnimationWorker.js'));
  slot.worker = activeWorker;
  activeWorker.unref();
  activeWorker.on('message', ({ id, output, error }) => {
    if (!slot.pending || slot.pending.id !== id) return;
    finishPending(slot, error ? new Error(error) : null, output);
  });
  activeWorker.on('error', (error) => {
    finishPending(slot, error);
  });
  activeWorker.on('exit', (code) => {
    const ownsSlot = slot.worker === activeWorker;
    if (ownsSlot) slot.worker = null;
    if (ownsSlot && slot.pending && code !== 0) {
      finishPending(slot, new Error(`Animation worker exited with code ${code}`));
    }
  });
  return activeWorker;
}

function render(type, input) {
  const slot = slots.find((candidate) => !candidate.pending);
  if (!slot) return Promise.reject(new Error('Animation renderer is busy'));

  const activeWorker = ensureWorker(slot);
  activeWorker.ref();
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finishPending(slot, new Error('Animation renderer timed out'));
    }, RENDER_TIMEOUT);
    slot.pending = { id, resolve, reject, timer };
    activeWorker.postMessage({ id, type, input });
  });
}

module.exports = {
  WIDTH,
  HEIGHT,
  WORKER_COUNT,
  resolveWorkerCount,
  renderSlotsAnimation: (input) => render('slots', input),
  renderRouletteAnimation: (input) => render('roulette', input),
  renderCoinflipAnimation: (input) => render('coinflip', input),
  renderDiceAnimation: (input) => render('dice', input),
};
