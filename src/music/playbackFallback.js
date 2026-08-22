const { cleanTrackTitle, cleanArtist } = require('./lyrics');

const FALLBACK_WINDOW_MS = 10 * 60 * 1000;
const FALLBACK_MAX_ATTEMPTS = 3;
const SEARCH_TIMEOUT_MS = 8000;
const DURATION_TOLERANCE_FACTOR = 0.12;
const MIN_DURATION_TOLERANCE_MS = 6000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceOf(track) {
  const uri = String(track?.info?.uri || '');
  if (/youtu\.be|youtube\.com/i.test(uri)) return 'youtube';
  if (/soundcloud\.com/i.test(uri)) return 'soundcloud';
  if (/spotify|lavasrc/i.test(uri) || /^spsearch/i.test(uri)) return 'spotify';
  if (track?.localUpload || /bread-upload/i.test(uri)) return 'upload';
  return 'other';
}

function searchOrderFor(source) {
  if (source === 'youtube') return ['ytmsearch', 'scsearch'];
  if (source === 'soundcloud') return ['ytsearch'];
  if (source === 'upload') return [];
  return ['ytsearch', 'scsearch'];
}

function buildMirrorQueries(track) {
  const info = track?.info || {};
  const title = cleanTrackTitle(info.title);
  const artist = cleanArtist(info.author);
  const queries = [];
  const push = (value) => {
    const query = String(value || '').trim();
    if (!query) return;
    if (!queries.includes(query)) queries.push(query);
  };
  push(artist && title ? `${artist} ${title}` : '');
  push(title);
  return queries.slice(0, 3);
}

function createPlaybackFallback({
  search,
  maxAttempts = FALLBACK_MAX_ATTEMPTS,
  windowMs = FALLBACK_WINDOW_MS,
  searchTimeoutMs = SEARCH_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof search !== 'function') {
    throw new TypeError('search must be a function');
  }

  const attempts = new Map();

  function recentAttempts(guildId) {
    const currentTime = now();
    const entries = (attempts.get(guildId) || []).filter((timestamp) => currentTime - timestamp < windowMs);
    attempts.set(guildId, entries);
    return entries;
  }

  function shouldAttemptFallback(guildId) {
    return recentAttempts(guildId).length < maxAttempts;
  }

  function recordFallbackAttempt(guildId) {
    const entries = recentAttempts(guildId);
    entries.push(now());
    attempts.set(guildId, entries);
  }

  async function searchOnce(query) {
    try {
      return await Promise.race([
        Promise.resolve(search(query)),
        delay(searchTimeoutMs).then(() => null),
      ]);
    } catch {
      return null;
    }
  }

  function pickBestTrack(tracks, { failedIdentifier, failedUri, duration }) {
    const candidates = (Array.isArray(tracks) ? tracks : []).filter((candidate) => {
      const identifier = candidate?.info?.identifier;
      const uri = candidate?.info?.uri;
      if (failedIdentifier && identifier === failedIdentifier) return false;
      if (failedUri && uri === failedUri) return false;
      if (candidate?.localUpload) return false;
      return Boolean(identifier || uri);
    });
    if (!candidates.length) return null;

    if (duration > 0) {
      const tolerance = Math.max(duration * DURATION_TOLERANCE_FACTOR, MIN_DURATION_TOLERANCE_MS);
      const withinTolerance = candidates
        .map((candidate) => ({ candidate, diff: Math.abs((candidate.info.duration || 0) - duration) }))
        .filter((entry) => entry.diff <= tolerance)
        .sort((a, b) => a.diff - b.diff);
      if (withinTolerance.length) return withinTolerance[0].candidate;
    }
    return candidates[0];
  }

  async function findReplacementTrack({ player, track }) {
    const guildId = player?.guildId;
    if (!guildId || !track?.info?.title) return null;
    if (!shouldAttemptFallback(guildId)) return null;

    recordFallbackAttempt(guildId);

    const failedIdentifier = track.info.identifier;
    const failedUri = track.info.uri;
    const duration = Number.isFinite(track.info.duration) ? track.info.duration : 0;
    const queries = buildMirrorQueries(track);
    const sources = searchOrderFor(sourceOf(track));

    for (const source of sources) {
      for (const query of queries) {
        const result = await searchOnce(`${source}:${query}`);
        const tracks = result?.loadType === 'search' ? result.tracks : result?.tracks;
        const candidate = pickBestTrack(tracks, { failedIdentifier, failedUri, duration });
        if (candidate) return candidate;
      }
    }

    return null;
  }

  return {
    findReplacementTrack,
    shouldAttemptFallback,
    recordFallbackAttempt,
  };
}

module.exports = {
  createPlaybackFallback,
  sourceOf,
  buildMirrorQueries,
  FALLBACK_WINDOW_MS,
  FALLBACK_MAX_ATTEMPTS,
};
