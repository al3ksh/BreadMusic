const { getConfig } = require('../state/guildConfig');

const statusCache = new Map();
const guildChannelCache = new Map();
const permissionWarnings = new Set();

const MAX_VISIBLE_STATUS_LENGTH = 100;

async function setVoiceTrackStatus(client, player, track) {
  if (!client?.rest || !player?.voiceChannelId || !track) return false;
  if (!getConfig(player.guildId).voiceChannelStatus) {
    await clearVoiceTrackStatus(client, player);
    return false;
  }
  const previousChannelId = guildChannelCache.get(player.guildId);
  if (previousChannelId && previousChannelId !== player.voiceChannelId) {
    await updateVoiceStatus(client, previousChannelId, null);
  }
  const status = formatVoiceTrackStatus(track);
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
  const cleared = await updateVoiceStatus(client, channelId, null);
  if (cleared) {
    forgetVoiceChannel(channelId);
  }
  return cleared;
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
  permissionWarnings.delete(channelId);
  for (const [guildId, cachedChannelId] of guildChannelCache.entries()) {
    if (cachedChannelId === channelId) {
      guildChannelCache.delete(guildId);
    }
  }
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
  setVoiceTrackStatus,
};
