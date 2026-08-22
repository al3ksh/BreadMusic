const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_ATTEMPTS = 3;
const MAX_QUERY_VARIANTS = 5;
const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const cache = new Map();
const inFlight = new Map();

class LyricsProviderError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'LyricsProviderError';
  }
}

const BRACKET_NOISE_PATTERN = /[\[(][^\])]*(official|video|audio|lyric|visualizer|m\/v|\bmv\b|\bhd\b|\bhq\b|4k|color\s*coded|performance|stage\s*(mix|video)|comeback)[^\])]*[\])]/gi;
const DASHED_VIDEO_PATTERN = /\s*[-–—|]\s*(official\s+)?(music\s+)?(video|audio|lyric(s)?(\s+video)?|visualizer|performance\s+video)\s*$/i;
const PROD_BRACKET_PATTERN = /\s*[\[(]\s*prod(?:uced)?\.?(?:\s*by\b[^\])]*)?[\])]/gi;
const PROD_DASH_PATTERN = /\s+[-–—]\s+prod(?:uced)?\.?(?:\s*by\b\s+.+)?$/i;
const FEAT_PATTERN = /\s*[\[(]?\s*\b(?:ft|feat|featuring)\b\.?\s+[^\])]+[\])]?/gi;
const CHANNEL_SUFFIXES = [
  /\s+-\s+topic$/i,
  /\s*vevo$/i,
  /\s+official(\s+artist(\s+channel)?)?$/i,
  /\s+offizielles?\s+kanal$/i,
];

