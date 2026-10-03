const { getConfig, setConfig, AUTOPLAY_MODES } = require('../state/guildConfig');
const { getDiscoveryArtists, getGenreRadioPlan, pickCandidateWithGemini, resetGeminiAutoplayState } = require('./autoplayAi');
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
} = require('./autoplay/sources');
const pool = require('./autoplay/pool');
const { autoplayEvents } = require('./autoplay/events');

const recentTracks = new Map();
const skippedAutoplayTracks = new Map();
const manualSeedPools = new Map();
const manualSeedCursors = new Map();
const currentAutoplaySeed = new Map();
const autoplayInProgress = new Set();
const autoplayEpoch = new Map();
const autoplayBlockedUntil = new Map();
const autoplayPlaybackFailureBlocks = new Set();
const prepareTimers = new Map();
const exhaustedNoticeAt = new Map();

const MAX_RECENT_TRACKS = 40;
const MAX_SKIPPED_TRACKS = 40;
const MAX_MANUAL_SEEDS = 40;
const ACTIVE_MANUAL_SEEDS = 3;
const SKIP_MEMORY_TTL = 2 * 60 * 60 * 1000;
const QUICK_SKIP_MAX_MS = 75_000;
const QUICK_SKIP_MAX_RATIO = 0.35;
const ACCEPTED_PLAY_MIN_MS = 90_000;
const ACCEPTED_PLAY_MIN_RATIO = 0.65;
const PREPARE_DELAY_MS = 3_000;
const GENRE_LOCK_MIN = 3;
const GENRE_LOCK_BACKUP = 4;
const EXHAUSTED_NOTICE_COOLDOWN_MS = 2 * 60 * 1000;

function isAutoplayEnabled(guildId) {
  const config = getConfig(guildId);
  return config.autoplay ?? false;
}

function getAutoplayMode(guildId) {
  const config = getConfig(guildId);
  return AUTOPLAY_MODES.has(config.autoplayMode) ? config.autoplayMode : 'ai_assisted';
}

function setAutoplayMode(guildId, mode) {
  if (!AUTOPLAY_MODES.has(mode)) return null;
  setConfig(guildId, { autoplayMode: mode });
  return mode;
}

