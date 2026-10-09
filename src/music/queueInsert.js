const { getConfig, hasDJPermissions } = require('../state/guildConfig');
const { CommandError } = require('../utils/commandError');

const DUPLICATE_WARNING_MS = 60_000;
const duplicateWarnings = new Map();

function requesterKey(track) {
  return track?.requester?.id ?? 'unknown';
}

// Fair queue: each requester gets a turn before anyone gets a second one. A track's turn is how many
// tracks its requester already has ahead of it (the one playing counts), and a new track goes in
// right after everything with a turn no later than its own, so earlier arrivals keep their place.
function fairIndex(tracks, end, current, key) {
  const turns = new Map();
  if (current) turns.set(requesterKey(current), 1);
  const trackTurns = [];
  for (let index = 0; index < end; index += 1) {
    const trackKey = requesterKey(tracks[index]);
    const turn = turns.get(trackKey) ?? 0;
    trackTurns.push(turn);
    turns.set(trackKey, turn + 1);
  }
  const ownTurn = turns.get(key) ?? 0;
  const index = trackTurns.findIndex((turn) => turn > ownTurn);
  return index === -1 ? end : index;
}

// Queues tracks someone asked for. They always go ahead of autoplay picks; with the fair queue on
// they also take turns with what other people queued. `next` puts them first, ahead of any turns.
async function queueRequestedTracks(player, input, { fair = getConfig(player.guildId).fairQueue, next = false } = {}) {
  const tracks = Array.isArray(input) ? input : [input];
  if (tracks.length === 0) return;
  if (next) {
    player.queue.tracks.splice(0, 0, ...tracks);
    return;
  }
  const autoplayIndex = player.queue.tracks.findIndex((track) => track.isAutoplay);

  if (!fair) {
    if (autoplayIndex !== -1) player.queue.tracks.splice(autoplayIndex, 0, ...tracks);
    else await player.queue.add(Array.isArray(input) ? tracks : tracks[0]);
    return;
  }

  let end = autoplayIndex === -1 ? player.queue.tracks.length : autoplayIndex;
  for (const track of tracks) {
    player.queue.tracks.splice(fairIndex(player.queue.tracks, end, player.queue.current, requesterKey(track)), 0, track);
    end += 1;
  }
}

// Per-person limit: trims what someone adds to the room they have left and refuses once they
// have nothing left. Tracks already waiting count; the one playing and autoplay picks do not.
function fitQueueLimit(player, tracks, { userId, member, config = getConfig(player.guildId) }) {
  const limit = config.maxQueuedPerUser || 0;
  if (limit <= 0 || hasDJPermissions(member, config)) return { tracks, skipped: 0 };
  const waiting = player.queue.tracks.filter((track) => !track.isAutoplay && track.requester?.id === userId).length;
  const room = Math.max(0, limit - waiting);
  if (room === 0) {
    throw new CommandError(`You already have ${limit} ${limit === 1 ? 'track' : 'tracks'} waiting. Let one play first.`);
  }
  return { tracks: tracks.slice(0, room), skipped: Math.max(0, tracks.length - room) };
}

function sameTrack(a, b) {
  if (!a?.info || !b?.info) return false;
  if (a.encoded && a.encoded === b.encoded) return true;
  if (a.info.uri && a.info.uri === b.info.uri) return true;
  return Boolean(a.info.identifier && a.info.identifier === b.info.identifier
    && a.info.sourceName === b.info.sourceName);
}

// Where a track already waits: 0 while it plays, 1-based queue position otherwise, null if it is not there.
function findQueuedCopy(player, track) {
  if (sameTrack(player.queue.current, track)) return 0;
  const index = player.queue.tracks.findIndex((entry) => !entry.isAutoplay && sameTrack(entry, track));
  return index === -1 ? null : index + 1;
}

function describeQueuedCopy(track, position) {
  const title = track.info?.title ?? 'This track';
  return position === 0 ? `**${title}** is playing right now.` : `**${title}** is already in the queue at #${position}.`;
}

// For clients without a confirm button: the first add of a copy is turned away with a warning,
// and asking again for the same track within a minute queues it anyway.
function takeDuplicateWarning(player, track, userId) {
  const position = findQueuedCopy(player, track);
  if (position === null) return null;
  const now = Date.now();
  for (const [key, expiresAt] of duplicateWarnings) if (expiresAt <= now) duplicateWarnings.delete(key);
  const key = `${player.guildId}:${userId}:${track.info?.uri || track.info?.identifier || track.encoded}`;
  if (duplicateWarnings.has(key)) {
    duplicateWarnings.delete(key);
    return null;
  }
  duplicateWarnings.set(key, now + DUPLICATE_WARNING_MS);
  return `${describeQueuedCopy(track, position)} Add it again to queue a second copy.`.replace(/\*\*/g, '');
}

module.exports = {
  queueRequestedTracks,
  fairIndex,
  fitQueueLimit,
  findQueuedCopy,
  describeQueuedCopy,
  takeDuplicateWarning,
};
