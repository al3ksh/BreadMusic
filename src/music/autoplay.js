const { getConfig, setConfig } = require('../state/guildConfig');
const { getDiscoveryArtists, pickCandidateWithGemini, resetGeminiAutoplayState } = require('./autoplayAi');

const recentTracks = new Map();
const skippedAutoplayTracks = new Map();
const manualSeedPools = new Map();
const manualSeedCursors = new Map();
const currentAutoplaySeed = new Map();
const autoplayInProgress = new Set();
const autoplayEpoch = new Map();
const autoplayBlockedUntil = new Map();
const autoplayPlaybackFailureBlocks = new Set();
const autoplayPrefetch = new Map();

const MAX_RECENT_TRACKS = 40;
const MAX_SKIPPED_TRACKS = 40;
const MAX_MANUAL_SEEDS = 40;
const ACTIVE_MANUAL_SEEDS = 3;
const MAX_SAME_ARTIST_IN_ROW = 2;
const SEARCH_TIMEOUT = 8000;
const SKIP_MEMORY_TTL = 2 * 60 * 60 * 1000;
const MIN_SCORE = 35;
const TOP_PICK_POOL = 7;
const PICK_SCORE_WINDOW = 20;
const SELECTION_JITTER = 6;
const MAX_SEARCH_QUERIES = 6;
const MAX_SEARCH_TRACKS_PER_QUERY = 12;
const MAX_DISCOVERY_TRACKS_PER_ARTIST = 4;
const SKIPPED_ARTIST_REJECT_THRESHOLD = 2;
const SKIPPED_AUTHOR_REJECT_THRESHOLD = 1;
const QUICK_SKIP_MAX_MS = 75_000;
const QUICK_SKIP_MAX_RATIO = 0.35;
const ACCEPTED_PLAY_MIN_MS = 90_000;
const ACCEPTED_PLAY_MIN_RATIO = 0.65;
const PREFETCH_LEAD_MS = 20_000;
const MIN_PREFETCH_DELAY_MS = 5_000;
const AUTOPLAY_LOG_LEVELS = {
  silent: 0,
  warn: 1,
  info: 2,
  debug: 3,
};
const AUTOPLAY_LOG_LEVEL = AUTOPLAY_LOG_LEVELS[String(process.env.AUTOPLAY_LOG_LEVEL || 'warn').toLowerCase()]
  ?? AUTOPLAY_LOG_LEVELS.warn;

function logAutoplay(level, message) {
  const threshold = AUTOPLAY_LOG_LEVELS[level] ?? AUTOPLAY_LOG_LEVELS.info;
  if (AUTOPLAY_LOG_LEVEL < threshold) return;
  const writer = level === 'warn' ? console.warn : console.log;
  writer(`[Autoplay] ${message}`);
}

const HARD_REJECT_TERMS = [
  'karaoke',
  'reaction',
  'tutorial',
  'lesson',
  'how to',
  'podcast',
  'interview',
  'vlog',
  'challenge',
  'compilation',
  'best of',
  'top 10',
  'top 5',
  'review',
  'unboxing',
  'trailer',
  'teaser',
  'behind the scenes',
  'making of',
  'explained',
  'breakdown',
  'full album',
  'album completo',
  'hour mix',
  '1 hour',
  '10 hours',
  'blend',
  'mashup',
  'megamix',
  'non stop mix',
  'radio mix',
  'dj mix',
  '8d audio',
  'nightcore',
  'bass boosted',
];

const SOFT_PENALTIES = [
  ['remix', 24],
  ['cover', 22],
  ['live', 18],
  ['concert', 18],
  ['lyrics', 14],
  ['lyric video', 16],
  ['letra', 14],
  ['tlumaczenie', 14],
  ['napisy', 14],
  ['instrumental', 8],
  ['acoustic', 10],
  ['slowed', 28],
  ['reverb', 24],
  ['sped up', 28],
  ['nightcore', 30],
  ['8d audio', 24],
  ['bass boosted', 24],
  ['visualizer', 8],
  ['clean', 18],
  ['radio edit', 16],
  ['reupload', 14],
];

const POSITIVE_TERMS = [
  ['official audio', 12],
  ['audio', 6],
  ['topic', 8],
  ['provided to youtube', 8],
];

function isAutoplayEnabled(guildId) {
  const config = getConfig(guildId);
  return config.autoplay ?? false;
}

