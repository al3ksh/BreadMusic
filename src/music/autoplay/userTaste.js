const { SqliteStore } = require('../../state/sqliteStore');
const { DISLIKED_ARTIST_REJECT_THRESHOLD } = require('./scoring');

const DAY_MS = 24 * 60 * 60 * 1000;

// Autoplay likes and dislikes belong to the person who pressed 👍 or 👎, across every server.
// They only steer autoplay; the library's Liked list is separate (and counts as liked too).
const DISLIKE_LIMITS = { max: 300, ttl: 90 * DAY_MS };
const LIKE_LIMITS = DISLIKE_LIMITS;
// Blocked artists were chosen on purpose, so they stay until the person unblocks them.
const BLOCKED_ARTIST_LIMIT = 200;

let store = null;

// Created lazily so the database path is resolved after tests (or the bot) configure the env.
function getStore() {
  if (!store) store = new SqliteStore('autoplayUserTaste.json', {});
  return store;
}

function getUser(userId, create = false) {
  if (!userId) return null;
  const data = getStore().data;
  let user = data[userId];
  if (!user && create) {
    user = { likes: [], dislikes: [], artists: [] };
    data[userId] = user;
  }
  if (user && !Array.isArray(user.likes)) user.likes = [];
  if (user && !Array.isArray(user.dislikes)) user.dislikes = [];
  if (user && !Array.isArray(user.artists)) user.artists = [];
  return user ?? null;
}

function prune(entries, now) {
  const cutoff = now - DISLIKE_LIMITS.ttl;
  const kept = entries.filter((entry) => entry?.key && Number.isFinite(entry.at) && entry.at >= cutoff);
  return kept.length > DISLIKE_LIMITS.max ? kept.slice(kept.length - DISLIKE_LIMITS.max) : kept;
}

// A like and a dislike of the same track cancel each other out.
function recordLike(userId, entry, now = Date.now()) {
  if (!userId || !entry?.key) return;
  const user = getUser(userId, true);
  user.likes = prune([...user.likes.filter((existing) => existing.key !== entry.key), { ...entry, at: now }], now);
  user.dislikes = user.dislikes.filter((existing) => existing.key !== entry.key);
  getStore().save();
}

function removeLike(userId, key) {
  const user = getUser(userId);
  if (!user) return false;
  const before = user.likes.length;
  user.likes = user.likes.filter((entry) => entry.key !== key);
  if (user.likes.length === before) return false;
  getStore().save();
  return true;
}

function listLikes(userId, now = Date.now()) {
  const user = getUser(userId);
  if (!user) return [];
  user.likes = prune(user.likes, now);
  return user.likes;
}

function isLiked(userId, key, now = Date.now()) {
  return Boolean(key) && listLikes(userId, now).some((entry) => entry.key === key);
}

function recordDislike(userId, entry, now = Date.now()) {
  if (!userId || !entry?.key) return;
  const user = getUser(userId, true);
  user.dislikes = prune([...user.dislikes.filter((existing) => existing.key !== entry.key), { ...entry, at: now }], now);
  user.likes = user.likes.filter((existing) => existing.key !== entry.key);
  getStore().save();
}

function removeDislike(userId, key) {
  const user = getUser(userId);
  if (!user) return false;
  const before = user.dislikes.length;
  user.dislikes = user.dislikes.filter((entry) => entry.key !== key);
  if (user.dislikes.length === before) return false;
  getStore().save();
  return true;
}

function listDislikes(userId, now = Date.now()) {
  const user = getUser(userId);
  if (!user) return [];
  user.dislikes = prune(user.dislikes, now);
  return user.dislikes;
}

function isDisliked(userId, key, now = Date.now()) {
  return Boolean(key) && listDislikes(userId, now).some((entry) => entry.key === key);
}

function blockArtist(userId, { artistKey, author } = {}, now = Date.now()) {
  if (!userId || !artistKey) return false;
  const user = getUser(userId, true);
  user.artists = [...user.artists.filter((entry) => entry.artistKey !== artistKey), { artistKey, author: author || artistKey, at: now }]
    .slice(-BLOCKED_ARTIST_LIMIT);
  getStore().save();
  return true;
}

// Unblocking forgets every dislike of the artist too; otherwise two old track dislikes
// would keep the artist blocked.
function unblockArtist(userId, artistKey) {
  const user = getUser(userId);
  if (!user || !artistKey) return false;
  const before = user.artists.length + user.dislikes.length;
  user.artists = user.artists.filter((entry) => entry.artistKey !== artistKey);
  user.dislikes = user.dislikes.filter((entry) => entry.artistKey !== artistKey);
  if (user.artists.length + user.dislikes.length === before) return false;
  getStore().save();
  return true;
}

function listBlockedArtists(userId) {
  return getUser(userId)?.artists ?? [];
}

function flush() {
  if (store) store.saveImmediate();
}

// Tests reopen the database between cases to simulate a restart.
function resetForTesting() {
  if (store?.saveTimeout) clearTimeout(store.saveTimeout);
  store = null;
}

// What the person has turned down, for the Disliked list: blocked artists (on purpose, or by
// disliking enough of their tracks) and the disliked tracks, newest first.
function getDislikes(userId, now = Date.now()) {
  const tracks = [...listDislikes(userId, now)].reverse();
  const artists = new Map();
  for (const track of tracks) {
    if (!track.artistKey) continue;
    const artist = artists.get(track.artistKey) ?? { artistKey: track.artistKey, author: track.author, tracks: 0, explicit: false };
    artist.tracks += 1;
    artists.set(track.artistKey, artist);
  }
  for (const { artistKey, author } of listBlockedArtists(userId)) {
    const artist = artists.get(artistKey) ?? { artistKey, author, tracks: 0, explicit: false };
    artist.explicit = true;
    artists.set(artistKey, artist);
  }
  const blockedArtists = [...artists.values()]
    .filter((artist) => artist.explicit || artist.tracks >= DISLIKED_ARTIST_REJECT_THRESHOLD)
    .map(({ artistKey, author, tracks: count }) => ({ artistKey, author, tracks: count }));
  return {
    artists: blockedArtists,
    tracks: tracks.map(({ key, title, author, artistKey, uri, duration, artwork, at }) => ({ key, title, author, artistKey, uri, duration, artwork: artwork ?? null, at })),
  };
}

module.exports = {
  DISLIKE_LIMITS,
  LIKE_LIMITS,
  recordLike,
  removeLike,
  listLikes,
  isLiked,
  recordDislike,
  removeDislike,
  listDislikes,
  isDisliked,
  blockArtist,
  unblockArtist,
  listBlockedArtists,
  getDislikes,
  flush,
  __testing: { resetForTesting },
};
