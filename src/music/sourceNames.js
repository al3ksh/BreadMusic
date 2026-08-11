function normalizeSourceName(info = {}) {
  const explicit = typeof info.sourceName === 'string' ? info.sourceName.trim() : '';
  if (explicit) return explicit;

  const uri = typeof info.uri === 'string' ? info.uri.toLowerCase() : '';
  if (uri.includes('youtube.com') || uri.includes('youtu.be')) return 'youtube';
  if (uri.includes('spotify.com')) return 'spotify';
  if (uri.includes('soundcloud.com')) return 'soundcloud';
  if (uri.includes('bandcamp.com')) return 'bandcamp';
  if (uri.includes('/api/uploads/')) return 'localUpload';
  return null;
}

module.exports = { normalizeSourceName };
