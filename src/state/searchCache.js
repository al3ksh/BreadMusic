const crypto = require('crypto');

const cache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(id);
    }
  }
}, 120_000);

function createSelection(tracks, userId, guildId, ttl = 60_000) {
  const id = crypto.randomBytes(6).toString('hex');
  cache.set(id, {
    tracks,
    userId,
    guildId,
    expiresAt: Date.now() + ttl,
  });
  return id;
}

function getSelection(id) {
  const entry = cache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(id);
    return null;
  }
  return entry;
}

function deleteSelection(id) {
  cache.delete(id);
}

module.exports = {
  createSelection,
  getSelection,
  deleteSelection,
};
