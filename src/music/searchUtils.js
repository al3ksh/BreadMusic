const YOUTUBE_PREFIX = 'ytsearch';
const SPOTIFY_PREFIX = 'spsearch';
const SOUNDCLOUD_PREFIX = 'scsearch';

const VALID_PREFIXES = [YOUTUBE_PREFIX, SPOTIFY_PREFIX, SOUNDCLOUD_PREFIX];

function applyPreferredSource(query, guildConfig = {}, defaultSource = YOUTUBE_PREFIX) {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z]+search:/i.test(trimmed)) return trimmed;

  const prefix = resolveSearchPrefix(guildConfig.preferredSource ?? defaultSource ?? YOUTUBE_PREFIX);
  return `${prefix}:${trimmed}`;
}

function resolveSearchPrefix(candidate) {
  if (typeof candidate !== 'string') return YOUTUBE_PREFIX;
  const normalized = candidate.toLowerCase();
  if (VALID_PREFIXES.includes(normalized)) return normalized;
  if (normalized === 'spotify') return SPOTIFY_PREFIX;
  if (normalized === 'soundcloud') return SOUNDCLOUD_PREFIX;
  if (normalized === 'youtube') return YOUTUBE_PREFIX;
  return YOUTUBE_PREFIX;
}

function isSpotifyUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'open.spotify.com' || hostname === 'spotify.com';
  } catch {
    return false;
  }
}

function isSupportedUrl(url) {
  try {
    const { hostname } = new URL(url);
    const normalized = hostname.toLowerCase();
    return (
      isYouTubeHost(normalized) ||
      normalized === 'open.spotify.com' ||
      normalized === 'spotify.com' ||
      normalized === 'soundcloud.com' ||
      normalized.endsWith('.soundcloud.com') ||
      normalized === 'bandcamp.com' ||
      normalized.endsWith('.bandcamp.com')
    );
  } catch {
    return false;
  }
}

function isYouTubeHost(hostname = '') {
  const normalized = hostname.toLowerCase();
  return normalized === 'youtu.be' || normalized === 'youtube.com' || normalized.endsWith('.youtube.com');
}

module.exports = {
  applyPreferredSource,
  isSpotifyUrl,
  isSupportedUrl,
  isYouTubeHost,
  YOUTUBE_PREFIX,
  SPOTIFY_PREFIX,
  SOUNDCLOUD_PREFIX,
};
