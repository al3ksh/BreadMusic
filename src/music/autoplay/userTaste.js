const { SqliteStore } = require('../../state/sqliteStore');

const DAY_MS = 24 * 60 * 60 * 1000;

// Autoplay dislikes belong to the person who pressed 👎, across every server. Likes need no store
// of their own: they are the person's Liked list in the library.
const DISLIKE_LIMITS = { max: 300, ttl: 90 * DAY_MS };

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
    user = { dislikes: [] };
    data[userId] = user;
  }
  if (user && !Array.isArray(user.dislikes)) user.dislikes = [];
  return user ?? null;
}

function prune(entries, now) {
  const cutoff = now - DISLIKE_LIMITS.ttl;
  const kept = entries.filter((entry) => entry?.key && Number.isFinite(entry.at) && entry.at >= cutoff);
  return kept.length > DISLIKE_LIMITS.max ? kept.slice(kept.length - DISLIKE_LIMITS.max) : kept;
}

function recordDislike(userId, entry, now = Date.now()) {
  if (!userId || !entry?.key) return;
  const user = getUser(userId, true);
  user.dislikes = prune([...user.dislikes.filter((existing) => existing.key !== entry.key), { ...entry, at: now }], now);
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

function flush() {
  if (store) store.saveImmediate();
}

// Tests reopen the database between cases to simulate a restart.
function resetForTesting() {
  if (store?.saveTimeout) clearTimeout(store.saveTimeout);
  store = null;
}

module.exports = {
  DISLIKE_LIMITS,
  recordDislike,
  removeDislike,
  listDislikes,
  isDisliked,
  flush,
  __testing: { resetForTesting },
};
