const path = require('path');
const { createSignedUploadUrl, hasValidUploadSignature } = require('./uploadUrls');

const EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
const HOUR = 60 * 60 * 1000;

function validArtworkRef(ref) {
  return ref && typeof ref.guildId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(ref.guildId)
    && typeof ref.uploadId === 'string' && /^[a-f0-9]{64}$/.test(ref.uploadId) && EXTENSIONS.has(ref.extension);
}

function signatureArgs(ref) {
  return { guildId: ref.guildId, uploadId: ref.uploadId, fileName: `artwork${ref.extension}.jpg` };
}

function uploadArtworkUrl(ref, { publicUrl = false, now = Date.now() } = {}) {
  if (!validArtworkRef(ref)) return null;
  let baseUrl = '';
  if (publicUrl) {
    try {
      const url = new URL(process.env.WEB_URL);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      baseUrl = url.origin;
    } catch { return null; }
  }
  // Stable for an hour, valid for at least 24 hours, including long-lived queues.
  try {
    return createSignedUploadUrl({ ...signatureArgs(ref), baseUrl,
      expiresAt: Math.floor(now / HOUR) * HOUR + 25 * HOUR });
  } catch { return null; }
}

function verifyArtworkUrl(ref, query) {
  return validArtworkRef(ref) && typeof query.expires === 'string' && /^\d+$/.test(query.expires)
    && typeof query.signature === 'string'
    && hasValidUploadSignature({ ...signatureArgs(ref), expires: query.expires, signature: query.signature });
}

function artworkPath(audioPath) {
  return `${audioPath}.cover.jpg`;
}

function artworkParent(filePath) {
  if (!filePath.endsWith('.cover.jpg')) return null;
  const parent = filePath.slice(0, -'.cover.jpg'.length);
  return EXTENSIONS.has(path.extname(parent)) ? parent : null;
}

function groupUploadFiles(files) {
  const byPath = new Map(files.map((file) => [path.resolve(file.path), { ...file }]));
  for (const file of files) {
    const parentPath = artworkParent(file.path);
    if (!parentPath) continue;
    const parent = byPath.get(path.resolve(parentPath));
    if (parent) {
      parent.size += file.size;
      byPath.delete(path.resolve(file.path));
    } else {
      byPath.get(path.resolve(file.path)).orphan = true;
    }
  }
  return [...byPath.values()];
}

module.exports = { artworkPath, artworkParent, groupUploadFiles, uploadArtworkUrl, verifyArtworkUrl, validArtworkRef };
