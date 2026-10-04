const { getConfig, setConfig } = require('../state/guildConfig');
const { getDiscoveryArtists, pickCandidateWithGemini, resetGeminiAutoplayState } = require('./autoplayAi');
const {
  logAutoplay,
  normalizeTrack,
  getTrackCacheKey,
  snapshotTrackInfo,
  isLocalUploadTrack,
  isStreamTrack,
} = require('./autoplay/normalize');
const { scoreCandidate, pickCandidateLocally } = require('./autoplay/scoring');
const {
  buildSearchQueries,
  buildDiscoveryQueries,
  collectCandidates,
  radioSource,
  searchSource,
  discoverySource,
  lastfmSource,
} = require('./autoplay/sources');
const pool = require('./autoplay/pool');
const profileStore = require('./autoplay/profileStore');
const userTaste = require('./autoplay/userTaste');
const library = require('./library');
const { autoplayEvents } = require('./autoplay/events');
const { getGuildHistory } = require('../state/analyticsStore');

// Per-guild listening session (manual seeds, rotation cursor, accepted seed, recent tracks),
// hydrated from the profile store so a restart resumes the same profile.
const sessions = new Map();
const autoplayInProgress = new Set();
const autoplayEpoch = new Map();
const autoplayBlockedUntil = new Map();
const autoplayPlaybackFailureBlocks = new Set();
const prepareTimers = new Map();
const exhaustedNoticeAt = new Map();
const rerollAt = new Map();

const MAX_RECENT_TRACKS = 40;
const MAX_MANUAL_SEEDS = 40;
const ACTIVE_MANUAL_SEEDS = 3;
const SKIP_MEMORY_TTL = 2 * 60 * 60 * 1000;
const SKIP_DAY_MS = 24 * 60 * 60 * 1000;
const REBUILD_HISTORY_SEEDS = 12;
const REBUILD_LIKED_SEEDS = 6;
const QUICK_SKIP_MAX_MS = 75_000;
const QUICK_SKIP_MAX_RATIO = 0.35;
const ACCEPTED_PLAY_MIN_MS = 90_000;
const ACCEPTED_PLAY_MIN_RATIO = 0.65;
const PREPARE_DELAY_MS = 3_000;
const EXHAUSTED_NOTICE_COOLDOWN_MS = 2 * 60 * 1000;
const REROLL_COOLDOWN_MS = 1_500;

function isAutoplayEnabled(guildId) {
  const config = getConfig(guildId);
  return config.autoplay ?? false;
}

function setAutoplay(guildId, enabled) {
  setConfig(guildId, { autoplay: enabled });
  if (enabled) autoplayPlaybackFailureBlocks.delete(guildId);
  if (!enabled) {
    bumpEpoch(guildId);
    clearAutoplayPrefetch(guildId);
    pool.clearPool(guildId);
    clearSession(guildId);
    resetGeminiAutoplayState(guildId);
  }
}

function toggleAutoplay(guildId) {
  const current = isAutoplayEnabled(guildId);
  setAutoplay(guildId, !current);
  return !current;
}

function getEpoch(guildId) {
  return autoplayEpoch.get(guildId) || 0;
}

function bumpEpoch(guildId) {
  autoplayEpoch.set(guildId, getEpoch(guildId) + 1);
}

function getSession(guildId) {
  let session = sessions.get(guildId);
  if (!session) {
    const stored = profileStore.getSession(guildId);
    session = {
      manualSeeds: stored?.manualSeeds ?? [],
      seedCursor: stored?.seedCursor ?? 0,
      currentSeed: stored?.currentSeed ?? null,
      recent: (stored?.recent ?? []).map((info) => normalizeTrack({ info })).filter(Boolean),
    };
    sessions.set(guildId, session);
  }
  return session;
}

function persistSession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  profileStore.saveSession(guildId, {
    manualSeeds: session.manualSeeds,
    seedCursor: session.seedCursor,
    currentSeed: session.currentSeed,
    recent: session.recent.map((entry) => snapshotTrackInfo(entry)),
  });
}

function clearSession(guildId) {
  sessions.delete(guildId);
  profileStore.clearSession(guildId);
}

function setCurrentSeed(guildId, seed) {
  const session = getSession(guildId);
  session.currentSeed = seed;
  persistSession(guildId);
}

function tasteEntry(normalized, extra = {}) {
  return {
    key: normalized.key,
    artistKey: normalized.artistKey,
    authorKey: normalized.authorKey,
    title: normalized.title,
    author: normalized.author,
    identifier: normalized.identifier,
    uri: normalized.uri,
    duration: normalized.duration,
    sourceName: normalized.sourceName,
    ...extra,
  };
}

