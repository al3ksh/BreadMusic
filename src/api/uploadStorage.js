// @ts-check
// Audio upload files on disk: names, quota, cleanup and streaming.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { artworkPath, groupUploadFiles } = require('../music/uploadArtworkUrls');
const { Transform } = require('stream');
const { getStoredLocalUploadPaths } = require('../state/queueStore');

const AUDIO_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
const AUDIO_UPLOAD_QUOTA_DEFAULT_MB = 1024;
const AUDIO_UPLOAD_QUOTA_MIN_MB = 256;
const AUDIO_UPLOAD_QUOTA_MAX_MB = 10 * 1024;
const configuredUploadQuotaMb = Number.parseInt(process.env.UPLOAD_STORAGE_LIMIT_MB || '', 10);
const AUDIO_UPLOAD_QUOTA_BYTES = Math.max(
  AUDIO_UPLOAD_QUOTA_MIN_MB,
  Math.min(
    AUDIO_UPLOAD_QUOTA_MAX_MB,
    Number.isFinite(configuredUploadQuotaMb) ? configuredUploadQuotaMb : AUDIO_UPLOAD_QUOTA_DEFAULT_MB,
  ),
) * 1024 * 1024;
const AUDIO_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const AUDIO_UPLOAD_TEMP_TTL_MS = 60 * 60 * 1000;
const AUDIO_UPLOAD_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
const AUDIO_UPLOAD_MIME_PREFIXES = ['audio/'];
const AUDIO_UPLOAD_MIME_TYPES = new Set(['application/ogg', 'video/webm']);
const DATA_DIR = path.resolve(process.env.BREAD_DATA_DIR || path.join(process.cwd(), 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
let uploadQuotaQueue = Promise.resolve();
const activeUploadTempPaths = new Set();
/** @returns {Promise<(value?: unknown) => void>} */
async function acquireUploadQuotaMutex() {
  const previous = uploadQuotaQueue;
  /** @type {(value?: unknown) => void} */
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  uploadQuotaQueue = previous.catch(() => {}).then(() => gate);
  await previous.catch(() => {});
  return release;
}
function sanitizeUploadName(fileName) {
  const normalized = path.basename(String(fileName || 'upload.mp3'))
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  const fallback = 'upload.mp3';
  if (!normalized || normalized === '.' || normalized === '..') return fallback;

  const ext = path.extname(normalized);
  const base = path.basename(normalized, ext).slice(0, Math.max(1, 120 - ext.length));
  return `${base || 'upload'}${ext}`;
}

function decodeUploadHeader(value) {
  const encoded = String(value || '');
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function isAllowedAudioUpload(ext, mimeType) {
  if (!AUDIO_UPLOAD_EXTENSIONS.has(ext)) return false;
  if (!mimeType || mimeType === 'application/octet-stream') return true;
  if (AUDIO_UPLOAD_MIME_TYPES.has(mimeType)) return true;
  return AUDIO_UPLOAD_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function isSafeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
}

function isPathInside(filePath, parentPath) {
  const relative = path.relative(parentPath, filePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function getAudioContentType(ext) {
  switch (ext) {
    case '.mp3':
      return 'audio/mpeg';
    case '.flac':
      return 'audio/flac';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
    case '.opus':
      return 'audio/ogg';
    case '.m4a':
    case '.aac':
      return 'audio/aac';
    case '.webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

function streamUploadToFile(request, filePath, maxBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      const error = /** @type {NodeJS.ErrnoException} */ (new Error(`Upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`));
      error.code = 'LIMIT_FILE_SIZE';
      request.resume();
      reject(error);
      return;
    }

    const hash = crypto.createHash('sha256');
    let size = 0;
    let settled = false;
    const transform = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) {
          const error = /** @type {NodeJS.ErrnoException} */ (new Error(`Upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`));
          error.code = 'LIMIT_FILE_SIZE';
          callback(error);
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const output = fs.createWriteStream(filePath, { flags: 'wx' });

    const cleanup = async () => {
      request.unpipe(transform);
      request.resume();
      transform.destroy();
      output.destroy();
      await safeDeleteFile(filePath);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup().finally(() => reject(error));
    };

    request.once('aborted', () => {
      const error = /** @type {NodeJS.ErrnoException} */ (new Error('Upload request was aborted'));
      error.code = 'ECONNABORTED';
      fail(error);
    });
    request.once('error', fail);
    transform.once('error', fail);
    output.once('error', fail);
    output.once('finish', () => {
      if (settled) return;
      settled = true;
      resolve({ path: filePath, size, uploadId: hash.digest('hex') });
    });

    request.pipe(transform).pipe(output);
  });
}

async function renameFileWithRetry(source, destination, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error) {
      const retryable = ['EPERM', 'EACCES', 'EBUSY', 'ENOENT'].includes(error.code);
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function safeDeleteFile(filePath) {
  try {
    if (AUDIO_UPLOAD_EXTENSIONS.has(path.extname(filePath))) {
      await fs.promises.unlink(artworkPath(filePath)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Failed to delete upload ${path.basename(filePath)}:`, error.message);
  }
  return false;
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function touchFile(filePath) {
  const now = new Date();
  try {
    await fs.promises.utimes(filePath, now, now);
  } catch {
    // A file that is already gone has nothing to keep alive.
  }
}

function getProtectedAudioUploadPaths(client) {
  const protectedPaths = new Set(activeUploadTempPaths);
  const players = client?.lavalink?.players;
  if (players) {
    for (const player of players.values()) {
      const tracks = [player.queue?.current, ...(player.queue?.tracks || [])].filter(Boolean);
      for (const track of tracks) {
        const filePath = track.localUpload?.filePath;
        if (!filePath) continue;
        const resolvedPath = path.resolve(filePath);
        if (isPathInside(resolvedPath, UPLOAD_DIR)) protectedPaths.add(resolvedPath);
      }
    }
  }

  for (const filePath of getStoredLocalUploadPaths()) {
    const resolvedPath = path.resolve(filePath);
    if (isPathInside(resolvedPath, UPLOAD_DIR)) protectedPaths.add(resolvedPath);
  }
  return protectedPaths;
}

async function listAudioUploadFiles() {
  let guildDirs = [];
  try {
    guildDirs = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const guildDir of guildDirs) {
    if (!guildDir.isDirectory() || !isSafeId(guildDir.name)) continue;

    const guildPath = path.join(UPLOAD_DIR, guildDir.name);
    const entries = await fs.promises.readdir(guildPath, { withFileTypes: true }).catch(() => []);
    for (const file of entries) {
      if (!file.isFile()) continue;

      const filePath = path.join(guildPath, file.name);
      const stats = await fs.promises.stat(filePath).catch(() => null);
      if (stats?.isFile()) {
        const incoming = file.name.startsWith('.incoming-');
        files.push({
          path: filePath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          incoming,
          activeIncoming: incoming && activeUploadTempPaths.has(path.resolve(filePath)),
        });
      }
    }
  }
  return groupUploadFiles(files);
}

async function cleanupExpiredAudioUploads(client) {
  const files = await listAudioUploadFiles();
  const protectedPaths = getProtectedAudioUploadPaths(client);
  const now = Date.now();
  for (const file of files) {
    if (file.activeIncoming) continue;
    const cutoff = now - (file.incoming ? AUDIO_UPLOAD_TEMP_TTL_MS : AUDIO_UPLOAD_TTL_MS);
    if ((file.orphan || file.mtimeMs < cutoff) && !protectedPaths.has(path.resolve(file.path))) {
      await safeDeleteFile(file.path);
    }
  }
}

async function runAudioUploadCleanup(client) {
  const releaseQuota = await acquireUploadQuotaMutex();
  try {
    await cleanupExpiredAudioUploads(client);
  } finally {
    releaseQuota();
  }
}

async function makeRoomForAudioUpload(requiredBytes, client, incomingPath = null) {
  const files = await listAudioUploadFiles();
  const protectedPaths = getProtectedAudioUploadPaths(client);
  const excludedIncomingPath = incomingPath ? path.resolve(incomingPath) : null;
  let totalBytes = files.reduce(
    (total, file) => total + (path.resolve(file.path) === excludedIncomingPath ? 0 : file.size),
    0,
  );
  if (totalBytes + requiredBytes <= AUDIO_UPLOAD_QUOTA_BYTES) return true;

  const candidates = files
    .filter((file) => !file.incoming && !protectedPaths.has(path.resolve(file.path)))
    .sort((left, right) => left.mtimeMs - right.mtimeMs);

  for (const file of candidates) {
    if (totalBytes + requiredBytes <= AUDIO_UPLOAD_QUOTA_BYTES) break;
    if (await safeDeleteFile(file.path)) {
      totalBytes -= file.size;
    }
  }

  return totalBytes + requiredBytes <= AUDIO_UPLOAD_QUOTA_BYTES;
}

module.exports = {
  AUDIO_UPLOAD_MAX_BYTES,
  AUDIO_UPLOAD_QUOTA_BYTES,
  AUDIO_UPLOAD_TTL_MS,
  AUDIO_UPLOAD_EXTENSIONS,
  UPLOAD_DIR,
  activeUploadTempPaths,
  acquireUploadQuotaMutex,
  sanitizeUploadName,
  decodeUploadHeader,
  isAllowedAudioUpload,
  isSafeId,
  isPathInside,
  getAudioContentType,
  streamUploadToFile,
  renameFileWithRetry,
  safeDeleteFile,
  fileExists,
  touchFile,
  cleanupExpiredAudioUploads,
  runAudioUploadCleanup,
  makeRoomForAudioUpload,
};