function cleanTrackTitle(value) {
  return String(value || '')
    .replace(PROD_DASH_PATTERN, ' ')
    .replace(BRACKET_NOISE_PATTERN, ' ')
    .replace(PROD_BRACKET_PATTERN, ' ')
    .replace(DASHED_VIDEO_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripFeaturedArtists(value) {
  return String(value || '')
    .replace(FEAT_PATTERN, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanArtist(value) {
  let artist = String(value || '');
  for (const pattern of CHANNEL_SUFFIXES) artist = artist.replace(pattern, '');
  return stripFeaturedArtists(artist.replace(/\s{2,}/g, ' ').trim());
}

function primaryArtistName(value) {
  const cleaned = cleanArtist(value);
  if (!cleaned) return '';
  const primary = cleaned.split(/\s*,\s*|\s*&\s*/)[0].trim();
  return primary || cleaned;
}

function stripBracketedContent(value) {
  return String(value || '')
    .replace(/[\[(][^\])]*[\])]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitArtistFromTitle(title) {
  const match = String(title || '').match(/^(.{2,40}?)\s+[-–—]\s+(.+)$/);
  if (!match) return null;
  const candidate = cleanArtist(match[1]);
  const remainder = cleanTrackTitle(match[2]);
  if (!candidate || !remainder) return null;
  return { artist: candidate, title: remainder };
}

function buildQueryVariants(normalized) {
  const variants = [];
  const push = (artist, title) => {
    const cleanArtistValue = String(artist || '').trim();
    const cleanTitleValue = cleanTrackTitle(title);
    if (!cleanArtistValue || !cleanTitleValue) return;
    const key = `${cleanArtistValue.toLowerCase()}|${cleanTitleValue.toLowerCase()}`;
    if (variants.some((variant) => variant.key === key)) return;
    variants.push({ key, artist: cleanArtistValue, title: cleanTitleValue });
  };

  push(normalized.artist, normalized.title);

  if (normalized.isrc && Array.isArray(normalized.isrcMetadata)) {
    for (const metadata of normalized.isrcMetadata) push(metadata.artist, metadata.title);
  }

  const embedded = splitArtistFromTitle(normalized.title);
  if (embedded) push(embedded.artist, embedded.title);

  const withoutBrackets = stripBracketedContent(normalized.title);
  if (withoutBrackets !== normalized.title) push(normalized.artist, withoutBrackets);

  push(primaryArtistName(normalized.artist), stripFeaturedArtists(cleanTrackTitle(normalized.title)));
  if (embedded) push(primaryArtistName(embedded.artist), stripFeaturedArtists(embedded.title));

  return variants.slice(0, MAX_QUERY_VARIANTS).map(({ artist, title }) => ({ artist, title }));
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
          'User-Agent': options.userAgent || 'Bread Discord Music Bot',
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

function isIsrc(value) {
  return ISRC_PATTERN.test(String(value || '').toUpperCase());
}

async function resolveIsrcMetadata(isrc) {
  if (!isIsrc(isrc)) return null;
  const params = new URLSearchParams({ fmt: 'json', inc: 'artist-credits' });
  const data = await fetchJson(`${MUSICBRAINZ_BASE_URL}/isrc/${encodeURIComponent(isrc.toUpperCase())}?${params}`, {
    attempts: 1,
    userAgent: 'Bread Discord Music Bot (github.com/al3ksh/BreadMusic)',
  });
  const recordings = Array.isArray(data?.recordings) ? data.recordings : [];
  for (const recording of recordings) {
    const credit = recording?.['artist-credit']?.find((entry) => entry?.artist?.name);
    if (!recording?.title || !credit) continue;
    return { artist: credit.artist.name, title: cleanTrackTitle(recording.title) };
  }
  return null;
}

async function lookupLyrics(normalized, variant, index) {
  const durationSeconds = index === 0 && normalized.duration > 0
    ? Math.round(normalized.duration / 1000)
    : 0;
  const exactParams = new URLSearchParams({
    artist_name: variant.artist,
    track_name: variant.title,
  });
  if (variant.album) exactParams.set('album_name', variant.album);
  if (durationSeconds > 0) exactParams.set('duration', String(durationSeconds));

  let data = await fetchJson(`${LRCLIB_BASE_URL}/get?${exactParams}`);
  let result = normalizeLyricsResult(data, normalized);

  if (!result) {
    const searchParams = new URLSearchParams({
      artist_name: variant.artist,
      track_name: variant.title,
    });
    data = await fetchJson(`${LRCLIB_BASE_URL}/search?${searchParams}`);
    if (Array.isArray(data)) {
      result = data.map((entry) => normalizeLyricsResult(entry, normalized)).find(Boolean) || null;
    }
  }

  return result;
}

async function findLyrics({ artist, title, duration = 0, album = '', isrc = '' }) {
  const normalized = {
    artist: cleanArtist(artist),
    title: cleanTrackTitle(title),
    duration: Number.isFinite(duration) ? duration : 0,
    album: String(album || '').trim(),
    isrc: String(isrc || '').toUpperCase(),
    isrcMetadata: [],
  };
  if (!normalized.artist || !normalized.title) return null;

  if (isIsrc(normalized.isrc)) {
    try {
      const metadata = await resolveIsrcMetadata(normalized.isrc);
      if (metadata) normalized.isrcMetadata = [metadata];
    } catch {
      normalized.isrcMetadata = [];
    }
  }

  const durationSeconds = Math.round(normalized.duration / 1000);
  const key = makeCacheKey(normalized.artist, normalized.title, durationSeconds);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = (async () => {
    const variants = buildQueryVariants(normalized);
    let providerError = null;
    for (let index = 0; index < variants.length; index += 1) {
      try {
        const result = await lookupLyrics(normalized, variants[index], index);
        if (result) {
          pruneCache();
          cache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
          return result;
        }
      } catch (error) {
        if (error instanceof LyricsProviderError) providerError = error;
      }
    }
    if (providerError) throw providerError;
    pruneCache();
    cache.set(key, { value: null, expiresAt: Date.now() + NOT_FOUND_CACHE_TTL_MS });
    return null;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, request);
  return request;
}

function trackToLyricsQuery(track) {
  const info = track?.info || track || {};
  const identifierCandidates = [
    info.identifier,
    info.pluginInfo?.originalIdentifier,
    info.pluginInfo?.isrc,
    info.externalId?.isrc,
  ];
  const isrc = identifierCandidates.find((value) => isIsrc(value)) || '';
  return {
    artist: info.author || '',
    title: info.title || '',
    duration: Number.isFinite(info.duration) ? info.duration : 0,
    album: info.albumName || info.pluginInfo?.albumName || '',
    isrc,
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
  stripFeaturedArtists,
  stripBracketedContent,
  cleanArtist,
  primaryArtistName,
  buildQueryVariants,
  isIsrc,
  findLyrics,
  trackToLyricsQuery,
  parseSyncedLyrics,
  findActiveLyricIndex,
  LyricsProviderError,
  fetchJson,
};
