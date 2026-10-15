// @ts-check
const { logAutoplay, normalizeTrack, isLocalUploadTrack, isStreamTrack } = require('./normalize');
const { DISLIKED_ARTIST_REJECT_THRESHOLD } = require('./scoring');
const profileStore = require('./profileStore');
const userTaste = require('./userTaste');
const library = require('../library');

// How skips, likes and dislikes turn into the taste autoplay scores candidates against.
const SKIP_MEMORY_TTL = 2 * 60 * 60 * 1000;
const SKIP_DAY_MS = 24 * 60 * 60 * 1000;
const QUICK_SKIP_MAX_MS = 75_000;
const QUICK_SKIP_MAX_RATIO = 0.35;
const ACCEPTED_PLAY_MIN_MS = 90_000;
const ACCEPTED_PLAY_MIN_RATIO = 0.65;

function tasteEntry(normalized, extra = {}) {
  return {
    key: normalized.key,
    artistKey: normalized.artistKey,
    authorKey: normalized.authorKey,
    title: normalized.title,
    author: normalized.author,
    identifier: normalized.identifier,
    uri: normalized.uri,
    duration: normalized.duration,
    sourceName: normalized.sourceName,
    ...extra,
  };
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

// Skip feedback fades: full weight for two hours, half for the rest of the day, then a quarter.
function skipWeight(age) {
  if (age < SKIP_MEMORY_TTL) return 1;
  if (age < SKIP_DAY_MS) return 0.5;
  return 0.25;
}

function getSkippedEntries(guildId, taste = profileStore.getTaste(guildId), now = Date.now()) {
  return taste.skips.map((entry) => ({
    ...entry,
    skippedAt: entry.at,
    weight: skipWeight(now - entry.at),
  }));
}

function wasRecentlySkipped(guildId, track) {
  const normalized = normalizeTrack(track);
  if (!normalized) return false;
  const cutoff = Date.now() - SKIP_MEMORY_TTL;
  return profileStore.getTaste(guildId).skips.some((entry) => entry.key === normalized.key && entry.at >= cutoff);
}

// People in the bot's voice channel who are actually listening: no bots, nobody deafened.
function getListenerIds(player, client) {
  const channelId = player?.voiceChannelId;
  const members = channelId ? client?.guilds?.cache?.get(player.guildId)?.channels?.cache?.get(channelId)?.members : null;
  if (!members) return [];
  const ids = [];
  for (const member of members.values()) {
    if (member?.user?.bot || member?.voice?.selfDeaf || member?.voice?.deaf) continue;
    ids.push(member.id);
  }
  return ids;
}

// What the person likes: their library Liked list plus their autoplay 👍s.
function likedEntries(userId) {
  return [
    ...library.listLiked(userId).map((entry) => normalizeTrack(library.entryToTrack(entry))).filter(Boolean),
    ...userTaste.listLikes(userId),
  ];
}

// Likes and dislikes belong to people, so only the people listening right now shape the pick.
// One listener's dislike rejects a track; an artist's dislike count is the most any single
// listener gave it. Liked artists count how many listeners like them. Plays stay server-wide.
function buildTasteContext(taste, now, listenerIds = []) {
  const likedKeys = new Set();
  const likedArtistCounts = new Map();
  const dislikedKeys = new Set();
  const dislikedArtistCounts = new Map();

  for (const userId of new Set(listenerIds)) {
    const artists = new Set();
    for (const liked of likedEntries(userId)) {
      likedKeys.add(liked.key);
      if (liked.artistKey) artists.add(liked.artistKey);
    }
    for (const artistKey of artists) likedArtistCounts.set(artistKey, (likedArtistCounts.get(artistKey) || 0) + 1);

    const perArtist = new Map();
    for (const entry of userTaste.listDislikes(userId, now)) {
      dislikedKeys.add(entry.key);
      if (entry.artistKey) perArtist.set(entry.artistKey, (perArtist.get(entry.artistKey) || 0) + 1);
    }
    // A blocked artist counts as disliked often enough to be rejected outright.
    for (const { artistKey } of userTaste.listBlockedArtists(userId)) {
      perArtist.set(artistKey, Math.max(perArtist.get(artistKey) || 0, DISLIKED_ARTIST_REJECT_THRESHOLD));
    }
    for (const [artistKey, count] of perArtist) {
      dislikedArtistCounts.set(artistKey, Math.max(count, dislikedArtistCounts.get(artistKey) || 0));
    }
  }

  return {
    now,
    likedKeys,
    likedArtistCounts,
    dislikedKeys,
    dislikedArtistCounts,
    played: new Map(taste.played.map((entry) => [entry.key, entry.at])),
  };
}

function feedbackEntry(track) {
  if (!track || isLocalUploadTrack(track) || isStreamTrack(track)) return null;
  const normalized = normalizeTrack(track);
  return normalized ? tasteEntry(normalized) : null;
}

// Streams and local uploads have no stable identity to rate.
function canRateTrack(track) {
  return feedbackEntry(track) !== null;
}

// 'like', 'dislike' or null: what this person told autoplay about the track. The library heart
// is separate and does not show here.
function getTrackFeedback(userId, track) {
  const entry = feedbackEntry(track);
  if (!userId || !entry) return null;
  if (userTaste.isDisliked(userId, entry.key)) return 'dislike';
  return userTaste.isLiked(userId, entry.key) ? 'like' : null;
}

// Toggles the person's autoplay like. It only steers autoplay and never touches the library.
// Returns { liked } or null when the track cannot carry feedback (streams, uploads).
function likeTrack(userId, track) {
  const entry = feedbackEntry(track);
  if (!userId || !entry) return null;
  const liked = !userTaste.isLiked(userId, entry.key);
  if (liked) userTaste.recordLike(userId, { ...entry, artwork: track.info?.artworkUrl || null });
  else userTaste.removeLike(userId, entry.key);
  logAutoplay('info', `${liked ? 'Liked' : 'Like removed'}: "${entry.title}" by ${entry.author || 'unknown'}`);
  return { liked };
}

// Takes back the person's dislike of the track. Returns { disliked: false }, or null when
// there was nothing to undo.
function undislikeTrack(userId, track) {
  const entry = feedbackEntry(track);
  if (!userId || !entry || !userTaste.removeDislike(userId, entry.key)) return null;
  logAutoplay('info', `Dislike removed: "${entry.title}" by ${entry.author || 'unknown'}`);
  return { disliked: false };
}

module.exports = {
  tasteEntry,
  classifyAutoplaySkip,
  formatPlaybackFeedback,
  getSkippedEntries,
  wasRecentlySkipped,
  getListenerIds,
  buildTasteContext,
  feedbackEntry,
  canRateTrack,
  getTrackFeedback,
  likeTrack,
  undislikeTrack,
};
