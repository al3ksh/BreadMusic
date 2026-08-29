const { parentPort } = require('node:worker_threads');
const { renderAnimation } = require('./arcadeAnimationCore');

parentPort.on('message', async ({ id, type, input }) => {
  try {
    const output = await renderAnimation(type, input);
    parentPort.postMessage({ id, output });
  } catch (error) {
    parentPort.postMessage({ id, error: error?.message || String(error) });
  }
});
