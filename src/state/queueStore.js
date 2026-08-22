const fs = require('fs');
const { FileStore } = require('./fileStore');
const { getConfig } = require('./guildConfig');
const { createSignedUploadUrl, getUploadPlaybackBaseUrl } = require('../music/uploadUrls');

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
  if (entry?.localUpload) {
    const refreshed = await refreshLocalUploadTrack(node, entry, fallbackRequester);
    if (refreshed) return refreshed;
  }

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

async function refreshLocalUploadTrack(node, entry, fallbackRequester) {
  const localUpload = entry?.localUpload;
  if (!localUpload || typeof localUpload !== 'object') return null;
  if (!localUpload.guildId || !localUpload.uploadId || !localUpload.fileName) return null;

  try {
    await fs.promises.access(localUpload.filePath, fs.constants.R_OK);
    const playbackUrl = createSignedUploadUrl({
      baseUrl: getUploadPlaybackBaseUrl(),
      guildId: localUpload.guildId,
      uploadId: localUpload.uploadId,
      fileName: localUpload.fileName,
    });
    const requester = entry.requester || fallbackRequester;
    const result = await node.search({ query: playbackUrl }, requester);
    const track = result?.tracks?.[0];
    if (!track) return null;

    return {
      ...track,
      info: {
        ...track.info,
        ...entry.info,
        uri: playbackUrl,
        sourceName: 'localUpload',
        isLocalUpload: true,
      },
      requester: entry.requester || track.requester,
      localUpload,
      isAutoplay: Boolean(entry.isAutoplay),
    };
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
    position: player.paused ? player.lastPosition ?? player.position : player.position,
    paused: Boolean(player.paused),
    repeatMode: player.repeatMode || 'off',
    volume: Number.isFinite(player.volume) ? player.volume : null,
    filterPreset: player.filterManager?.activePreset || null,
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
    const duration = Number(current.info?.duration ?? current.info?.length ?? 0);
    const requestedPosition = Number(payload.position) || 0;
    const startTime = duration > 0 ? Math.min(duration, Math.max(0, requestedPosition)) : Math.max(0, requestedPosition);
    await player.play({
      clientTrack: current,
      startTime,
    });
  } else if (player.queue.tracks.length > 0) {
    await player.play();
  }

  if (Number.isFinite(payload.volume)) {
    await player.setVolume(Math.max(0, Math.min(500, payload.volume)));
  }
  if (['off', 'track', 'queue'].includes(payload.repeatMode)) {
    await player.setRepeatMode(payload.repeatMode);
  }
  if (payload.paused && player.playing) {
    await player.pause();
  }
}

function clearStoredQueue(guildId) {
  queueStore.delete(guildId);
}

function getStoredLocalUploadPaths() {
  const paths = new Set();
  for (const [, payload] of queueStore.entries()) {
    const tracks = [payload?.current, ...(payload?.tracks || []), ...(payload?.previous || [])];
    for (const track of tracks) {
      const filePath = track?.localUpload?.filePath;
      if (typeof filePath === 'string' && filePath) paths.add(filePath);
    }
  }
  return paths;
}

function flushQueueStore() {
  return queueStore.flush();
}

module.exports = {
  savePlayerState,
  hydratePlayer,
  refreshLocalUploadTrack,
  clearStoredQueue,
  getStoredLocalUploadPaths,
  flushQueueStore,
};