function setAutoplay(guildId, enabled) {
  setConfig(guildId, { autoplay: enabled });
  if (enabled) autoplayPlaybackFailureBlocks.delete(guildId);
  if (!enabled) {
    bumpEpoch(guildId);
    clearAutoplayPrefetch(guildId);
    pool.clearPool(guildId);
    recentTracks.delete(guildId);
    skippedAutoplayTracks.delete(guildId);
    manualSeedPools.delete(guildId);
    manualSeedCursors.delete(guildId);
    currentAutoplaySeed.delete(guildId);
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

function addToRecentTracks(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!guildId || !normalized) return;

  const recent = recentTracks.get(guildId) ?? [];
  if (recent.some((entry) => entry.key === normalized.key)) return;

  recent.push(normalized);
  if (recent.length > MAX_RECENT_TRACKS) {
    recent.splice(0, recent.length - MAX_RECENT_TRACKS);
  }

  recentTracks.set(guildId, recent);
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

  const currentSeed = currentAutoplaySeed.get(guildId);
  if (currentSeed && normalizeTrack({ info: currentSeed })?.key === normalized.key) {
    currentAutoplaySeed.delete(guildId);
  }

  const skipped = pruneSkippedEntries(skippedAutoplayTracks.get(guildId) ?? []);
  const next = skipped.filter((entry) => entry.key !== normalized.key);
  next.push({
    ...normalized,
    skippedAt: Date.now(),
    strength: feedback.strength,
    position: feedback.position,
    ratio: feedback.ratio,
  });

  if (next.length > MAX_SKIPPED_TRACKS) {
    next.splice(0, next.length - MAX_SKIPPED_TRACKS);
  }

  skippedAutoplayTracks.set(guildId, next);
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

function pruneSkippedEntries(entries) {
  const cutoff = Date.now() - SKIP_MEMORY_TTL;
  return entries.filter((entry) => Number.isFinite(entry.skippedAt) && entry.skippedAt >= cutoff);
}

function getSkippedEntries(guildId) {
  const skipped = pruneSkippedEntries(skippedAutoplayTracks.get(guildId) ?? []);
  skippedAutoplayTracks.set(guildId, skipped);
  return skipped;
}

function wasRecentlySkipped(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return false;
  return getSkippedEntries(guildId).some((entry) => entry.key === normalized.key);
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

  const existing = manualSeedPools.get(guildId) ?? [];
  const next = existing.filter((entry) => entry.key !== normalized.key);
  next.push({
    ...info,
    key: normalized.key,
    addedAt: Date.now(),
  });

  if (next.length > MAX_MANUAL_SEEDS) {
    next.splice(0, next.length - MAX_MANUAL_SEEDS);
  }

  manualSeedPools.set(guildId, next);
  resetGeminiAutoplayState(guildId);
  manualSeedCursors.set(guildId, 0);
  currentAutoplaySeed.delete(guildId);
  autoplayBlockedUntil.delete(guildId);
  autoplayPlaybackFailureBlocks.delete(guildId);
  if (options.invalidatePrefetch !== false) clearAutoplayPrefetch(guildId);
  logAutoplay('debug', `Manual seed added (${next.length}/${MAX_MANUAL_SEEDS}): "${info.title}" by ${info.author || 'unknown'}`);
  return true;
}

function getManualSeedPool(guildId) {
  return manualSeedPools.get(guildId) ?? [];
}

function selectManualSeeds(guildId, limit = ACTIVE_MANUAL_SEEDS) {
  const seeds = getManualSeedPool(guildId);
  if (!seeds.length || limit <= 0) return [];

  const count = Math.min(limit, seeds.length);
  const cursor = manualSeedCursors.get(guildId) ?? 0;
  const selected = [];

  for (let offset = 0; offset < count; offset += 1) {
    const reverseIndex = (cursor + offset) % seeds.length;
    selected.push(seeds[seeds.length - 1 - reverseIndex]);
  }

  manualSeedCursors.set(guildId, (cursor + 1) % seeds.length);
  return selected;
}

// The pool belongs to a listening profile; a new manual seed or mode switch means a new profile.
function getProfileKey(guildId) {
  const seeds = getManualSeedPool(guildId).map((entry) => entry.key);
  return `${getAutoplayMode(guildId)}|${seeds.length ? seeds.join(',') : 'auto'}`;
}

function buildContext(guildId, seedTrack, lastTrack, selectedManualSeeds = []) {
  const seed = normalizeTrack(seedTrack);
  const last = normalizeTrack(lastTrack);
  const manualSeeds = getManualSeedPool(guildId)
    .map((entry) => normalizeTrack({ info: entry }))
    .filter(Boolean);
  const activeSeeds = selectedManualSeeds
    .map((entry) => normalizeTrack({ info: entry }))
    .filter(Boolean);
  const root = manualSeeds.at(-1) ?? null;
  const current = currentAutoplaySeed.has(guildId) ? normalizeTrack({ info: currentAutoplaySeed.get(guildId) }) : null;
  const primary = activeSeeds[0] || (manualSeeds.length ? root : current) || seed || last;
  const recent = recentTracks.get(guildId) ?? [];
  const skipped = getSkippedEntries(guildId);

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
    if (acceptedSeed) currentAutoplaySeed.set(guildId, acceptedSeed);
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
  const activeSeed = selectedManualSeeds[0] || currentAutoplaySeed.get(guildId) || (
    isLocalUploadTrack(lastTrack) ? null : snapshotTrackInfo(lastTrack)
  );
  if (!activeSeed) {
    logAutoplay('debug', 'No manual seed profile available after local upload; not building autoplay pool');
    return false;
  }

  const seedTrack = { info: activeSeed };
  const context = buildContext(guildId, seedTrack, lastTrack, selectedManualSeeds);
  if (!context.seedArtist && !context.seedTitle) {
    logAutoplay('debug', 'Could not build seed context');
    return false;
  }

  const mode = getAutoplayMode(guildId);
  const profileKey = getProfileKey(guildId);
  const planPromise = mode === 'classic'
    ? Promise.resolve([])
    : (mode === 'discovery' ? getGenreRadioPlan : getDiscoveryArtists)(context, { logger: logAutoplay })
      .catch(() => []);
  const requester = client?.user ?? null;
  const startedAt = Date.now();

  const candidates = await collectCandidates([
    radioSource({ node, requester, context, seedNormalized: context.seed }),
    searchSource({ node, requester, context }),
    discoverySource({ node, requester, context, planPromise }),
  ]);

  if (getEpoch(guildId) !== epoch) {
    logAutoplay('debug', 'Discarding pool build from a previous session');
    return false;
  }

  const state = pool.mergeCandidates(guildId, candidates, { profileKey });
  state.seedTrack = seedTrack;
  state.activeSeeds = selectedManualSeeds;
  logAutoplay('info', `Pool built in ${Date.now() - startedAt}ms: ${candidates.length} results, ${state.candidates.size} candidates (${mode})`);
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

function scorePool(guildId, lastTrack) {
  const state = pool.getPool(guildId);
  const context = buildContext(guildId, state?.seedTrack ?? lastTrack, lastTrack, state?.activeSeeds ?? []);
  const scored = pool.getCandidates(guildId).map((candidate) => ({
    ...candidate,
    ...scoreCandidate(candidate, context),
  }));
  return { context, scored, eligibleCount: scored.filter((candidate) => !candidate.rejected).length };
}

// Gemini sees every candidate; the local fallback keeps to the radio/search pool so an AI outage
// behaves like the original autoplay. Genre radio locks both onto the AI-planned artists.
function selectionPools(scored, mode) {
  const eligible = scored.filter((candidate) => !candidate.rejected);
  if (mode === 'discovery') {
    const locked = eligible.filter((candidate) => candidate.source === 'discovery');
    if (locked.length >= GENRE_LOCK_MIN) {
      const backup = eligible
        .filter((candidate) => candidate.source !== 'discovery')
        .sort((left, right) => right.score - left.score)
        .slice(0, GENRE_LOCK_BACKUP);
      const lockedPool = [...locked, ...backup];
      return { aiPool: lockedPool, localPool: lockedPool };
    }
  }

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
  const mode = getAutoplayMode(guildId);

  if (pool.needsSyncBuild(guildId, getProfileKey(guildId))) {
    await startBuild(player, lastTrack, client);
  }

  let { context, scored, eligibleCount } = scorePool(guildId, lastTrack);
  if (!eligibleCount) {
    await startBuild(player, lastTrack, client);
    ({ context, scored, eligibleCount } = scorePool(guildId, lastTrack));
  }
  if (!eligibleCount) {
    logCandidateSummary(scored, null);
    logAutoplay('debug', 'No candidate reached minimum score');
    return null;
  }

  const { aiPool, localPool } = selectionPools(scored, mode);
  const aiSelector = useAi && mode !== 'classic' ? pickCandidateWithGemini : async () => null;
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

async function prepareNext(player, track, client) {
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
  const result = await pickFromPool(player, track, client, { useAi: true });
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
function takePreparedNext(guildId, lastTrack) {
  const next = pool.getNext(guildId);
  if (!next) return null;

  pool.clearNext(guildId);
  autoplayEvents.emit('next-changed', guildId);
  if (next.preparedFor !== getTrackCacheKey(lastTrack) || next.epoch !== getEpoch(guildId)) return null;

  const state = pool.getPool(guildId);
  const context = buildContext(guildId, state?.seedTrack ?? lastTrack, lastTrack, state?.activeSeeds ?? []);
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

    let selected = takePreparedNext(guildId, lastTrack);
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
      eligibleCount === null ? scorePool(guildId, lastTrack).eligibleCount : eligibleCount - 1,
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
  recentTracks.delete(guildId);
  skippedAutoplayTracks.delete(guildId);
  manualSeedPools.delete(guildId);
  manualSeedCursors.delete(guildId);
  currentAutoplaySeed.delete(guildId);
  autoplayPlaybackFailureBlocks.delete(guildId);
  exhaustedNoticeAt.delete(guildId);
  resetGeminiAutoplayState(guildId);
}

const cleanupTimer = setInterval(() => {
  for (const [guildId, entries] of skippedAutoplayTracks) {
    const pruned = pruneSkippedEntries(entries);
    if (pruned.length) {
      skippedAutoplayTracks.set(guildId, pruned);
    } else {
      skippedAutoplayTracks.delete(guildId);
    }
  }
}, 10 * 60 * 1000);
cleanupTimer.unref?.();

module.exports = {
  autoplayEvents,
  isAutoplayEnabled,
  setAutoplay,
  toggleAutoplay,
  getAutoplayMode,
  setAutoplayMode,
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
  __testing: {
    buildContext,
    buildDiscoveryQueries,
    buildSearchQueries,
    scoreCandidate,
    getManualSeedPool,
    selectManualSeeds,
    selectCandidate,
    wasRecentlySkipped,
    prepareNext,
    isPlaybackFailureBlocked: (guildId) => autoplayPlaybackFailureBlocks.has(guildId),
  },
};
