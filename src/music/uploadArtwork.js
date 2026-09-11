const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { artworkPath } = require('./uploadArtworkUrls');

const MAX_ARTWORK_BYTES = 256 * 1024;
let active = false;
const pending = new Map();

function runExtraction(filePath, { timeoutMs = 4000, workerPath = path.join(__dirname, 'uploadArtworkWorker.js') } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--max-old-space-size=64', workerPath, filePath], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      // The parser does not need bot tokens or other application credentials.
      env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '',
        TEMP: process.env.TEMP || '', TMP: process.env.TMP || '', VIPS_CONCURRENCY: '1' },
    });
    const chunks = [];
    let size = 0;
    let killed = false;
    const stop = () => { killed = true; child.kill('SIGKILL'); };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_ARTWORK_BYTES) stop();
      else chunks.push(chunk);
    });
    child.on('error', () => { killed = true; });
    // Keep the single-process slot until the OS confirms the child has stopped.
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(killed || code !== 0 ? null : Buffer.concat(chunks));
    });
  });
}

async function prepareUploadArtwork(audioPath) {
  const key = path.resolve(audioPath);
  if (pending.has(key)) return pending.get(key);
  const work = (async () => {
    const cached = await fs.promises.stat(artworkPath(key)).catch(() => null);
    if (cached?.isFile() && cached.size <= MAX_ARTWORK_BYTES) return { cached: true, hasCover: cached.size > 0 };
    // No unbounded render backlog on the Pi. Busy uploads continue without art.
    if (active) return null;
    active = true;
    try {
      const data = await runExtraction(key);
      return data === null ? null : { cached: false, hasCover: data.length > 0, data };
    } finally { active = false; }
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}

async function storeUploadArtwork(audioPath, data) {
  if (!Buffer.isBuffer(data) || data.length > MAX_ARTWORK_BYTES) return false;
  const destination = artworkPath(audioPath);
  const temporary = path.join(path.dirname(audioPath), `.incoming-cover-${crypto.randomBytes(12).toString('hex')}.tmp`);
  try {
    await fs.promises.writeFile(temporary, data, { flag: 'wx' });
    await fs.promises.rename(temporary, destination);
    return true;
  } catch { return false; }
  finally { await fs.promises.unlink(temporary).catch(() => {}); }
}

module.exports = { MAX_ARTWORK_BYTES, prepareUploadArtwork, storeUploadArtwork, runExtraction };