function addToRecentTracks(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!guildId || !normalized) return;

  const { recent } = getSession(guildId);
  if (recent.some((entry) => entry.key === normalized.key)) return;

  recent.push(normalized);
  if (recent.length > MAX_RECENT_TRACKS) {
    recent.splice(0, recent.length - MAX_RECENT_TRACKS);
  }
  persistSession(guildId);
}

// Every started track counts as played so autoplay does not bring it back soon after.
function recordTrackPlayed(guildId, track) {
  if (!guildId || isLocalUploadTrack(track) || isStreamTrack(track)) return;
  const normalized = normalizeTrack(track);
  if (!normalized) return;
  profileStore.recordPlayed(guildId, { key: normalized.key, artistKey: normalized.artistKey });
}

// The pool survives skips: the skip is recorded as feedback and the next pick re-scores
// the pool against it, so skipping never waits for a new round of searches.
function recordAutoplaySkip(guildId, track, playback = {}) {
  if (!guildId || !track?.isAutoplay) return;

  const feedback = classifyAutoplaySkip(track, playback);
  if (!feedback?.normalized) return;

  const { normalized } = feedback;
  if (!feedback.record) {
    logAutoplay('debug', `Skip ignored for feedback after accepted listen: "${normalized.title}" (${formatPlaybackFeedback(feedback)})`);
    return false;
  }

  const { currentSeed } = getSession(guildId);
  if (currentSeed && normalizeTrack({ info: currentSeed })?.key === normalized.key) {
    setCurrentSeed(guildId, null);
  }

  profileStore.recordSkip(guildId, tasteEntry(normalized, { strength: feedback.strength }));
  logAutoplay('info', `${feedback.strength} negative feedback saved for "${normalized.title}" by ${normalized.artist || 'unknown'} (${formatPlaybackFeedback(feedback)})`);
  return true;
}

function classifyAutoplaySkip(track, playback = {}) {
  const normalized = normalizeTrack(track);
  if (!normalized) return null;

  const position = normalizePlaybackPosition(playback.position);
  const duration = normalized.duration || 0;
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const accepted = duration > 0
    ? ratio >= ACCEPTED_PLAY_MIN_RATIO || (position >= ACCEPTED_PLAY_MIN_MS && ratio >= QUICK_SKIP_MAX_RATIO)
    : position >= ACCEPTED_PLAY_MIN_MS;

  if (accepted) {
    return { normalized, record: false, position, ratio };
  }

  const quick = position <= QUICK_SKIP_MAX_MS || (duration > 0 && ratio <= QUICK_SKIP_MAX_RATIO);
  return {
    normalized,
    record: true,
    strength: quick ? 'strong' : 'normal',
    position,
    ratio,
  };
}

