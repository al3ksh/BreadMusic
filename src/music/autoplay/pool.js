const { normalizeTrack } = require('./normalize');

const POOL_TTL_MS = 20 * 60 * 1000;
const MAX_POOL_SIZE = 150;
const MIN_ELIGIBLE = 6;
const MAX_PICKS_PER_BUILD = 3;
const SOURCE_PRIORITY = {
  radio: 3,
  lastfm: 3,
  search: 2,
  discovery: 1,
};

const pools = new Map();

function sourcePriority(source) {
  return SOURCE_PRIORITY[source] ?? 1;
}

function getPool(guildId) {
  return pools.get(guildId) ?? null;
}

function ensurePool(guildId) {
  let pool = pools.get(guildId);
  if (!pool) {
    pool = {
      profileKey: null,
      builtAt: 0,
      picksSinceBuild: 0,
      candidates: new Map(),
      seeds: null,
      next: null,
      building: null,
    };
    pools.set(guildId, pool);
  }
  return pool;
}

function pruneExpired(pool, now) {
  for (const [key, entry] of pool.candidates) {
    if (now - entry.addedAt > POOL_TTL_MS) pool.candidates.delete(key);
  }
}

// A rebuild for a new profile replaces the old candidates only once it actually produced results,
// so skips keep working from the previous pool while the new one is being fetched.
function mergeCandidates(guildId, candidates, { profileKey = null, now = Date.now() } = {}) {
  const pool = ensurePool(guildId);
  if (pool.profileKey !== profileKey) {
    // An empty rebuild keeps the old profile so the pool still counts as stale and is rebuilt again.
    if (!candidates.length && pool.candidates.size) return pool;
    pool.candidates = new Map();
  }
  pruneExpired(pool, now);

  for (const raw of candidates) {
    const normalized = normalizeTrack(raw?.track);
    if (!normalized) continue;

    const existing = pool.candidates.get(normalized.key);
    const anchorKeys = new Set(existing?.anchorKeys ?? []);
    if (raw.anchorKey) anchorKeys.add(raw.anchorKey);
    const anchorRank = Math.min(existing?.anchorRank ?? raw.anchorRank ?? 0, raw.anchorRank ?? 0);

    if (!existing || sourcePriority(raw.source) > sourcePriority(existing.source)) {
      pool.candidates.set(normalized.key, {
        track: raw.track,
        normalized,
        source: raw.source,
        sourceIndex: raw.sourceIndex ?? 0,
        anchorKeys,
        anchorRank,
        discoveryDistance: raw.discoveryDistance || existing?.discoveryDistance || null,
        lastfmMatch: raw.lastfmMatch ?? existing?.lastfmMatch ?? null,
        addedAt: now,
      });
    } else {
      existing.anchorKeys = anchorKeys;
      existing.anchorRank = anchorRank;
      existing.addedAt = now;
      if (!existing.discoveryDistance && raw.discoveryDistance) existing.discoveryDistance = raw.discoveryDistance;
    }
  }

  if (pool.candidates.size > MAX_POOL_SIZE) {
    const kept = [...pool.candidates.entries()]
      .sort(([, left], [, right]) => (
        (sourcePriority(right.source) - sourcePriority(left.source)) || (right.addedAt - left.addedAt)
      ))
      .slice(0, MAX_POOL_SIZE);
    pool.candidates = new Map(kept);
  }

  pool.profileKey = profileKey;
  pool.builtAt = now;
  pool.picksSinceBuild = 0;
  return pool;
}

function getCandidates(guildId, now = Date.now()) {
  const pool = pools.get(guildId);
  if (!pool) return [];
  pruneExpired(pool, now);
  return [...pool.candidates.values()];
}

function needsSyncBuild(guildId, profileKey) {
  const pool = pools.get(guildId);
  return !pool || !pool.candidates.size || pool.profileKey !== profileKey;
}

function needsRefresh(guildId, { eligibleCount = Infinity, profileKey = null, now = Date.now() } = {}) {
  const pool = pools.get(guildId);
  if (!pool || !pool.candidates.size) return true;
  return (
    pool.profileKey !== profileKey ||
    eligibleCount < MIN_ELIGIBLE ||
    now - pool.builtAt > POOL_TTL_MS ||
    pool.picksSinceBuild >= MAX_PICKS_PER_BUILD
  );
}

function recordPick(guildId, key) {
  const pool = pools.get(guildId);
  if (!pool) return;
  if (key) pool.candidates.delete(key);
  pool.picksSinceBuild += 1;
}

function getNext(guildId) {
  return pools.get(guildId)?.next ?? null;
}

function setNext(guildId, next) {
  ensurePool(guildId).next = next;
}

function clearNext(guildId) {
  const pool = pools.get(guildId);
  if (!pool?.next) return false;
  pool.next = null;
  return true;
}

function clearPool(guildId) {
  pools.delete(guildId);
}

module.exports = {
  MIN_ELIGIBLE,
  POOL_TTL_MS,
  MAX_POOL_SIZE,
  getPool,
  ensurePool,
  mergeCandidates,
  getCandidates,
  needsSyncBuild,
  needsRefresh,
  recordPick,
  getNext,
  setNext,
  clearNext,
  clearPool,
};
