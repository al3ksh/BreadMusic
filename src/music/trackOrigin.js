// How a track got into the queue: the link someone pasted, a text search,
// an upload, their library, history or autoplay. This is the input, not the
// platform the audio streams from (a Spotify link usually plays from YouTube).
const ORIGINS = {
  spotify: { label: 'Spotify link', color: '#1ed760' },
  youtube: { label: 'YouTube link', color: '#ff4e45' },
  soundcloud: { label: 'SoundCloud link', color: '#ff7a1a' },
  applemusic: { label: 'Apple Music link', color: '#fa5c82' },
  deezer: { label: 'Deezer link', color: '#a238ff' },
  bandcamp: { label: 'Bandcamp link', color: '#3fb4c8' },
  link: { label: 'Other link', color: '#9aa0b4' },
  search: { label: 'Text search', color: '#8f82eb' },
  upload: { label: 'Local upload', color: '#e9bb63' },
  library: { label: 'Liked & playlists', color: '#f06fb0' },
  history: { label: 'From history', color: '#5fa8ff' },
  autoplay: { label: 'Autoplay', color: '#61d59b' },
};

const LINK_HOSTS = [
  ['spotify', /(^|\.)spotify\.com$|^spotify\.link$/],
  ['youtube', /(^|\.)youtube\.com$|^youtu\.be$|(^|\.)youtube-nocookie\.com$/],
  ['soundcloud', /(^|\.)soundcloud\.com$|^on\.soundcloud\.com$/],
  ['applemusic', /^music\.apple\.com$/],
  ['deezer', /(^|\.)deezer\.com$|^deezer\.page\.link$|^link\.deezer\.com$/],
  ['bandcamp', /(^|\.)bandcamp\.com$/],
];

function isOrigin(value) {
  return typeof value === 'string' && Object.hasOwn(ORIGINS, value);
}

// Classifies what a user typed into /play or a dashboard search box.
function classifyQuery(query) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (/^spotify:(track|album|playlist|artist):/i.test(text)) return 'spotify';
  if (!/^https?:\/\//i.test(text)) return 'search';
  let host;
  try {
    host = new URL(text).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'search';
  }
  const match = LINK_HOSTS.find(([, pattern]) => pattern.test(host));
  return match ? match[0] : 'link';
}

// Tags tracks that have no origin yet; returns them for chaining.
function tagOrigin(tracks, origin) {
  if (!isOrigin(origin)) return tracks;
  for (const track of Array.isArray(tracks) ? tracks : [tracks]) {
    if (track && typeof track === 'object' && !track.origin) track.origin = origin;
  }
  return tracks;
}

// Origin to store for a play. Older events never recorded one, so only
// autoplay and uploads can be recovered for them.
function originOf({ origin, autoplay, source } = {}) {
  if (isOrigin(origin)) return origin;
  if (autoplay) return 'autoplay';
  if (source === 'localUpload') return 'upload';
  return null;
}

function originLabel(origin) {
  return ORIGINS[origin]?.label ?? 'Not tracked';
}

module.exports = { ORIGINS, isOrigin, classifyQuery, tagOrigin, originOf, originLabel };
