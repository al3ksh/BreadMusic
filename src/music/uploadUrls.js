const crypto = require('crypto');

const UPLOAD_URL_TTL_MS = 24 * 60 * 60 * 1000;

function getUploadSigningSecret() {
  return String(process.env.UPLOAD_SIGNING_SECRET || process.env.SESSION_SECRET || '').trim();
}

function getUploadPlaybackBaseUrl() {
  const configured = process.env.UPLOAD_BASE_URL || process.env.LOCAL_AUDIO_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const port = process.env.WEB_PORT || 3001;
  const lavalinkHost = String(process.env.LAVALINK_HOST || '').toLowerCase();
  if (lavalinkHost === 'lavalink') {
    return `http://bot:${port}`;
  }

  return `http://127.0.0.1:${port}`;
}

function buildUploadPath({ guildId, uploadId, fileName }) {
  return `/api/uploads/${encodeURIComponent(String(guildId))}/${encodeURIComponent(String(uploadId))}/${encodeURIComponent(String(fileName))}`;
}

function createUploadSignature(pathname, expires) {
  const secret = getUploadSigningSecret();
  if (!secret) {
    throw new Error('UPLOAD_SIGNING_SECRET or SESSION_SECRET is required for local upload URLs');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${expires}:${pathname}`)
    .digest('hex');
}

function createSignedUploadUrl({
  baseUrl = getUploadPlaybackBaseUrl(),
  guildId,
  uploadId,
  fileName,
  expiresAt = Date.now() + UPLOAD_URL_TTL_MS,
}) {
  const expires = Math.floor(Number(expiresAt) / 1000);
  if (!Number.isFinite(expires) || expires <= 0) {
    throw new Error('Invalid upload URL expiration');
  }

  const pathname = buildUploadPath({ guildId, uploadId, fileName });
  const signature = createUploadSignature(pathname, expires);
  return `${String(baseUrl).replace(/\/+$/, '')}${pathname}?expires=${expires}&signature=${signature}`;
}

function hasValidUploadSignature({ guildId, uploadId, fileName, expires, signature, now = Date.now() }) {
  const expiry = Number.parseInt(String(expires || ''), 10);
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(Number(now) / 1000)) return false;

  const supplied = String(signature || '');
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;

  let expected;
  try {
    expected = createUploadSignature(buildUploadPath({ guildId, uploadId, fileName }), expiry);
  } catch {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

module.exports = {
  UPLOAD_URL_TTL_MS,
  buildUploadPath,
  createSignedUploadUrl,
  getUploadPlaybackBaseUrl,
  hasValidUploadSignature,
};
