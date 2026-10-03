const { logAutoplay, normalizeComparable } = require('./normalize');

const API_URL = 'https://ws.audioscrobbler.com/2.0/';
const REQUEST_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const BREAKER_MS = 5 * 60 * 1000;
const FETCH_LIMIT = 40;

class LastfmUnavailableError extends Error {}

// Last.fm only feeds metadata (artist + title); every suggestion is resolved to a playable
// track through the normal search. Without an API key the client is a no-op.
function createLastfmClient({
  apiKey = process.env.LASTFM_API_KEY,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const cache = new Map();
  let breakerUntil = 0;

  const isEnabled = () => Boolean(apiKey && fetchImpl);

  function getStatus() {
    if (!isEnabled()) return { enabled: false, available: false, retryAt: null };
    const open = now() < breakerUntil;
    return { enabled: true, available: !open, retryAt: open ? breakerUntil : null };
  }

  function cached(key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (now() - entry.at > CACHE_TTL_MS) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function remember(key, value) {
    cache.set(key, { at: now(), value });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  }

  async function request(params) {
    if (now() < breakerUntil) throw new LastfmUnavailableError('circuit open');

    const url = new URL(API_URL);
    for (const [name, value] of Object.entries({ ...params, api_key: apiKey, format: 'json', autocorrect: 1 })) {
      url.searchParams.set(name, String(value));
    }

    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new LastfmUnavailableError(`request failed: ${error.message}`);
    }

    if (response.status === 429 || response.status >= 500) {
      breakerUntil = now() + BREAKER_MS;
      logAutoplay('warn', `Last.fm returned HTTP ${response.status}; pausing it for 5 minutes`);
      throw new LastfmUnavailableError(`HTTP ${response.status}`);
    }

    const body = await response.json().catch(() => null);
    // Error 29 is Last.fm's rate limit, error 11/16 a temporary outage.
    if ([11, 16, 29].includes(body?.error)) {
      breakerUntil = now() + BREAKER_MS;
      logAutoplay('warn', `Last.fm error ${body.error}; pausing it for 5 minutes`);
      throw new LastfmUnavailableError(`error ${body.error}`);
    }
    // Anything else (unknown track, bad key) is a definite "no results" and is cached as such.
    if (!response.ok || body?.error) {
      logAutoplay('debug', `Last.fm ${params.method}: ${body?.message || `HTTP ${response.status}`}`);
      return null;
    }
    return body;
  }

  async function cachedRequest(cacheKey, params, parse) {
    if (!isEnabled()) return [];
    const hit = cached(cacheKey);
    if (hit) return hit;

    try {
      const value = parse(await request(params));
      remember(cacheKey, value);
      return value;
    } catch (error) {
      if (!(error instanceof LastfmUnavailableError)) throw error;
      logAutoplay('debug', `Last.fm ${params.method} skipped: ${error.message}`);
      return [];
    }
  }

  function getSimilarTracks({ artist, title }) {
    if (!artist || !title) return Promise.resolve([]);
    const key = `track|${normalizeComparable(artist)}|${normalizeComparable(title)}`;
    return cachedRequest(key, { method: 'track.getSimilar', artist, track: title, limit: FETCH_LIMIT }, parseSimilarTracks);
  }

  function getSimilarArtists(artist) {
    if (!artist) return Promise.resolve([]);
    const key = `artist|${normalizeComparable(artist)}`;
    return cachedRequest(key, { method: 'artist.getSimilar', artist, limit: FETCH_LIMIT }, parseSimilarArtists);
  }

  return { isEnabled, getStatus, getSimilarTracks, getSimilarArtists };
}

function toMatch(value) {
  const match = Number.parseFloat(value);
  return Number.isFinite(match) ? Math.max(0, Math.min(1, match)) : 0;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function parseSimilarTracks(body) {
  return asArray(body?.similartracks?.track)
    .map((entry) => ({
      title: String(entry?.name || '').trim(),
      artist: String(entry?.artist?.name || '').trim(),
      match: toMatch(entry?.match),
    }))
    .filter((entry) => entry.title && entry.artist)
    .sort((left, right) => right.match - left.match);
}

function parseSimilarArtists(body) {
  return asArray(body?.similarartists?.artist)
    .map((entry) => ({ name: String(entry?.name || '').trim(), match: toMatch(entry?.match) }))
    .filter((entry) => entry.name)
    .sort((left, right) => right.match - left.match);
}

let defaultClient = null;

function getLastfmClient() {
  if (!defaultClient) defaultClient = createLastfmClient();
  return defaultClient;
}

module.exports = {
  CACHE_TTL_MS,
  BREAKER_MS,
  createLastfmClient,
  getLastfmClient,
  parseSimilarTracks,
  parseSimilarArtists,
};
