const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_ATTEMPTS = 3;
const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const cache = new Map();
const inFlight = new Map();

class LyricsProviderError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'LyricsProviderError';
  }
}

function cleanTrackTitle(value) {
  return String(value || '')
    .replace(/\s*[\[(](official\s+)?(music\s+)?(video|audio|lyric(s)?|visualizer)[\])]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArtist(value) {
  return String(value || '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeCacheKey(artist, title, duration) {
  return `${cleanArtist(artist).toLowerCase()}|${cleanTrackTitle(title).toLowerCase()}|${Math.round(duration || 0)}`;
}

function pruneCache(now = Date.now()) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function normalizeLyricsResult(data, fallback) {
  if (!data || typeof data !== 'object') return null;
  const plainLyrics = typeof data.plainLyrics === 'string' ? data.plainLyrics.trim() : '';
  const syncedLyrics = typeof data.syncedLyrics === 'string' ? data.syncedLyrics.trim() : '';
  if (!plainLyrics && !syncedLyrics && !data.instrumental) return null;

  return {
    id: data.id ?? null,
    title: data.trackName || fallback.title,
    artist: data.artistName || fallback.artist,
    album: data.albumName || null,
    duration: Number.isFinite(data.duration) ? Math.round(data.duration * 1000) : fallback.duration,
    instrumental: Boolean(data.instrumental),
    plainLyrics,
    syncedLyrics,
    provider: 'LRCLIB',
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchJson(url, options = {}) {
  const attempts = options.attempts || REQUEST_ATTEMPTS;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Bread Discord Music Bot',
        },
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        const error = new Error(`Lyrics provider returned HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfter = response.headers.get('retry-after');
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' ||
        error instanceof TypeError ||
        isRetryableStatus(error?.status);
      if (!retryable || attempt >= attempts) break;

      const retryAfterSeconds = Number(error.retryAfter);
      const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 5000)
        : 350 * (2 ** (attempt - 1));
      await delay(retryDelay);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new LyricsProviderError('Lyrics provider did not respond in time.', lastError);
}

async function lookupLyrics(normalized) {
  const durationSeconds = Math.round(normalized.duration / 1000);
  const exactParams = new URLSearchParams({
    artist_name: normalized.artist,
    track_name: normalized.title,
  });
  if (normalized.album) exactParams.set('album_name', normalized.album);
  if (durationSeconds > 0) exactParams.set('duration', String(durationSeconds));

  let data = await fetchJson(`${LRCLIB_BASE_URL}/get?${exactParams}`);
  let result = normalizeLyricsResult(data, normalized);

  if (!result) {
    const searchParams = new URLSearchParams({
      artist_name: normalized.artist,
      track_name: normalized.title,
    });
    data = await fetchJson(`${LRCLIB_BASE_URL}/search?${searchParams}`);
    if (Array.isArray(data)) {
      result = data.map((entry) => normalizeLyricsResult(entry, normalized)).find(Boolean) || null;
    }
  }

  return result;
}

async function findLyrics({ artist, title, duration = 0, album = '' }) {
  const normalized = {
    artist: cleanArtist(artist),
    title: cleanTrackTitle(title),
    duration: Number.isFinite(duration) ? duration : 0,
    album: String(album || '').trim(),
  };
  if (!normalized.artist || !normalized.title) return null;

  const durationSeconds = Math.round(normalized.duration / 1000);
  const key = makeCacheKey(normalized.artist, normalized.title, durationSeconds);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = lookupLyrics(normalized)
    .then((result) => {
      pruneCache();
      cache.set(key, {
        value: result,
        expiresAt: Date.now() + (result ? CACHE_TTL_MS : NOT_FOUND_CACHE_TTL_MS),
      });
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

function trackToLyricsQuery(track) {
  const info = track?.info || track || {};
  return {
    artist: info.author || '',
    title: info.title || '',
    duration: Number.isFinite(info.duration) ? info.duration : 0,
    album: info.albumName || info.pluginInfo?.albumName || '',
  };
}

function parseSyncedLyrics(value) {
  if (!value) return [];
  return String(value)
    .split('\n')
    .map((line) => {
      const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (!match) return null;
      return {
        time: (Number(match[1]) * 60 + Number(match[2])) * 1000,
        text: match[3].trim() || '...',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function findActiveLyricIndex(lines, position) {
  if (!lines.length) return -1;
  let low = 0;
  let high = lines.length - 1;
  let active = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= position) {
      active = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return active;
}

module.exports = {
  cleanTrackTitle,
  cleanArtist,
  findLyrics,
  trackToLyricsQuery,
  parseSyncedLyrics,
  findActiveLyricIndex,
  LyricsProviderError,
  fetchJson,
};
