const { SqliteStore } = require('../../state/sqliteStore');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// A session that has not been touched for this long is treated as finished; a restart or
// redeploy inside the window resumes the same listening profile.
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSION_SEEDS = 40;
const MAX_SESSION_RECENT = 40;

// Server-wide signals only. Likes and dislikes belong to people (see userTaste and the library).
const TASTE_LIMITS = {
  skips: { max: 200, ttl: 7 * DAY_MS },
  played: { max: 600, ttl: 3 * DAY_MS },
};

let store = null;

// Created lazily so the database path is resolved after tests (or the bot) configure the env.
function getStore() {
  if (!store) store = new SqliteStore('autoplayProfiles.json', {});
  return store;
}

function emptySession() {
  return { manualSeeds: [], seedCursor: 0, currentSeed: null, recent: [], updatedAt: 0 };
}

function emptyTaste() {
  return { skips: [], played: [] };
}

function getProfile(guildId, create = false) {
  const data = getStore().data;
  let profile = data[guildId];
  if (!profile && create) {
    profile = { session: emptySession(), taste: emptyTaste() };
    data[guildId] = profile;
  }
  if (profile) {
    profile.session ??= emptySession();
    profile.taste ??= emptyTaste();
    // Likes and dislikes used to be shared by the whole server; they are per person now.
    delete profile.taste.likes;
    delete profile.taste.dislikes;
    for (const kind of Object.keys(TASTE_LIMITS)) {
      if (!Array.isArray(profile.taste[kind])) profile.taste[kind] = [];
    }
  }
  return profile ?? null;
}

function pruneList(entries, { max, ttl }, now) {
  const cutoff = now - ttl;
  const kept = entries.filter((entry) => entry?.key && Number.isFinite(entry.at) && entry.at >= cutoff);
  return kept.length > max ? kept.slice(kept.length - max) : kept;
}

function pruneTaste(taste, now) {
  for (const [kind, limits] of Object.entries(TASTE_LIMITS)) {
    taste[kind] = pruneList(taste[kind], limits, now);
  }
  return taste;
}

function getSession(guildId, now = Date.now()) {
  const session = getProfile(guildId)?.session;
  if (!session || !session.updatedAt || now - session.updatedAt > SESSION_TTL_MS) return null;
  return {
    manualSeeds: Array.isArray(session.manualSeeds) ? session.manualSeeds : [],
    seedCursor: Number.isInteger(session.seedCursor) ? session.seedCursor : 0,
    currentSeed: session.currentSeed ?? null,
    recent: Array.isArray(session.recent) ? session.recent : [],
    updatedAt: session.updatedAt,
  };
}

function saveSession(guildId, session, now = Date.now()) {
  if (!guildId) return;
  const profile = getProfile(guildId, true);
  profile.session = {
    manualSeeds: (session.manualSeeds ?? []).slice(-MAX_SESSION_SEEDS),
    seedCursor: session.seedCursor ?? 0,
    currentSeed: session.currentSeed ?? null,
    recent: (session.recent ?? []).slice(-MAX_SESSION_RECENT),
    updatedAt: now,
  };
  getStore().save();
}

function clearSession(guildId) {
  const profile = getProfile(guildId);
  if (!profile) return;
  profile.session = emptySession();
  getStore().save();
}

function upsert(list, entry, limits, now) {
  const next = list.filter((existing) => existing.key !== entry.key);
  next.push({ ...entry, at: now });
  return pruneList(next, limits, now);
}

function recordTaste(guildId, kind, entry, now = Date.now()) {
  if (!guildId || !entry?.key) return;
  const profile = getProfile(guildId, true);
  profile.taste[kind] = upsert(profile.taste[kind], entry, TASTE_LIMITS[kind], now);
  getStore().save();
}

function recordPlayed(guildId, entry, now = Date.now()) {
  recordTaste(guildId, 'played', entry, now);
}

function recordSkip(guildId, entry, now = Date.now()) {
  recordTaste(guildId, 'skips', entry, now);
}

function getTaste(guildId, now = Date.now()) {
  const profile = getProfile(guildId);
  if (!profile) return emptyTaste();
  return pruneTaste(profile.taste, now);
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
  SESSION_TTL_MS,
  TASTE_LIMITS,
  getSession,
  saveSession,
  clearSession,
  recordPlayed,
  recordSkip,
  getTaste,
  flush,
  __testing: { resetForTesting },
};
