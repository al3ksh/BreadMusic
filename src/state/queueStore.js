const { FileStore } = require('./fileStore');
const { getConfig } = require('./guildConfig');

const queueStore = new FileStore('queues.json', {});

function packTrack(track) {
  if (!track || !track.encoded) return null;
  return {
    encoded: track.encoded,
    info: track.info,
    requester: packRequester(track.requester),
    localUpload: packLocalUpload(track.localUpload),
    isAutoplay: Boolean(track.isAutoplay),
  };
}

function packRequester(requester) {
  if (!requester || typeof requester !== 'object') return null;
  return {
    id: requester.id || null,
    username: requester.username || requester.global_name || requester.globalName || requester.tag || null,
    globalName: requester.globalName || requester.global_name || null,
    global_name: requester.global_name || requester.globalName || null,
    tag: requester.tag || null,
    avatar: requester.avatar || null,
    bot: Boolean(requester.bot),
  };
}

function packLocalUpload(localUpload) {
  if (!localUpload || typeof localUpload !== 'object') return null;
  return {
    guildId: localUpload.guildId || null,
    uploadId: localUpload.uploadId || null,
    fileName: localUpload.fileName || null,
    filePath: localUpload.filePath || null,
    expiresAt: localUpload.expiresAt || null,
    cached: Boolean(localUpload.cached),
  };
}

async function decodeTrack(node, entry, fallbackRequester) {
  const encoded = typeof entry === 'string' ? entry : entry?.encoded;
  if (!encoded) return null;
  try {
    const requester = entry?.requester || fallbackRequester;
    const decoded = await node.decode.singleTrack(encoded, requester);
    if (!decoded) return null;

    if (entry?.info) {
      decoded.info = {
        ...decoded.info,
        ...entry.info,
      };
    }
    if (entry?.requester) decoded.requester = entry.requester;
    if (entry?.localUpload) decoded.localUpload = entry.localUpload;
    if (entry?.isAutoplay) decoded.isAutoplay = true;
    return decoded;
  } catch {
    return null;
  }
}

async function decodeTracks(node, entries, requester) {
  const tracks = [];
  for (const entry of entries ?? []) {
    const decoded = await decodeTrack(node, entry, requester);
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
  const current = await decodeTrack(player.node, payload.current, requester);

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

module.exports = {
  savePlayerState,
  hydratePlayer,
  clearStoredQueue,
};
