// Player and queue snapshots the dashboard and Activity render.
const crypto = require('crypto');
const { uploadArtworkUrl } = require('../music/uploadArtworkUrls');
const { getConfig } = require('../state/guildConfig');
const {
  getAutoplayNext,
  canRateTrack,
  getTrackFeedback,
} = require('../music/autoplay');
const { getSoundState } = require('../music/sound');
const library = require('../music/library');
const { getVoteSkipSnapshot } = require('../music/skipManager');
const { isTrackSeekable } = require('../music/trackCapabilities');

const ACTIVITY_ARTWORK_HOSTS = [
  'i.ytimg.com',
  'img.youtube.com',
  'yt3.ggpht.com',
  // YouTube Music album art, used by most autoplay picks.
  'yt3.googleusercontent.com',
  'lh3.googleusercontent.com',
  'i.scdn.co',
  'scdn.co',
  'sndcdn.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
];
const PLAYER_TEXT_CHANNEL_DISABLED = 'disabled';
function resolvePlayerTextChannelId(guild, preferredChannelId = null, fallbackChannelId = null) {
  if (!guild) return null;

  if (preferredChannelId === PLAYER_TEXT_CHANNEL_DISABLED) {
    return null;
  }

  if (preferredChannelId) {
    const preferred = guild.channels.cache.get(preferredChannelId);
    if (isUsableTextChannel(preferred)) {
      return preferred.id;
    }
  }

  if (fallbackChannelId) {
    const fallback = guild.channels.cache.get(fallbackChannelId);
    if (isUsableTextChannel(fallback)) {
      return fallback.id;
    }
  }

  return null;
}

function isUsableTextChannel(channel) {
  if (!channel || !channel.isTextBased()) return false;
  if (typeof channel.isSendable === 'function') return channel.isSendable();
  return channel.viewable !== false;
}

// viewerId picks whose 👍/👎 the autoplay badge shows; feedback is per person.
function buildPlayerStatusSnapshot(client, guildId, viewerId = null) {
  const player = client.lavalink?.players?.get(guildId);
  const guild = client.guilds.cache.get(guildId);
  const config = getConfig(guildId);

  if (!player) {
    return {
      connected: false,
      playing: false,
      paused: false,
      voiceChannelId: null,
      voiceChannelName: null,
      currentTrack: null,
      queueLength: 0,
      repeatMode: 'off',
      volume: 100,
      filters: null,
      autoplay: config.autoplay ?? false,
      autoplayNext: null,
      autoplayFeedback: null,
      autoplayRateable: false,
      liked: false,
      likeable: false,
      voteSkip: null,
      sessionHistory: [],
    };
  }

  let voiceChannelName = null;
  if (player.voiceChannelId && guild) {
    const channel = guild.channels.cache.get(player.voiceChannelId);
    voiceChannelName = channel ? channel.name : null;
  }

  let currentTrack = null;
  if (player.queue.current) {
    const info = player.queue.current.info || {};
    const isLocalUpload = isLocalUploadInfo(info, player.queue.current);
    currentTrack = {
      title: info.title || 'Unknown',
      author: isLocalUpload && isUnknownTrackAuthor(info.author) ? 'Local upload' : info.author || 'Unknown',
      uri: info.uri || '',
      duration: info.duration || 0,
      position: player.position || 0,
      seekable: isTrackSeekable(player.queue.current),
      artwork: extractArtwork(info),
      requester: formatRequester(player.queue.current.requester),
    };
  }

  const sessionHistory = (player.queue.previous || [])
    .slice(-2)
    .reverse()
    .map((track) => {
      const info = track?.info || {};
      return {
        title: info.title || 'Unknown',
        author: info.author || 'Unknown',
        uri: info.uri || '',
        duration: info.duration || 0,
        artwork: extractArtwork(info),
      };
    });

  return {
    connected: true,
    playing: player.playing,
    paused: player.paused,
    voiceChannelId: player.voiceChannelId,
    voiceChannelName,
    currentTrack,
    queueLength: player.queue.tracks.length,
    repeatMode: player.repeatMode || 'off',
    volume: player.volume ?? 100,
    filters: player.filterManager?.activePreset || null,
    sound: getSoundState(player),
    autoplay: config.autoplay ?? false,
    autoplayNext: buildAutoplayNextSnapshot(guildId, config),
    autoplayFeedback: config.autoplay ? getTrackFeedback(viewerId, player.queue.current) : null,
    autoplayRateable: Boolean(config.autoplay && canRateTrack(player.queue.current)),
    // The heart is the viewer's own library Liked list.
    liked: Boolean(viewerId && library.isLiked(viewerId, player.queue.current)),
    likeable: library.canSaveTrack(player.queue.current),
    voteSkip: getVoteSkipSnapshot(player, config, guild),
    sessionHistory,
  };
}