function setAutoplay(guildId, enabled) {
  setConfig(guildId, { autoplay: enabled });
  if (enabled) autoplayPlaybackFailureBlocks.delete(guildId);
  if (!enabled) {
    clearAutoplayPrefetch(guildId);
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

function recordAutoplaySkip(guildId, track, playback = {}) {
  if (!guildId || !track?.isAutoplay) return;

  clearAutoplayPrefetch(guildId);

  const feedback = classifyAutoplaySkip(track, playback);
  if (!feedback?.normalized) return;

  const { normalized } = feedback;
  if (!feedback.record) {
    logAutoplay('debug', `Skip ignored for feedback after accepted listen: "${normalized.title}" (${formatPlaybackFeedback(feedback)})`);
    return false;
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

function normalizeTrack(track) {
  if (!track?.info) return null;

  const info = track.info;
  const title = typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Unknown';
  const author = typeof info.author === 'string' && info.author.trim() ? info.author.trim() : '';
  const artist = extractArtistName(title, author);
  const clean = cleanTitle(title);
  const identifier = typeof info.identifier === 'string' ? info.identifier : '';
  const uri = typeof info.uri === 'string' ? info.uri : '';
  const duration = getDurationMs(info);
  const key = makeTrackKey({ identifier, uri, title: clean || title, artist });

  return {
    key,
    title,
    cleanTitle: clean,
    author,
    authorKey: normalizeComparable(author),
    artist,
    artistKey: normalizeComparable(artist),
    identifier,
    uri,
    duration,
    sourceName: typeof info.sourceName === 'string' ? info.sourceName : '',
  };
}

function makeTrackKey({ identifier = '', uri = '', title = '', artist = '' }) {
  if (identifier) return `id:${identifier}`;
  if (uri) return `uri:${uri}`;
  return `meta:${normalizeComparable(artist)}:${normalizeComparable(title)}`;
}

function getDurationMs(info = {}) {
  const duration = info.duration ?? info.length ?? 0;
  return Number.isFinite(duration) ? duration : 0;
}

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanArtistName(author) {
  if (!author) return '';
  return normalizeComparable(author)
    .replace(/\b(topic|vevo|official|music|records|recordings|label|entertainment)\b$/gi, '')
    .replace(/\b(ft|feat|featuring|prod)\b.*$/gi, '')
    .trim();
}

function cleanTitle(title) {
  if (!title) return '';
  return String(title)
    .replace(/\s*\([^)]*(official|video|audio|lyric|hd|hq|4k|prod|visualizer)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(official|video|audio|lyric|hd|hq|4k|prod|visualizer)[^\]]*\]/gi, '')
    .replace(/\s*[-|]\s*(official|video|audio|lyrics?|visualizer).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArtistName(title, author) {
  const fromAuthor = cleanArtistName(author);
  const titleParts = String(title || '').split(/\s[-\u2013\u2014|]\s/);

  if (titleParts.length >= 2) {
    const fromTitle = cleanArtistName(titleParts[0]);
    if (fromTitle && fromTitle.length > 1 && fromTitle.length < 45) {
      return fromTitle;
    }
  }

  if (fromAuthor && fromAuthor.length > 1 && fromAuthor.length < 45) {
    return fromAuthor;
  }

  const fallback = normalizeComparable(title).match(/^([a-z0-9 ]{2,35})\s+(official|audio|video|lyrics?)\b/i);
  return fallback ? fallback[1].trim() : '';
}

function hasTerm(text, term) {
  const normalizedText = ` ${normalizeComparable(text)} `;
  const normalizedTerm = ` ${normalizeComparable(term)} `;
  return normalizedText.includes(normalizedTerm);
}

function hasHardRejectTerm(track) {
  const haystack = `${track.title} ${track.author}`;
  return HARD_REJECT_TERMS.some((term) => hasTerm(haystack, term));
}

function getSoftPenalty(track) {
  const haystack = `${track.title} ${track.author}`;
  return SOFT_PENALTIES.reduce((total, [term, penalty]) => (
    hasTerm(haystack, term) ? total + penalty : total
  ), 0);
}

function getPositiveTermScore(track) {
  const haystack = `${track.title} ${track.author}`;
  return POSITIVE_TERMS.reduce((total, [term, score]) => (
    hasTerm(haystack, term) ? total + score : total
  ), 0);
}

function tokenSet(text) {
  const normalized = normalizeComparable(text);
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(' ')
      .filter((token) => token.length > 2 && !['the', 'and', 'feat', 'ft', 'official'].includes(token)),
  );
}

function tokenOverlap(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }

  return shared / Math.min(left.size, right.size);
}

function isTrackRecent(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return false;

  const recent = recentTracks.get(guildId) ?? [];
  return recent.some((entry) => (
    entry.key === normalized.key ||
    (
      entry.artist &&
      normalized.artist &&
      entry.artist === normalized.artist &&
      normalizeComparable(entry.cleanTitle) === normalizeComparable(normalized.cleanTitle)
    )
  ));
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

function getTrackCacheKey(track) {
  const info = track?.info;
  if (!info) return null;
  return [
    info.identifier || '',
    info.uri || '',
    normalizeComparable(info.author || ''),
    normalizeComparable(info.title || ''),
  ].join('|');
}

function clearAutoplayPrefetch(guildId) {
  const existing = autoplayPrefetch.get(guildId);
  if (existing?.timeout) clearTimeout(existing.timeout);
  autoplayPrefetch.delete(guildId);
}

function wasRecentlySkipped(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return false;
  return getSkippedEntries(guildId).some((entry) => entry.key === normalized.key);
}

function snapshotTrackInfo(trackOrInfo) {
  const info = trackOrInfo?.info ?? trackOrInfo;
  if (!info) return null;

  return {
    title: info.title,
    author: info.author,
    identifier: info.identifier,
    uri: info.uri,
    duration: info.duration ?? info.length,
    sourceName: info.sourceName,
  };
}

function isLocalUploadTrack(trackOrInfo) {
  const info = trackOrInfo?.info ?? trackOrInfo;
  if (!info) return false;

  return Boolean(
    trackOrInfo?.localUpload ||
    info.localUpload ||
    info.isLocalUpload ||
    info.sourceName === 'localUpload' ||
    (typeof info.uri === 'string' && info.uri.includes('/api/uploads/')),
  );
}

function addManualSeed(guildId, trackOrInfo, options = {}) {
  if (!guildId || !trackOrInfo || isLocalUploadTrack(trackOrInfo)) return false;

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
  const pool = getManualSeedPool(guildId);
  if (!pool.length || limit <= 0) return [];

  const count = Math.min(limit, pool.length);
  const cursor = manualSeedCursors.get(guildId) ?? 0;
  const selected = [];

  for (let offset = 0; offset < count; offset += 1) {
    const reverseIndex = (cursor + offset) % pool.length;
    selected.push(pool[pool.length - 1 - reverseIndex]);
  }

  manualSeedCursors.set(guildId, (cursor + 1) % pool.length);
  return selected;
}

function isArtistOverplayed(guildId, artistName) {
  if (!artistName) return false;

  const recent = recentTracks.get(guildId) ?? [];
  const lastTracks = recent.slice(-5);
  const sameArtistCount = lastTracks.filter((track) => track.artist === artistName).length;

  return sameArtistCount >= MAX_SAME_ARTIST_IN_ROW;
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

function buildSearchQueries(context) {
  const anchors = context.activeSeeds.length ? context.activeSeeds : [context.primary].filter(Boolean);
  const primaryArtist = context.seedArtist;
  const recentArtists = [...new Set(
    context.recent
      .slice(-8)
      .map((entry) => entry.artist)
      .filter(Boolean)
      .filter((entry) => entry !== primaryArtist),
  )];

  const queries = [];
  const add = (query, anchor = null, anchorRank = 0) => {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (normalized && !queries.some((entry) => entry.query === normalized)) {
      queries.push({
        query: normalized,
        anchorKey: anchor?.key || null,
        anchorRank,
      });
    }
  };

  anchors.forEach((anchor, index) => {
    const artist = anchor.artist;
    const title = cleanTitle(anchor.cleanTitle || anchor.title);
    if (artist && title) add(`${artist} ${title} radio`, anchor, index);
    if (artist) add(`${artist} radio mix`, anchor, index);
  });

  for (const [index, anchor] of anchors.entries()) {
    if (queries.length >= MAX_SEARCH_QUERIES) break;
    if (anchor.artist) add(`${anchor.artist} official audio`, anchor, index);
  }

  for (const recentArtist of recentArtists.slice(0, 2)) {
    if (queries.length >= MAX_SEARCH_QUERIES) break;
    add(`${recentArtist} ${primaryArtist} mix`);
  }

  return queries.slice(0, MAX_SEARCH_QUERIES);
}

function buildDiscoveryQueries(artists, context) {
  const coreArtistKeys = new Set(context.manualSeeds
    .map((seed) => normalizeComparable(seed.artist || seed.author))
    .filter(Boolean));
  const seen = new Set();

  return artists
    .map((entry) => ({
      artist: String(entry?.name || '').replace(/\s+/g, ' ').trim(),
      distance: entry?.distance,
    }))
    .filter((entry) => {
      const key = normalizeComparable(entry.artist);
      if (!key || coreArtistKeys.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      query: `${entry.artist} official audio`,
      artist: entry.artist,
      distance: entry.distance,
    }));
}

async function searchWithTimeout(node, query, requester) {
  let timeout;
  try {
    return await Promise.race([
      node.search({ query }, requester),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timeout')), SEARCH_TIMEOUT);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function searchTracks(node, query, client, limit = MAX_SEARCH_TRACKS_PER_QUERY) {
  if (!node?.connected || !query) return [];

  try {
    const result = await searchWithTimeout(node, `ytsearch:${query}`, client.user);
    return result?.tracks?.slice(0, limit) ?? [];
  } catch (error) {
    logAutoplay('debug', `Search failed for "${query}": ${error.message}`);
    return [];
  }
}

async function getYouTubeRadioMix(node, videoId, client) {
  if (!node?.connected || !videoId) return [];

  try {
    const radioUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
    logAutoplay('debug', `Fetching YouTube Radio Mix for ${videoId}`);

    const result = await searchWithTimeout(node, radioUrl, client.user);
    const tracks = result?.tracks ?? [];
    logAutoplay('debug', `YouTube Radio Mix returned ${tracks.length} tracks`);
    return tracks;
  } catch (error) {
    logAutoplay('debug', `YouTube Radio Mix failed: ${error.message}`);
    return [];
  }
}

function isYouTubeIdentifier(identifier) {
  return typeof identifier === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(identifier);
}

async function resolveYouTubeId(node, track, client) {
  const normalized = normalizeTrack(track);
  if (!normalized) return null;
  if (isYouTubeIdentifier(normalized.identifier)) return normalized.identifier;

  const query = `${normalized.artist || normalized.author} ${normalized.cleanTitle || normalized.title}`.trim();
  if (!query) return null;

  logAutoplay('debug', `Resolving YouTube ID for "${query}"`);

  try {
    const result = await searchWithTimeout(node, `ytsearch:${query}`, client.user);
    const identifier = result?.tracks?.[0]?.info?.identifier;
    if (isYouTubeIdentifier(identifier)) {
      logAutoplay('debug', `Resolved to YouTube ID: ${identifier}`);
      return identifier;
    }
  } catch (error) {
    logAutoplay('debug', `YouTube ID resolve failed: ${error.message}`);
  }

  return null;
}

function addCandidate(candidates, track, source, index = 0, anchorKey = null, anchorRank = 0, discoveryDistance = null) {
  const normalized = normalizeTrack(track);
  if (!normalized) return;

  const existing = candidates.get(normalized.key);
  const anchorKeys = new Set(existing?.anchorKeys ?? []);
  if (anchorKey) anchorKeys.add(anchorKey);
  const candidate = {
    track,
    normalized,
    source,
    sourceIndex: index,
    anchorKeys,
    anchorRank: Math.min(existing?.anchorRank ?? anchorRank, anchorRank),
    discoveryDistance: discoveryDistance || existing?.discoveryDistance || null,
  };

  if (!existing || sourcePriority(source) > sourcePriority(existing.source)) {
    candidates.set(normalized.key, candidate);
  } else {
    existing.anchorKeys = anchorKeys;
    existing.anchorRank = Math.min(existing.anchorRank ?? anchorRank, anchorRank);
    if (!existing.discoveryDistance && discoveryDistance) existing.discoveryDistance = discoveryDistance;
  }
}

function sourcePriority(source) {
  if (source === 'radio') return 3;
  if (source === 'search') return 2;
  if (source === 'discovery') return 1;
  return 1;
}

function scoreCandidate(candidate, context) {
  const track = candidate.normalized;
  const reasons = [];
  let score = 50;

  if (!track.title || track.title === 'Unknown') {
    return { score: -Infinity, rejected: true, reason: 'missing title' };
  }

  if (context.last && track.key === context.last.key) {
    return { score: -Infinity, rejected: true, reason: 'same as last track' };
  }

  const profileSeeds = context.manualSeeds.length
    ? context.manualSeeds
    : [context.seed, context.primary].filter(Boolean);
  if (profileSeeds.some((seed) => seed.key === track.key)) {
    return { score: -Infinity, rejected: true, reason: 'same as manual seed track' };
  }

  if (isTrackRecent(context.guildId, candidate.track)) {
    return { score: -Infinity, rejected: true, reason: 'recent duplicate' };
  }

  if (hasHardRejectTerm(track)) {
    return { score: -Infinity, rejected: true, reason: 'blocked title pattern' };
  }

  if (track.duration > 0 && track.duration < 55_000) {
    return { score: -Infinity, rejected: true, reason: 'too short' };
  }

  if (track.duration > 13 * 60_000) {
    return { score: -Infinity, rejected: true, reason: 'too long' };
  }

  if (candidate.source === 'radio') {
    score += 22;
    reasons.push('radio');
  } else if (candidate.source === 'search') {
    score += 6;
  } else if (candidate.source === 'discovery') {
    score += 8;
    reasons.push(`ai-discovery:${candidate.discoveryDistance || 'unknown'}`);
  }

  const anchorMatches = candidate.anchorKeys?.size ?? 0;
  if (anchorMatches > 1) {
    const consensusBoost = Math.min(18, (anchorMatches - 1) * 9);
    score += consensusBoost;
    reasons.push(`profile-consensus:${anchorMatches}`);
  }
  if (Number.isFinite(candidate.anchorRank)) {
    const anchorBoost = Math.max(0, 6 - (candidate.anchorRank * 2));
    score += anchorBoost;
    if (anchorBoost) reasons.push(`anchor:${candidate.anchorRank + 1}`);
  }

  const positive = getPositiveTermScore(track);
  if (positive) {
    score += positive;
    reasons.push(`positive:${positive}`);
  }

  const penalty = getSoftPenalty(track);
  if (penalty) {
    score -= penalty;
    reasons.push(`soft-penalty:${penalty}`);
  }

  if (track.artist) {
    const matchesManualArtist = context.manualSeeds.some((seed) => seed.artist === track.artist);
    if (matchesManualArtist) {
      score += 12;
      reasons.push('manual-artist');
    } else if (context.manualSeeds.length > 0) {
      score += 5;
      reasons.push('profile-discovery');
    } else if (context.seedArtist) {
      score += track.artist === context.seedArtist ? 8 : 10;
      reasons.push(track.artist === context.seedArtist ? 'same-artist' : 'artist-variety');
    }
  }

  const matchesManualArtist = context.manualSeeds.some((seed) => seed.artist === track.artist);
  const recentArtistTail = context.recent
    .slice(-2)
    .filter((entry) => entry.artist);
  if (
    track.artist &&
    recentArtistTail.length === 2 &&
    recentArtistTail.every((entry) => entry.artist === track.artist)
  ) {
    return { score: -Infinity, rejected: true, reason: 'artist streak limit' };
  }
  const recentSameArtist = context.recent
    .slice(-8)
    .filter((entry) => entry.artist && entry.artist === track.artist)
    .length;
  if (recentSameArtist > 0) {
    const perTrackPenalty = matchesManualArtist ? 7 : 8;
    score -= Math.min(matchesManualArtist ? 21 : 24, recentSameArtist * perTrackPenalty);
    reasons.push(`recent-artist:${recentSameArtist}`);
  }

  if (isArtistOverplayed(context.guildId, track.artist)) {
    score -= 45;
    reasons.push('loop-guard');
  }

  const seedDurations = context.activeSeeds
    .map((seed) => seed.duration)
    .filter((duration) => duration > 0);
  if (seedDurations.length > 0 && track.duration > 0) {
    const ratio = seedDurations
      .map((duration) => track.duration / duration)
      .sort((left, right) => Math.abs(Math.log(left)) - Math.abs(Math.log(right)))[0];
    if (ratio >= 0.65 && ratio <= 1.55) {
      score += 10;
      reasons.push('duration-match');
    } else if (ratio >= 0.45 && ratio <= 2.2) {
      score += 2;
    } else {
      score -= 12;
      reasons.push('duration-drift');
    }
  }

  const titleComparisons = profileSeeds.map((seed) => ({
    seed,
    overlap: tokenOverlap(track.cleanTitle || track.title, seed.cleanTitle || seed.title),
  }));
  const sameSongVariant = titleComparisons.some(({ seed, overlap }) => (
    overlap >= 0.82 && track.artist && seed.artist === track.artist
  ));
  if (sameSongVariant) {
    return { score: -Infinity, rejected: true, reason: 'same song variant' };
  }
  const overlap = titleComparisons.reduce((maximum, entry) => Math.max(maximum, entry.overlap), 0);
  if (overlap >= 0.55) {
    score -= 14;
    reasons.push('title-overlap');
  }

  for (const skipped of context.skipped) {
    if (skipped.key === track.key) {
      return { score: -Infinity, rejected: true, reason: 'recently skipped' };
    }
  }

  const skippedArtistMatches = context.skipped.filter((skipped) => (
    skipped.artistKey && track.artistKey && skipped.artistKey === track.artistKey
  ));
  const strongSkippedSameArtist = skippedArtistMatches.filter((skipped) => skipped.strength !== 'normal').length;
  if (strongSkippedSameArtist >= SKIPPED_ARTIST_REJECT_THRESHOLD) {
    return { score: -Infinity, rejected: true, reason: 'recently skipped artist' };
  }
  if (skippedArtistMatches.length > 0) {
    const normalSkippedSameArtist = skippedArtistMatches.length - strongSkippedSameArtist;
    score -= (strongSkippedSameArtist * 28) + (normalSkippedSameArtist * 14);
    reasons.push(`skipped-artist:${skippedArtistMatches.length}`);
  }

  const skippedAuthorMatches = context.skipped.filter((skipped) => (
    skipped.authorKey && track.authorKey && skipped.authorKey === track.authorKey
  ));
  const strongSkippedSameAuthor = skippedAuthorMatches.filter((skipped) => skipped.strength !== 'normal').length;
  if (strongSkippedSameAuthor >= SKIPPED_AUTHOR_REJECT_THRESHOLD) {
    return { score: -Infinity, rejected: true, reason: 'recently skipped channel' };
  }
  if (skippedAuthorMatches.length > 0) {
    const normalSkippedSameAuthor = skippedAuthorMatches.length - strongSkippedSameAuthor;
    score -= (strongSkippedSameAuthor * 32) + (normalSkippedSameAuthor * 16);
    reasons.push(`skipped-channel:${skippedAuthorMatches.length}`);
  }

  score -= Math.min(10, candidate.sourceIndex);

  return {
    score,
    rejected: score < MIN_SCORE,
    reason: score < MIN_SCORE ? 'low score' : reasons.join(', ') || 'ok',
  };
}

function pickCandidateLocally(scoredCandidates) {
  const eligible = scoredCandidates
    .filter((candidate) => !candidate.rejected)
    .sort((a, b) => b.score - a.score);

  if (!eligible.length) return null;

  const bestScore = eligible[0].score;
  const pool = eligible
    .filter((candidate) => candidate.score >= Math.max(MIN_SCORE, bestScore - PICK_SCORE_WINDOW))
    .map((candidate) => ({
      ...candidate,
      selectionScore: candidate.score + (Math.random() * SELECTION_JITTER),
    }))
    .sort((a, b) => b.selectionScore - a.selectionScore)
    .slice(0, TOP_PICK_POOL);

  const totalWeight = pool.reduce((sum, candidate) => sum + Math.max(1, candidate.selectionScore - MIN_SCORE + 1), 0);
  let roll = Math.random() * totalWeight;

  for (const candidate of pool) {
    roll -= Math.max(1, candidate.selectionScore - MIN_SCORE + 1);
    if (roll <= 0) return candidate;
  }

  return pool[0];
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

async function findNextTrack(player, lastTrack, client) {
  if (!player || !lastTrack?.info) return null;

  const guildId = player.guildId;
  const node = player.node;

  if (lastTrack.isAutoplay) {
    if (wasRecentlySkipped(guildId, lastTrack)) {
      logAutoplay('info', `Skipped autoplay track will not become the next seed: "${lastTrack.info.title}"`);
    } else {
      const acceptedSeed = snapshotTrackInfo(lastTrack);
      if (acceptedSeed) {
        currentAutoplaySeed.set(guildId, acceptedSeed);
        logAutoplay('debug', `Accepted autoplay track remembered as fallback: "${acceptedSeed.title}"`);
      }
    }
  } else if (isLocalUploadTrack(lastTrack)) {
    logAutoplay('debug', `Local upload finished; keeping the manual seed profile instead of using "${lastTrack.info.title}"`);
  } else {
    if (!getManualSeedPool(guildId).length) {
      addManualSeed(guildId, lastTrack, { invalidatePrefetch: false });
      logAutoplay('debug', `Recovered missing manual seed from the current track: "${lastTrack.info.title}"`);
    }
  }

  const selectedManualSeeds = selectManualSeeds(guildId);
  const activeSeed = selectedManualSeeds[0] || currentAutoplaySeed.get(guildId) || (
    isLocalUploadTrack(lastTrack) ? null : snapshotTrackInfo(lastTrack)
  );
  if (!activeSeed) {
    logAutoplay('debug', 'No manual seed profile available after local upload; not queueing autoplay');
    return null;
  }
  const seedTrack = activeSeed ? { info: activeSeed } : lastTrack;
  if (selectedManualSeeds.length) {
    logAutoplay('debug', `Active manual seeds: ${selectedManualSeeds.map((entry) => `"${entry.title}"`).join(', ')}`);
  }
  if (activeSeed && activeSeed.title !== lastTrack.info.title) {
    logAutoplay('debug', `Using active seed: "${activeSeed.title}" instead of "${lastTrack.info.title}"`);
  }

  addToRecentTracks(guildId, lastTrack);

  if (!node?.connected) {
    logAutoplay('warn', 'Node not connected');
    return null;
  }

  const context = buildContext(guildId, seedTrack, lastTrack, selectedManualSeeds);
  if (!context.seedArtist && !context.seedTitle) {
    logAutoplay('debug', 'Could not build seed context');
    return null;
  }

  const candidates = new Map();
  const discoveryArtistsPromise = getDiscoveryArtists(context, { logger: logAutoplay });
  let videoId = context.seed?.identifier || context.last?.identifier;

  if (!isYouTubeIdentifier(videoId)) {
    logAutoplay('debug', 'Non-YouTube seed detected, resolving YouTube ID...');
    videoId = await resolveYouTubeId(node, seedTrack, client);
  }

  if (videoId) {
    const radioTracks = await getYouTubeRadioMix(node, videoId, client);
    radioTracks.forEach((track, index) => addCandidate(candidates, track, 'radio', index, context.primary?.key, 0));
  }

  const queries = buildSearchQueries(context);
  logAutoplay('debug', `Search queries: ${queries.map((entry) => entry.query).join(' | ') || 'none'}`);

  for (let offset = 0; offset < queries.length; offset += 3) {
    const batch = queries.slice(offset, offset + 3);
    const results = await Promise.all(batch.map((entry) => searchTracks(node, entry.query, client)));
    results.forEach((tracks, batchIndex) => {
      const query = batch[batchIndex];
      tracks.forEach((track, index) => addCandidate(
        candidates,
        track,
        'search',
        index,
        query.anchorKey,
        query.anchorRank,
      ));
    });
  }

  // Preserve the pre-AI pool so a Gemini failure uses the original autoplay unchanged.
  const fallbackCandidates = [...candidates.values()];
  const discoveryArtists = await discoveryArtistsPromise;
  const discoveryQueries = buildDiscoveryQueries(discoveryArtists, context);
  logAutoplay(
    'debug',
    `Discovery queries: ${discoveryQueries.map((entry) => `${entry.artist}:${entry.distance}`).join(' | ') || 'none'}`,
  );

  for (let offset = 0; offset < discoveryQueries.length; offset += 4) {
    const batch = discoveryQueries.slice(offset, offset + 4);
    const results = await Promise.all(batch.map((entry) => searchTracks(
      node,
      entry.query,
      client,
      MAX_DISCOVERY_TRACKS_PER_ARTIST,
    )));
    results.forEach((tracks, batchIndex) => {
      const query = batch[batchIndex];
      tracks.forEach((track, index) => addCandidate(
        candidates,
        track,
        'discovery',
        index,
        null,
        0,
        query.distance,
      ));
    });
  }

  if (!candidates.size) {
    logAutoplay('debug', 'No candidates found');
    return null;
  }

  const scoredCandidates = [...candidates.values()].map((candidate) => ({
    ...candidate,
    ...scoreCandidate(candidate, context),
  }));
  const scoredFallbackCandidates = fallbackCandidates.map((candidate) => ({
    ...candidate,
    ...scoreCandidate(candidate, context),
  }));

  const selected = await selectCandidate(
    scoredCandidates,
    context,
    pickCandidateWithGemini,
    scoredFallbackCandidates,
  );
  logCandidateSummary(scoredCandidates, selected);

  if (!selected) {
    logAutoplay('debug', 'No candidate reached minimum score');
  }

  return selected?.track ?? null;
}

function scheduleAutoplayPrefetch(player, track, client) {
  const guildId = player?.guildId;
  const trackKey = getTrackCacheKey(track);
  if (!guildId || !trackKey || !track?.info) return;

  clearAutoplayPrefetch(guildId);

  if (!isAutoplayEnabled(guildId)) return;
  if (player.queue.tracks.length > 0) return;

  const duration = Number(track.info.duration ?? track.info.length);
  if (!Number.isFinite(duration) || duration <= 0) return;

  const delay = Math.max(duration - PREFETCH_LEAD_MS, MIN_PREFETCH_DELAY_MS);

  const timeout = setTimeout(() => {
    const currentKey = getTrackCacheKey(player.queue.current);
    if (!isAutoplayEnabled(guildId) || player.queue.tracks.length > 0 || currentKey !== trackKey) {
      clearAutoplayPrefetch(guildId);
      return;
    }

    const promise = findNextTrack(player, track, client)
      .then((nextTrack) => {
        const current = autoplayPrefetch.get(guildId);
        if (current && current.trackKey === trackKey) {
          current.track = nextTrack || null;
        }
        return nextTrack || null;
      })
      .catch((error) => {
        logAutoplay('warn', `Prefetch failed: ${error.message}`);
        return null;
      });

    autoplayPrefetch.set(guildId, { trackKey, promise, timeout: null, track: null });
  }, delay);

  autoplayPrefetch.set(guildId, { trackKey, promise: null, timeout, track: null });
}

async function consumePrefetchedTrack(guildId, lastTrack) {
  const cached = autoplayPrefetch.get(guildId);
  if (!cached || cached.trackKey !== getTrackCacheKey(lastTrack)) return null;

  autoplayPrefetch.delete(guildId);
  if (cached.timeout) {
    clearTimeout(cached.timeout);
    return null;
  }
  if (cached.track) return cached.track;
  if (cached.promise) return cached.promise;
  return null;
}

async function handleAutoplay(player, lastTrack, client) {
  const guildId = player.guildId;
  const epoch = autoplayEpoch.get(guildId) || 0;

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

  try {
    const nextTrack = await consumePrefetchedTrack(guildId, lastTrack) || await findNextTrack(player, lastTrack, client);
    if (!nextTrack) return false;
    if ((autoplayEpoch.get(guildId) || 0) !== epoch) return false;
    if (client?.lavalink?.players?.get(guildId) !== player) return false;
    if (!isAutoplayEnabled(guildId) || player.queue.tracks.length > 0) return false;
    if (player.queue.current && player.playing) return false;

    nextTrack.isAutoplay = true;
    await player.queue.add(nextTrack);

    if (!player.playing && !player.paused) {
      await player.play();
    }

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
  autoplayEpoch.set(guildId, (autoplayEpoch.get(guildId) || 0) + 1);
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
  autoplayEpoch.set(guildId, (autoplayEpoch.get(guildId) || 0) + 1);
  autoplayBlockedUntil.set(guildId, Date.now() + 15_000);
  clearAutoplayPrefetch(guildId);
  recentTracks.delete(guildId);
  skippedAutoplayTracks.delete(guildId);
  manualSeedPools.delete(guildId);
  manualSeedCursors.delete(guildId);
  currentAutoplaySeed.delete(guildId);
  autoplayPlaybackFailureBlocks.delete(guildId);
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
  isAutoplayEnabled,
  setAutoplay,
  toggleAutoplay,
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
    isPlaybackFailureBlocked: (guildId) => autoplayPlaybackFailureBlocks.has(guildId),
  },
};
