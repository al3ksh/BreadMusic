const { FileStore } = require('./fileStore');
const { getConfig } = require('./guildConfig');

const queueStore = new FileStore('queues.json', {});

function packTrack(track) {
  if (!track || !track.encoded) return null;
  return {
    encoded: track.encoded,
    info: track.info,
  };
}

async function decodeTrack(node, encoded, requester) {
  if (!encoded) return null;
  try {
    return await node.decode.singleTrack(encoded, requester);
  } catch {
    return null;
  }
}

async function decodeTracks(node, entries, requester) {
  const tracks = [];
  for (const entry of entries ?? []) {
    const decoded = await decodeTrack(node, entry?.encoded ?? entry, requester);
    if (decoded) tracks.push(decoded);
  }
  return tracks;
}

async function savePlayerState(player) {
  const config = getConfig(player.guildId);
  if (!config.persistentQueue) {
    queueStore.delete(player.guildId);
    return;
  }

  const payload = {
    voiceChannelId: player.voiceChannelId,
    textChannelId: player.textChannelId,
    current: packTrack(player.queue.current),
    tracks: player.queue.tracks.map((track) => packTrack(track)).filter(Boolean),
    previous: player.queue.previous.map((track) => packTrack(track)).filter(Boolean),
    position: player.position,
    timestamp: Date.now(),
  };

  queueStore.set(player.guildId, payload);
}

async function hydratePlayer(player, client) {
  const config = getConfig(player.guildId);
  if (!config.persistentQueue) return;

  const payload = queueStore.get(player.guildId);
  if (!payload) return;

  const requester = client.user ?? { id: '0', username: 'Bot' };
  const decodedQueue = await decodeTracks(player.node, payload.tracks, requester);
  const decodedPrevious = await decodeTracks(player.node, payload.previous, requester);
  const current = await decodeTrack(player.node, payload.current?.encoded, requester);

  if (decodedQueue.length) {
    await player.queue.add(decodedQueue);
  }

  if (decodedPrevious.length) {
    player.queue.previous.splice(0, player.queue.previous.length, ...decodedPrevious);
  }

  if (current) {
    await player.play({
      clientTrack: current,
      startTime: payload.position ?? 0,
    });
  } else if (player.queue.tracks.length > 0) {
    await player.play();
  }
}

function clearStoredQueue(guildId) {
  queueStore.delete(guildId);
}

function resetAllQueues() {
  queueStore.clearAll();
}

module.exports = {
  savePlayerState,
  hydratePlayer,
  clearStoredQueue,
  resetAllQueues,
};