function buildAutoplayNextSnapshot(guildId, config) {
  if (!config.autoplay) return null;
  const next = getAutoplayNext(guildId);
  if (!next) return null;
  return {
    title: next.title || 'Unknown',
    author: next.author || 'Unknown',
    uri: next.uri || '',
    duration: next.duration || 0,
    artwork: extractArtwork(next),
    source: next.source || null,
  };
}

function buildQueueSnapshot(client, guildId, page = 0) {
  const player = client.lavalink?.players?.get(guildId);
  if (!player) {
    return { current: null, tracks: [], total: 0, page, totalPages: 0, revision: 'empty' };
  }

  const perPage = 20;
  const allTracks = player.queue.tracks;
  const start = page * perPage;
  const revision = buildQueueRevision(allTracks);

  const current = player.queue.current
    ? formatQueueTrack(player.queue.current)
    : null;

  const tracks = allTracks
    .slice(start, start + perPage)
    .map((track) => formatQueueTrack(track));

  return {
    current,
    tracks,
    total: allTracks.length,
    page,
    totalPages: Math.ceil(allTracks.length / perPage),
    revision,
  };
}

function buildQueueRevision(tracks) {
  const hash = crypto.createHash('sha1');
  hash.update(String(tracks.length));
  for (const track of tracks) {
    const info = track?.info || {};
    hash.update('\0');
    hash.update(String(info.identifier || info.uri || track?.localUpload?.uploadId || ''));
    hash.update('\0');
    hash.update(String(info.title || ''));
    hash.update('\0');
    hash.update(String(info.author || ''));
    hash.update('\0');
    hash.update(String(track?.requester?.id || track?.requester?.username || ''));
    hash.update('\0');
    hash.update(track?.isAutoplay ? '1' : '0');
    if (info.uploadArtwork) {
      hash.update(JSON.stringify(info.uploadArtwork));
      hash.update(String(Math.floor(Date.now() / 3600000)));
    }
  }
  return hash.digest('base64url').slice(0, 16);
}

function formatQueueTrack(track) {
  const info = track?.info || {};
  const isLocalUpload = isLocalUploadInfo(info, track);
  const formatted = {
    title: info.title || track?.localUpload?.fileName || 'Unknown',
    author: isLocalUpload && isUnknownTrackAuthor(info.author) ? 'Local upload' : info.author || 'Unknown',
    uri: info.uri || '',
    duration: info.duration || 0,
    requester: formatRequester(track?.requester),
    artwork: extractArtwork(info),
  };

  return formatted;
}

function formatRequester(requester) {
  return requester?.global_name || requester?.globalName || requester?.username || requester?.tag || requester?.id || 'Unknown';
}

function isLocalUploadInfo(info = {}, track = null) {
  return Boolean(
    track?.localUpload ||
      info.localUpload ||
      info.isLocalUpload ||
      info.sourceName === 'localUpload' ||
      (typeof info.uri === 'string' && info.uri.includes('/api/uploads/')),
  );
}

function isUnknownTrackAuthor(author) {
  if (typeof author !== 'string') return true;
  const normalized = author.trim().toLowerCase();
  return !normalized || normalized === 'unknown' || normalized === 'unknown artist';
}

function parseQueuePage(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function extractArtwork(info) {
  if (info.uploadArtwork) return uploadArtworkUrl(info.uploadArtwork);
  if (info.artworkUrl) return info.artworkUrl;
  if (info.uri && (info.uri.includes('youtube.com') || info.uri.includes('youtu.be')) && info.identifier) {
    return `https://i.ytimg.com/vi/${info.identifier}/mqdefault.jpg`;
  }
  return null;
}

function isAllowedActivityArtworkHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return ACTIVITY_ARTWORK_HOSTS.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

module.exports = {
  PLAYER_TEXT_CHANNEL_DISABLED,
  resolvePlayerTextChannelId,
  isUsableTextChannel,
  buildPlayerStatusSnapshot,
  buildQueueSnapshot,
  isUnknownTrackAuthor,
  parseQueuePage,
  writeSseEvent,
  extractArtwork,
  isAllowedActivityArtworkHost,
};