function normalizePlaybackPosition(position) {
  const value = Number(position);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function formatPlaybackFeedback(feedback) {
  const seconds = Math.round((feedback.position || 0) / 1000);
  const ratio = Number.isFinite(feedback.ratio) ? Math.round(feedback.ratio * 100) : 0;
  return `${seconds}s/${ratio}%`;
}

// Skip feedback fades: full weight for two hours, half for the rest of the day, then a quarter.
function skipWeight(age) {
  if (age < SKIP_MEMORY_TTL) return 1;
  if (age < SKIP_DAY_MS) return 0.5;
  return 0.25;
}

function getSkippedEntries(guildId, taste = profileStore.getTaste(guildId), now = Date.now()) {
  return taste.skips.map((entry) => ({
    ...entry,
    skippedAt: entry.at,
    weight: skipWeight(now - entry.at),
  }));
}

function wasRecentlySkipped(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return false;
  const cutoff = Date.now() - SKIP_MEMORY_TTL;
  return profileStore.getTaste(guildId).skips.some((entry) => entry.key === normalized.key && entry.at >= cutoff);
}

// People in the bot's voice channel who are actually listening: no bots, nobody deafened.
function getListenerIds(player, client) {
  const channelId = player?.voiceChannelId;
  const members = channelId ? client?.guilds?.cache?.get(player.guildId)?.channels?.cache?.get(channelId)?.members : null;
  if (!members) return [];
  const ids = [];
  for (const member of members.values()) {
    if (member?.user?.bot || member?.voice?.selfDeaf || member?.voice?.deaf) continue;
    ids.push(member.id);
  }
  return ids;
}

function likedEntries(userId) {
  return library.listLiked(userId)
    .map((entry) => normalizeTrack(library.entryToTrack(entry)))
    .filter(Boolean);
}

// Likes and dislikes belong to people, so only the people listening right now shape the pick.
// One listener's dislike rejects a track; an artist's dislike count is the most any single
// listener gave it. Liked artists count how many listeners like them. Plays stay server-wide.
function buildTasteContext(taste, now, listenerIds = []) {
  const likedKeys = new Set();
  const likedArtistCounts = new Map();
  const dislikedKeys = new Set();
  const dislikedArtistCounts = new Map();

  for (const userId of new Set(listenerIds)) {
    const artists = new Set();
    for (const liked of likedEntries(userId)) {
      likedKeys.add(liked.key);
      if (liked.artistKey) artists.add(liked.artistKey);
    }
    for (const artistKey of artists) likedArtistCounts.set(artistKey, (likedArtistCounts.get(artistKey) || 0) + 1);

    const perArtist = new Map();
    for (const entry of userTaste.listDislikes(userId, now)) {
      dislikedKeys.add(entry.key);
      if (entry.artistKey) perArtist.set(entry.artistKey, (perArtist.get(entry.artistKey) || 0) + 1);
    }
    for (const [artistKey, count] of perArtist) {
      dislikedArtistCounts.set(artistKey, Math.max(count, dislikedArtistCounts.get(artistKey) || 0));
    }
  }

  return {
    now,
    likedKeys,
    likedArtistCounts,
    dislikedKeys,
    dislikedArtistCounts,
    played: new Map(taste.played.map((entry) => [entry.key, entry.at])),
  };
}

// Cancels the pending preparation and forgets the prepared track. The candidate pool is kept.
function clearAutoplayPrefetch(guildId) {
  const timer = prepareTimers.get(guildId);
  if (timer?.timeout) clearTimeout(timer.timeout);
  prepareTimers.delete(guildId);
  if (pool.clearNext(guildId)) autoplayEvents.emit('next-changed', guildId);
}

function addManualSeed(guildId, trackOrInfo, options = {}) {
  if (!guildId || !trackOrInfo || isLocalUploadTrack(trackOrInfo) || isStreamTrack(trackOrInfo)) return false;

  const info = snapshotTrackInfo(trackOrInfo);
  const normalized = info ? normalizeTrack({ info }) : null;
  if (!info || !normalized) return false;

  const session = getSession(guildId);
  const next = session.manualSeeds.filter((entry) => entry.key !== normalized.key);
  next.push({
    ...info,
    key: normalized.key,
    addedAt: Date.now(),
  });

  if (next.length > MAX_MANUAL_SEEDS) {
    next.splice(0, next.length - MAX_MANUAL_SEEDS);
  }

  session.manualSeeds = next;
  session.seedCursor = 0;
  session.currentSeed = null;
  persistSession(guildId);
  resetGeminiAutoplayState(guildId);
  autoplayBlockedUntil.delete(guildId);
  autoplayPlaybackFailureBlocks.delete(guildId);
  if (options.invalidatePrefetch !== false) clearAutoplayPrefetch(guildId);
  logAutoplay('debug', `Manual seed added (${next.length}/${MAX_MANUAL_SEEDS}): "${info.title}" by ${info.author || 'unknown'}`);
  return true;
}

function getManualSeedPool(guildId) {
  return getSession(guildId).manualSeeds;
}

function selectManualSeeds(guildId, limit = ACTIVE_MANUAL_SEEDS) {
  const session = getSession(guildId);
  const seeds = session.manualSeeds;
  if (!seeds.length || limit <= 0) return [];

  const count = Math.min(limit, seeds.length);
  const cursor = session.seedCursor % seeds.length;
  const selected = [];

  for (let offset = 0; offset < count; offset += 1) {
    const reverseIndex = (cursor + offset) % seeds.length;
    selected.push(seeds[seeds.length - 1 - reverseIndex]);
  }

  session.seedCursor = (cursor + 1) % seeds.length;
  persistSession(guildId);
  return selected;
}

// The pool belongs to a listening profile; a new manual seed means a new profile.
function getProfileKey(guildId) {
  const seeds = getManualSeedPool(guildId).map((entry) => entry.key);
  return seeds.length ? seeds.join(',') : 'auto';
}

function buildContext(guildId, seedTrack, lastTrack, selectedManualSeeds = [], listenerIds = []) {
  const seed = normalizeTrack(seedTrack);
  const last = normalizeTrack(lastTrack);
  const manualSeeds = getManualSeedPool(guildId)
    .map((entry) => normalizeTrack({ info: entry }))
    .filter(Boolean);
  const activeSeeds = selectedManualSeeds
    .map((entry) => normalizeTrack({ info: entry }))
    .filter(Boolean);
  const root = manualSeeds.at(-1) ?? null;
  const session = getSession(guildId);
  const current = session.currentSeed ? normalizeTrack({ info: session.currentSeed }) : null;
  const primary = activeSeeds[0] || (manualSeeds.length ? root : current) || seed || last;
  const recent = session.recent;
  const now = Date.now();
  const taste = profileStore.getTaste(guildId, now);
  const skipped = getSkippedEntries(guildId, taste, now);

  return {
    guildId,
    seed,
    last,
    root,
    current,
    primary,
    manualSeeds,
    activeSeeds: activeSeeds.length ? activeSeeds : [primary].filter(Boolean),
    recent,
    skipped,
    listenerIds,
    taste: buildTasteContext(taste, now, listenerIds),
    seedArtist: primary?.artist || last?.artist || '',
    seedTitle: primary?.cleanTitle || primary?.title || last?.cleanTitle || last?.title || '',
    seedDuration: primary?.duration || last?.duration || 0,
  };
}

// Idempotent bookkeeping for the track autoplay continues from.
function noteSeedTrack(guildId, lastTrack) {
  if (lastTrack.isAutoplay) {
    if (wasRecentlySkipped(guildId, lastTrack)) return;
    const acceptedSeed = snapshotTrackInfo(lastTrack);
    if (acceptedSeed) setCurrentSeed(guildId, acceptedSeed);
  } else if (!isLocalUploadTrack(lastTrack) && !getManualSeedPool(guildId).length) {
    if (addManualSeed(guildId, lastTrack, { invalidatePrefetch: false })) {
      logAutoplay('debug', `Recovered missing manual seed from the current track: "${lastTrack.info.title}"`);
    }
  }
}

async function buildPool(player, lastTrack, client) {
  const guildId = player.guildId;
  const node = player.node;
  const epoch = getEpoch(guildId);

  noteSeedTrack(guildId, lastTrack);
  addToRecentTracks(guildId, lastTrack);

  if (!node?.connected) {
    logAutoplay('warn', 'Node not connected');
    return false;
  }

  const selectedManualSeeds = selectManualSeeds(guildId);
  const activeSeed = selectedManualSeeds[0] || getSession(guildId).currentSeed || (
    isLocalUploadTrack(lastTrack) ? null : snapshotTrackInfo(lastTrack)
  );
  if (!activeSeed) {
    logAutoplay('debug', 'No manual seed profile available after local upload; not building autoplay pool');
    return false;
  }

  const seedTrack = { info: activeSeed };
  const context = buildContext(guildId, seedTrack, lastTrack, selectedManualSeeds, getListenerIds(player, client));
  if (!context.seedArtist && !context.seedTitle) {
    logAutoplay('debug', 'Could not build seed context');
    return false;
  }

  const profileKey = getProfileKey(guildId);
  const planPromise = getDiscoveryArtists(context, { logger: logAutoplay }).catch(() => []);
  const requester = client?.user ?? null;
  const startedAt = Date.now();

  const candidates = await collectCandidates([
    radioSource({ node, requester, context, seedNormalized: context.seed }),
    searchSource({ node, requester, context }),
    discoverySource({ node, requester, context, planPromise }),
    lastfmSource({ node, requester, context }),
  ]);

  if (getEpoch(guildId) !== epoch) {
    logAutoplay('debug', 'Discarding pool build from a previous session');
    return false;
  }

  const state = pool.mergeCandidates(guildId, candidates, { profileKey });
  state.seedTrack = seedTrack;
  state.activeSeeds = selectedManualSeeds;
  logAutoplay('info', `Pool built in ${Date.now() - startedAt}ms: ${candidates.length} results, ${state.candidates.size} candidates`);
  return candidates.length > 0;
}

function startBuild(player, lastTrack, client) {
  const guildId = player.guildId;
  const state = pool.ensurePool(guildId);
  if (state.building) return state.building;

  const building = buildPool(player, lastTrack, client)
    .catch((error) => {
      logAutoplay('warn', `Pool build failed: ${error.message}`);
      return false;
    })
    .finally(() => {
      if (state.building === building) state.building = null;
    });
  state.building = building;
  return building;
}

function scorePool(guildId, lastTrack, listenerIds = []) {
  const state = pool.getPool(guildId);
  const context = buildContext(guildId, state?.seedTrack ?? lastTrack, lastTrack, state?.activeSeeds ?? [], listenerIds);
  const scored = pool.getCandidates(guildId).map((candidate) => ({
    ...candidate,
    ...scoreCandidate(candidate, context),
  }));
  return { context, scored, eligibleCount: scored.filter((candidate) => !candidate.rejected).length };
}

// Gemini sees every candidate; the local fallback keeps to the radio/search pool so an AI outage
// behaves like the original autoplay.
function selectionPools(scored) {
  const eligible = scored.filter((candidate) => !candidate.rejected);
  const core = eligible.filter((candidate) => candidate.source !== 'discovery');
  return { aiPool: scored, localPool: core.length ? core : scored };
}

async function selectCandidate(
  scoredCandidates,
  context,
  aiSelector = pickCandidateWithGemini,
  fallbackCandidates = scoredCandidates,
) {
  const aiSelected = await aiSelector(scoredCandidates, context, { logger: logAutoplay });
  return aiSelected || pickCandidateLocally(fallbackCandidates);
}

function logCandidateSummary(scoredCandidates, selected) {
  const top = scoredCandidates
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((candidate) => `${candidate.score}:${candidate.normalized.artist || '?'} - ${candidate.normalized.title}`)
    .join(' | ');

  if (top) logAutoplay('debug', `Top candidates: ${top}`);
  if (selected) {
    const selector = Number.isFinite(selected.aiScore) ? 'Gemini' : 'local fallback';
    const score = Number.isFinite(selected.aiScore) ? selected.aiScore : selected.score;
    const reason = selected.aiReason || selected.reason;
    const cacheMarker = selected.aiCached ? ', cached' : '';
    const laneMarker = selected.aiRelationship ? `, ${selected.aiRelationship}` : '';
    const orbitMarker = selected.aiOrbitPreference ? `, target:${selected.aiOrbitPreference}` : '';
    logAutoplay(
      'info',
      `Selected by ${selector} (${score}${cacheMarker}${laneMarker}${orbitMarker}) from ${selected.source}: "${selected.normalized.title}" by ${selected.normalized.artist || selected.normalized.author || 'unknown'} (${reason})`,
    );
  }
}

function refreshInBackground(player, lastTrack, client, eligibleCount) {
  const guildId = player.guildId;
  if (!pool.needsRefresh(guildId, { eligibleCount, profileKey: getProfileKey(guildId) })) return;
  startBuild(player, lastTrack, client);
}

// Picks a track from the pool, building it first only when there is nothing usable yet.
async function pickFromPool(player, lastTrack, client, { useAi }) {
  const guildId = player.guildId;
  const listenerIds = getListenerIds(player, client);

  if (pool.needsSyncBuild(guildId, getProfileKey(guildId))) {
    await startBuild(player, lastTrack, client);
  }

  let { context, scored, eligibleCount } = scorePool(guildId, lastTrack, listenerIds);
  if (!eligibleCount) {
    await startBuild(player, lastTrack, client);
    ({ context, scored, eligibleCount } = scorePool(guildId, lastTrack, listenerIds));
  }
  if (!eligibleCount) {
    logCandidateSummary(scored, null);
    logAutoplay('debug', 'No candidate reached minimum score');
    return null;
  }

  const { aiPool, localPool } = selectionPools(scored);
  const aiSelector = useAi ? pickCandidateWithGemini : async () => null;
  const selected = await selectCandidate(aiPool, context, aiSelector, localPool);
  logCandidateSummary(scored, selected);
  return selected ? { selected, eligibleCount } : null;
}

function isPlayerIdle(player) {
  return player.queue.tracks.length === 0;
}

function describeNext(next) {
  if (!next?.track?.info) return null;
  const info = next.track.info;
  return {
    title: info.title,
    author: info.author,
    uri: info.uri,
    identifier: info.identifier,
    artworkUrl: info.artworkUrl || null,
    duration: info.duration ?? info.length ?? 0,
    source: next.source,
    reason: next.reason,
  };
}

function getAutoplayNext(guildId) {
  return describeNext(pool.getNext(guildId));
}

async function prepareNext(player, track, client, { useAi = true } = {}) {
  const guildId = player.guildId;
  const trackKey = getTrackCacheKey(track);
  const epoch = getEpoch(guildId);
  const stillCurrent = () => (
    getEpoch(guildId) === epoch &&
    isAutoplayEnabled(guildId) &&
    isPlayerIdle(player) &&
    getTrackCacheKey(player.queue.current) === trackKey
  );
  if (!stillCurrent()) return null;

  noteSeedTrack(guildId, track);
  const result = await pickFromPool(player, track, client, { useAi });
  if (!result || !stillCurrent()) return null;

  const { selected, eligibleCount } = result;
  pool.setNext(guildId, {
    candidate: selected,
    track: selected.track,
    key: selected.normalized.key,
    source: selected.source,
    reason: selected.aiReason || selected.reason,
    preparedFor: trackKey,
    epoch,
  });
  autoplayEvents.emit('next-changed', guildId);
  refreshInBackground(player, track, client, eligibleCount - 1);
  return selected.track;
}

function scheduleAutoplayPrefetch(player, track, client) {
  const guildId = player?.guildId;
  const trackKey = getTrackCacheKey(track);
  if (!guildId || !trackKey || !track?.info) return;

  clearAutoplayPrefetch(guildId);

  if (!isAutoplayEnabled(guildId)) return;
  if (!isPlayerIdle(player)) return;
  if (isStreamTrack(track)) return;

  const timeout = setTimeout(() => {
    prepareTimers.delete(guildId);
    prepareNext(player, track, client).catch((error) => {
      logAutoplay('warn', `Preparing next track failed: ${error.message}`);
    });
  }, PREPARE_DELAY_MS);
  timeout.unref?.();
  prepareTimers.set(guildId, { trackKey, timeout });
}

// Uses the prepared track when it was prepared for this exact track and still passes scoring
// after any skip feedback recorded since; otherwise picks locally from the pool.
function takePreparedNext(guildId, lastTrack, listenerIds = []) {
  const next = pool.getNext(guildId);
  if (!next) return null;

  pool.clearNext(guildId);
  autoplayEvents.emit('next-changed', guildId);
  if (next.preparedFor !== getTrackCacheKey(lastTrack) || next.epoch !== getEpoch(guildId)) return null;

  const state = pool.getPool(guildId);
  const context = buildContext(guildId, state?.seedTrack ?? lastTrack, lastTrack, state?.activeSeeds ?? [], listenerIds);
  const verdict = scoreCandidate(next.candidate, context);
  if (verdict.rejected) {
    logAutoplay('info', `Prepared track no longer fits (${verdict.reason}): "${next.track.info.title}"`);
    return null;
  }
  return next.candidate;
}

function emitExhausted(player, reason) {
  const guildId = player.guildId;
  if (!player.node?.connected || !isAutoplayEnabled(guildId)) return;
  const lastNotice = exhaustedNoticeAt.get(guildId) || 0;
  if (Date.now() - lastNotice < EXHAUSTED_NOTICE_COOLDOWN_MS) return;
  exhaustedNoticeAt.set(guildId, Date.now());
  autoplayEvents.emit('exhausted', guildId, { reason });
}

async function handleAutoplay(player, lastTrack, client) {
  const guildId = player.guildId;
  const epoch = getEpoch(guildId);

  if (!lastTrack?.info) return false;
  if (!isAutoplayEnabled(guildId)) return false;
  if (autoplayPlaybackFailureBlocks.has(guildId)) return false;
  if ((autoplayBlockedUntil.get(guildId) || 0) > Date.now()) return false;
  if (player.queue.tracks.length > 0) return false;
  if (player.queue.current && player.playing) return false;

  if (autoplayInProgress.has(guildId)) {
    logAutoplay('debug', `Already in progress for guild ${guildId}, skipping`);
    return false;
  }

  autoplayInProgress.add(guildId);
  const startedAt = Date.now();

  try {
    const timer = prepareTimers.get(guildId);
    if (timer?.timeout) clearTimeout(timer.timeout);
    prepareTimers.delete(guildId);

    noteSeedTrack(guildId, lastTrack);
    addToRecentTracks(guildId, lastTrack);

    const listenerIds = getListenerIds(player, client);
    let selected = takePreparedNext(guildId, lastTrack, listenerIds);
    let eligibleCount = null;
    const usedPrepared = Boolean(selected);
    if (!selected) {
      const result = await pickFromPool(player, lastTrack, client, { useAi: false });
      selected = result?.selected ?? null;
      eligibleCount = result?.eligibleCount ?? null;
    }

    if (!selected) {
      if (getEpoch(guildId) === epoch) emitExhausted(player, 'no-candidates');
      return false;
    }
    if (getEpoch(guildId) !== epoch) return false;
    if (client?.lavalink?.players?.get(guildId) !== player) return false;
    if (!isAutoplayEnabled(guildId) || player.queue.tracks.length > 0) return false;
    if (player.queue.current && player.playing) return false;

    pool.recordPick(guildId, selected.normalized.key);
    const nextTrack = selected.track;
    nextTrack.isAutoplay = true;
    await player.queue.add(nextTrack);

    if (!player.playing && !player.paused) {
      await player.play();
    }

    logAutoplay('info', `Queued ${usedPrepared ? 'prepared' : 'pool'} track in ${Date.now() - startedAt}ms: "${nextTrack.info.title}"`);
    refreshInBackground(
      player,
      lastTrack,
      client,
      eligibleCount === null ? scorePool(guildId, lastTrack, listenerIds).eligibleCount : eligibleCount - 1,
    );
    return true;
  } catch (error) {
    logAutoplay('warn', `Failed: ${error.message}`);
    return false;
  } finally {
    autoplayInProgress.delete(guildId);
  }
}

function blockAutoplayAfterPlaybackFailure(guildId) {
  if (!guildId) return;

  const wasBlocked = autoplayPlaybackFailureBlocks.has(guildId);
  autoplayPlaybackFailureBlocks.add(guildId);
  bumpEpoch(guildId);
  clearAutoplayPrefetch(guildId);

  if (!wasBlocked) {
    logAutoplay('warn', `Suspended for guild ${guildId} after a playback failure; waiting for a successful or manual track`);
  }
}

function resumeAutoplayAfterPlaybackSuccess(guildId) {
  if (!guildId) return;
  autoplayPlaybackFailureBlocks.delete(guildId);
}

function clearAutoplayState(guildId) {
  bumpEpoch(guildId);
  autoplayBlockedUntil.set(guildId, Date.now() + 15_000);
  clearAutoplayPrefetch(guildId);
  pool.clearPool(guildId);
  clearSession(guildId);
  autoplayPlaybackFailureBlocks.delete(guildId);
  exhaustedNoticeAt.delete(guildId);
  resetGeminiAutoplayState(guildId);
}

// Re-seeds the session from what people actually queued recently (plus a few tracks liked by
// the people listening now), for when autoplay has drifted away from the server's taste.
function rebuildProfileFromHistory(guildId, listenerIds = []) {
  if (!guildId) return { seeds: 0 };

  const { items } = getGuildHistory(guildId, { page: 0, limit: 100 });
  const picked = new Map();
  for (const item of items) {
    if (picked.size >= REBUILD_HISTORY_SEEDS) break;
    if (item.autoplay || !item.track) continue;
    const info = { ...item.track, identifier: item.track.identifier ?? identifierFromUri(item.track.uri) };
    // History keeps no stream flag; a known duration or a YouTube id marks a regular track.
    if (isLocalUploadTrack(info) || (isStreamTrack(info) && !info.identifier)) continue;
    const normalized = normalizeTrack({ info });
    if (!normalized || picked.has(normalized.key)) continue;
    picked.set(normalized.key, info);
  }

  // Round-robin across listeners so one long Liked list does not take every slot.
  const likedLists = [...new Set(listenerIds)].map((userId) => library.listLiked(userId));
  let likedAdded = 0;
  for (let index = 0; likedAdded < REBUILD_LIKED_SEEDS && likedLists.some((list) => index < list.length); index += 1) {
    for (const list of likedLists) {
      if (likedAdded >= REBUILD_LIKED_SEEDS || !list[index]) continue;
      const track = library.entryToTrack(list[index]);
      const normalized = normalizeTrack(track);
      if (!normalized || picked.has(normalized.key)) continue;
      picked.set(normalized.key, track.info);
      likedAdded += 1;
    }
  }

  // History is newest first; seeds are stored oldest first so the newest stays the root.
  const seeds = [...picked.entries()].reverse().map(([key, info]) => ({
    ...snapshotTrackInfo(info),
    key,
    addedAt: Date.now(),
  }));

  const session = getSession(guildId);
  session.manualSeeds = seeds.slice(-MAX_MANUAL_SEEDS);
  session.seedCursor = 0;
  session.currentSeed = null;
  persistSession(guildId);

  bumpEpoch(guildId);
  clearAutoplayPrefetch(guildId);
  pool.clearPool(guildId);
  resetGeminiAutoplayState(guildId);
  autoplayPlaybackFailureBlocks.delete(guildId);
  logAutoplay('info', `Profile rebuilt from history for guild ${guildId}: ${seeds.length} seeds`);
  return { seeds: seeds.length };
}

function feedbackEntry(track) {
  if (!track || isLocalUploadTrack(track) || isStreamTrack(track)) return null;
  const normalized = normalizeTrack(track);
  return normalized ? tasteEntry(normalized) : null;
}

// Streams and local uploads have no stable identity to rate.
function canRateTrack(track) {
  return feedbackEntry(track) !== null;
}

// 'like', 'dislike' or null: what this person thinks of the track. A like is the track being
// on their library Liked list.
function getTrackFeedback(userId, track) {
  const entry = feedbackEntry(track);
  if (!userId || !entry) return null;
  if (userTaste.isDisliked(userId, entry.key)) return 'dislike';
  return library.listLiked(userId).some((liked) => liked.key === entry.key) ? 'like' : null;
}

// Toggles the track on the person's Liked list. Returns { liked } or null when the track cannot
// carry feedback (streams, uploads, tracks without an encoded form).
function likeTrack(userId, track) {
  const entry = feedbackEntry(track);
  const result = userId && entry ? library.toggleLiked(userId, track) : null;
  if (!result) return null;
  const { liked } = result;
  logAutoplay('info', `${liked ? 'Liked' : 'Like removed'}: "${entry.title}" by ${entry.author || 'unknown'}`);
  return { liked };
}

// Records the person's dislike and drops the track from the server's seeds. The caller skips
// the track; the next pick re-scores the pool, so the prepared track is redone as well.
function dislikeTrack(guildId, userId, track) {
  const entry = feedbackEntry(track);
  if (!guildId || !userId || !entry) return null;
  userTaste.recordDislike(userId, entry);
  library.removeLiked(userId, entry.key);

  const session = getSession(guildId);
  const seeds = session.manualSeeds.filter((seed) => seed.key !== entry.key);
  const currentSeedKey = session.currentSeed ? normalizeTrack({ info: session.currentSeed })?.key : null;
  if (seeds.length !== session.manualSeeds.length || currentSeedKey === entry.key) {
    session.manualSeeds = seeds;
    session.seedCursor = 0;
    if (currentSeedKey === entry.key) session.currentSeed = null;
    persistSession(guildId);
  }

  clearAutoplayPrefetch(guildId);
  logAutoplay('info', `Disliked: "${entry.title}" by ${entry.author || 'unknown'}`);
  return { disliked: true };
}

// Replaces the prepared track. The rejected pick is remembered as a 'reroll' skip, which only
// excludes that exact track (not its artist), and the next one comes from the existing pool.
const REROLL_FAILURES = {
  disabled: 'Autoplay is off.',
  unavailable: 'Autoplay only picks the next track once the queue is empty.',
  cooldown: 'Give it a second before rerolling again.',
  exhausted: "Autoplay couldn't find another fitting track right now.",
};

async function rerollNext(player, client) {
  const guildId = player?.guildId;
  if (!guildId || !isAutoplayEnabled(guildId)) return { ok: false, reason: 'disabled' };
  const current = player.queue.current;
  if (!current?.info || !isPlayerIdle(player) || isStreamTrack(current)) return { ok: false, reason: 'unavailable' };

  const now = Date.now();
  if (now - (rerollAt.get(guildId) || 0) < REROLL_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
  rerollAt.set(guildId, now);

  const rejected = feedbackEntry(pool.getNext(guildId)?.track);
  if (rejected) profileStore.recordSkip(guildId, { ...rejected, strength: 'reroll' });
  clearAutoplayPrefetch(guildId);

  const track = await prepareNext(player, current, client, { useAi: false });
  if (!track) return { ok: false, reason: 'exhausted' };
  logAutoplay('info', `Rerolled next track: "${track.info.title}"${rejected ? ` instead of "${rejected.title}"` : ''}`);
  return { ok: true, next: getAutoplayNext(guildId) };
}

function identifierFromUri(uri) {
  if (typeof uri !== 'string') return undefined;
  const match = uri.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || uri.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  return match?.[1];
}

module.exports = {
  autoplayEvents,
  isAutoplayEnabled,
  setAutoplay,
  toggleAutoplay,
  getAutoplayNext,
  handleAutoplay,
  scheduleAutoplayPrefetch,
  clearAutoplayPrefetch,
  clearAutoplayState,
  blockAutoplayAfterPlaybackFailure,
  resumeAutoplayAfterPlaybackSuccess,
  addToRecentTracks,
  recordAutoplaySkip,
  addManualSeed,
  recordTrackPlayed,
  rebuildProfileFromHistory,
  canRateTrack,
  getTrackFeedback,
  likeTrack,
  dislikeTrack,
  rerollNext,
  getListenerIds,
  REROLL_FAILURES,
  __testing: {
    buildContext,
    buildTasteContext,
    buildDiscoveryQueries,
    buildSearchQueries,
    scoreCandidate,
    getManualSeedPool,
    selectManualSeeds,
    selectCandidate,
    wasRecentlySkipped,
    prepareNext,
    isPlaybackFailureBlocked: (guildId) => autoplayPlaybackFailureBlocks.has(guildId),
    forgetSessionCache: () => sessions.clear(),
    resetRerollCooldown: () => rerollAt.clear(),
  },
};
