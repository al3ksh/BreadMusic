const { getConfig } = require('../state/guildConfig');

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
// they also take turns with what other people queued.
async function queueRequestedTracks(player, input, { fair = getConfig(player.guildId).fairQueue } = {}) {
  const tracks = Array.isArray(input) ? input : [input];
  if (tracks.length === 0) return;
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

module.exports = { queueRequestedTracks, fairIndex };
