const YOUTUBE_PREFIX = 'ytsearch';

function applyPreferredSource(query, guildConfig = {}, defaultSource = YOUTUBE_PREFIX) {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed) || /^[a-z]+search:/i.test(trimmed)) {
    return trimmed;
  }

  const prefix = resolveYouTubePrefix(guildConfig.preferredSource ?? defaultSource ?? YOUTUBE_PREFIX);
  return `${prefix}:${trimmed}`;
}

function resolveYouTubePrefix(candidate) {
  if (typeof candidate !== 'string') return YOUTUBE_PREFIX;
  const normalized = candidate.toLowerCase();
  if (normalized === YOUTUBE_PREFIX) return YOUTUBE_PREFIX;
  // Other providers are not supported right now, always fall back to YouTube search.
  return YOUTUBE_PREFIX;
}

function getYouTubeOnlyQueryError(rawQuery = '') {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return 'Please provide a song name or a YouTube link.';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const { hostname } = new URL(trimmed);
      if (isYouTubeHost(hostname)) return null;
      return 'Supported inputs: YouTube video links, YouTube playlists, or plain text YouTube searches.';
    } catch {
      return 'Please provide a valid YouTube link or just type what to search on YouTube.';
    }
  }

  const explicitSearch = /^([a-z0-9]+search):/i.exec(trimmed);
  if (explicitSearch && explicitSearch[1].toLowerCase() !== YOUTUBE_PREFIX) {
    return 'Only YouTube search is supported right now. Use plain text or YouTube links.';
  }

  return null;
}

function isYouTubeHost(hostname = '') {
  const normalized = hostname.toLowerCase();
  return normalized === 'youtu.be' || normalized === 'youtube.com' || normalized.endsWith('.youtube.com');
}

module.exports = {
  applyPreferredSource,
  getYouTubeOnlyQueryError,
};
