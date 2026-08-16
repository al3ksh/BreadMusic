const { getConfig } = require('../state/guildConfig');

const statusCache = new Map();
const guildChannelCache = new Map();
const permissionWarnings = new Set();
const originalStatusCache = new Map();
const pendingStatusRequests = new Map();
const recentlyClearedChannels = new Map();

const MAX_VISIBLE_STATUS_LENGTH = 100;

async function setVoiceTrackStatus(client, player, track) {
  if (!client?.rest || !player?.voiceChannelId || !track) return false;
  forgetRecentlyCleared(player.voiceChannelId);
  if (!getConfig(player.guildId).voiceChannelStatus) {
    await clearVoiceTrackStatus(client, player);
    return false;
  }
  const previousChannelId = guildChannelCache.get(player.guildId);
  if (previousChannelId && previousChannelId !== player.voiceChannelId) {
    await updateVoiceStatus(client, previousChannelId, null);
  }
  const originalStatus = await getOriginalVoiceStatus(
    client,
    player.guildId,
    player.voiceChannelId,
  );
  const status = originalStatus
    ? truncate(`${originalStatus} • ♪ Bread`, MAX_VISIBLE_STATUS_LENGTH)
    : formatVoiceTrackStatus(track);
  const updated = await updateVoiceStatus(client, player.voiceChannelId, status);
  if (updated) guildChannelCache.set(player.guildId, player.voiceChannelId);
  return updated;
}

async function clearVoiceTrackStatus(client, playerOrChannelId) {
  const channelId =
    typeof playerOrChannelId === 'string'
      ? playerOrChannelId
      : playerOrChannelId?.voiceChannelId ??
        guildChannelCache.get(playerOrChannelId?.guildId);
  if (!client?.rest || !channelId) return false;
  if (recentlyClearedChannels.has(channelId)) return true;
  const restoredStatus = originalStatusCache.get(channelId) || null;
  const cleared = await updateVoiceStatus(client, channelId, restoredStatus);
  if (cleared) {
    forgetVoiceChannel(channelId);
    const timeout = setTimeout(() => recentlyClearedChannels.delete(channelId), 10_000);
    timeout.unref?.();
    recentlyClearedChannels.set(channelId, timeout);
  }
  return cleared;
}

function forgetRecentlyCleared(channelId) {
  const timeout = recentlyClearedChannels.get(channelId);
  if (timeout) clearTimeout(timeout);
  recentlyClearedChannels.delete(channelId);
}

function formatVoiceTrackStatus(track) {
  const title = track?.info?.title || track?.localUpload?.fileName || 'Unknown track';
  const author = track?.info?.author;
  const label =
    !isYouTubeTrack(track) && author && !isUnknownAuthor(author)
      ? `${author} - ${title}`
      : title;
  return truncate(`♪ ${label}`, MAX_VISIBLE_STATUS_LENGTH);
}

async function updateVoiceStatus(client, channelId, status) {
  if (statusCache.has(channelId) && statusCache.get(channelId) === status) return true;

  try {
    await client.rest.put(`/channels/${channelId}/voice-status`, {
      body: { status },
    });
    statusCache.set(channelId, status);
    permissionWarnings.delete(channelId);
    return true;
  } catch (error) {
    if (error?.code === 50013 || error?.status === 403) {
      if (!permissionWarnings.has(channelId)) {
        permissionWarnings.add(channelId);
        console.warn(
          `[VoiceStatus] Missing SET_VOICE_CHANNEL_STATUS permission for channel ${channelId}.`,
        );
      }
      return false;
    }

    console.warn(
      `[VoiceStatus] Failed to update channel ${channelId}: ${error?.message ?? error}`,
    );
    return false;
  }
}

function forgetVoiceChannel(channelId) {
  statusCache.delete(channelId);
  originalStatusCache.delete(channelId);
  permissionWarnings.delete(channelId);
  for (const [guildId, cachedChannelId] of guildChannelCache.entries()) {
    if (cachedChannelId === channelId) {
      guildChannelCache.delete(guildId);
    }
  }
}

async function getOriginalVoiceStatus(client, guildId, channelId) {
  if (originalStatusCache.has(channelId)) {
    return originalStatusCache.get(channelId);
  }

  const status = await requestVoiceStatus(client, guildId, channelId);
  const original = isBreadStatus(status) ? null : status;
  originalStatusCache.set(channelId, original || null);
  return original || null;
}

function requestVoiceStatus(client, guildId, channelId, timeoutMs = 1_500) {
  const guild = client?.guilds?.cache?.get(guildId);
  const shard = client?.ws?.shards?.get(guild?.shardId ?? 0);
  if (!guildId || !channelId || !shard?.send) return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = { channelId, resolve };
    const requests = pendingStatusRequests.get(guildId) || [];
    requests.push(request);
    pendingStatusRequests.set(guildId, requests);

    const timeout = setTimeout(() => finishStatusRequest(guildId, request, null), timeoutMs);
    timeout.unref?.();
    request.timeout = timeout;

    try {
      shard.send({
        op: 43,
        d: { guild_id: guildId, fields: ['status'] },
      });
    } catch {
      finishStatusRequest(guildId, request, null);
    }
  });
}

function handleVoiceStatusGatewayEvent(packet) {
  if (packet?.t === 'CHANNEL_INFO') {
    const guildId = packet.d?.guild_id;
    const requests = pendingStatusRequests.get(guildId);
    if (!requests?.length) return;
    for (const request of [...requests]) {
      const channel = packet.d?.channels?.find((candidate) => candidate.id === request.channelId);
      finishStatusRequest(guildId, request, channel?.status || null);
    }
    return;
  }

  if (packet?.t !== 'VOICE_CHANNEL_STATUS_UPDATE') return;
  const channelId = packet.d?.id;
  if (!channelId) return;
  const status = packet.d?.status || null;
  if (statusCache.get(channelId) === status || isBreadStatus(status)) return;
  originalStatusCache.set(channelId, status);
}

function finishStatusRequest(guildId, request, status) {
  const requests = pendingStatusRequests.get(guildId);
  if (!requests?.includes(request)) return;
  clearTimeout(request.timeout);
  const remaining = requests.filter((candidate) => candidate !== request);
  if (remaining.length) pendingStatusRequests.set(guildId, remaining);
  else pendingStatusRequests.delete(guildId);
  request.resolve(status);
}

function isBreadStatus(status) {
  return typeof status === 'string' && (
    status.includes('♪ Bread') ||
    status.startsWith('♪ ')
  );
}

function isUnknownAuthor(author) {
  const normalized = String(author).trim().toLowerCase();
  return !normalized || normalized === 'unknown' || normalized === 'unknown artist';
}

function isYouTubeTrack(track) {
  const source = String(track?.info?.sourceName || '').toLowerCase();
  const uri = String(track?.info?.uri || '');
  return source === 'youtube' || /youtu(?:\.be|be\.com)/i.test(uri);
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

module.exports = {
  clearVoiceTrackStatus,
  formatVoiceTrackStatus,
  handleVoiceStatusGatewayEvent,
  setVoiceTrackStatus,
};
