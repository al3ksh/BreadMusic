const { cleanTrackTitle: cleanTitle } = require('../../utils/trackTitles');

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

// Streams (radio stations, live videos) have no fixed length and make poor autoplay seeds.
function isStreamTrack(trackOrInfo) {
  const info = trackOrInfo?.info ?? trackOrInfo;
  if (!info) return false;
  if (info.isStream) return true;
  const duration = Number(info.duration ?? info.length);
  return !Number.isFinite(duration) || duration <= 0;
}

function isYouTubeIdentifier(identifier) {
  return typeof identifier === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(identifier);
}

module.exports = {
  cleanTitle,
  logAutoplay,
  normalizeTrack,
  makeTrackKey,
  normalizeComparable,
  hasTerm,
  tokenOverlap,
  getTrackCacheKey,
  snapshotTrackInfo,
  isLocalUploadTrack,
  isStreamTrack,
  isYouTubeIdentifier,
};
