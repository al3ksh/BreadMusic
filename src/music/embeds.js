const { EmbedBuilder } = require('discord.js');
const { formatDuration, buildProgressBar } = require('../utils/time');
const { isAutoplayEnabled } = require('./autoplay');
const { BRAND_COLORS } = require('../theme');

const LABELS = {
  TITLE: '🎶',
  ARTIST: '🎙️ Artist',
  DURATION: '⏱️ Duration',
  VOLUME: '🔊 Volume',
  LOOP: '🔁 Loop',
  SOURCE: '📡 Source',
  CHANNEL: '🔈 Channel',
};

function buildTrackEmbed(track, requester, voiceChannelId) {
  const requesterLabel = requester?.tag ?? requester?.username ?? requester?.id ?? 'Unknown user';
  const trackTitle = formatTrackTitle(track);
  const trackAuthor = formatTrackAuthor(track);
  const description = track.info.uri
    ? `[${trackTitle}](${track.info.uri})`
    : trackTitle;

  const embed = new EmbedBuilder()
    .setTitle('➕ Added to queue')
    .setDescription(description)
    .addFields(
      { name: LABELS.ARTIST, value: trackAuthor, inline: true },
      {
        name: LABELS.DURATION,
        value: formatDuration(track.info.duration ?? track.info.length ?? 0),
        inline: true,
      },
      {
        name: LABELS.CHANNEL,
        value: voiceChannelId ? `<#${voiceChannelId}>` : 'Not connected',
        inline: true,
      },
    )
    .setColor(BRAND_COLORS.primary)
    .setTimestamp()
    .setFooter({ text: `Requested by ${requesterLabel}` });

  const artworkUrl = resolveArtwork(track);
  if (artworkUrl) {
    embed.setThumbnail(artworkUrl);
  }

  return embed;
}

function buildNowPlayingEmbed(player, track) {
  if (!track) {
    return new EmbedBuilder()
      .setTitle('Nothing playing')
      .setDescription('Queue is empty.')
      .setColor(BRAND_COLORS.secondary);
  }

  const duration = track.info.duration ?? track.info.length ?? 0;
  const position = player?.position ?? 0;
  const progressBar = buildProgressBar(position, duration, 18);
  
  const autoplayOn = player?.guildId && isAutoplayEnabled(player.guildId);
  const title = autoplayOn ? 'Now Playing [AUTO]' : 'Now Playing';
  const trackTitle = formatTrackTitle(track);
  const trackAuthor = formatTrackAuthor(track);
  const source = formatTrackSource(track);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `${formatTrackLink(track, `${trackAuthor} - ${trackTitle}`)}\n${progressBar}\n${formatDuration(position)} / ${formatDuration(
        duration,
      )}`,
    )
    .setColor(player?.paused ? BRAND_COLORS.secondary : BRAND_COLORS.primary)
    .addFields(
      { name: LABELS.ARTIST, value: trackAuthor, inline: true },
      { name: LABELS.DURATION, value: formatDuration(duration), inline: true },
      { name: LABELS.VOLUME, value: formatVolume(player?.volume), inline: true },
      { name: LABELS.LOOP, value: formatLoopMode(player?.repeatMode), inline: true },
      {
        name: LABELS.SOURCE,
        value: source,
        inline: true,
      },
      {
        name: LABELS.CHANNEL,
        value: player?.voiceChannelId ? `<#${player.voiceChannelId}>` : 'Not connected',
        inline: true,
      },
    )
    .setFooter({
      text: track.requester
        ? `Requested by ${track.requester.username ?? track.requester.tag ?? track.requester.id}`
        : 'Requested by Unknown',
    })
    .setTimestamp();

  const artworkUrl = resolveArtwork(track);
  if (artworkUrl) {
    embed.setThumbnail(artworkUrl);
  }

  return embed;
}

function formatLoopMode(mode) {
  if (!mode || mode === 'off') return 'Off';
  if (mode === 'track') return 'Track';
  if (mode === 'queue') return 'Queue';
  return mode;
}

function formatVolume(volume) {
  if (!Number.isFinite(volume)) return '100%';
  return `${volume}%`;
}

function formatTrackTitle(track) {
  return track?.info?.title || track?.localUpload?.fileName || 'Unknown title';
}

function formatTrackAuthor(track) {
  const author = track?.info?.author;
  if (isLocalUploadTrack(track) && isUnknownTrackAuthor(author)) {
    return 'Local upload';
  }
  return author || 'Unknown';
}

function formatTrackSource(track) {
  if (isLocalUploadTrack(track)) return 'upload';
  return track?.info?.sourceName ?? 'Unknown';
}

function formatTrackLink(track, label) {
  const uri = track?.info?.uri;
  if (!uri) return label;
  return `[${label}](${uri})`;
}

function isLocalUploadTrack(track) {
  const info = track?.info || {};
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

function resolveArtwork(track) {
  if (track?.info?.artworkUrl) return track.info.artworkUrl;
  const identifier = track?.info?.identifier;
  if (
    identifier &&
    (track.info.sourceName === 'youtube' ||
      (track.info.uri && /youtu(\.be|be\.com)/i.test(track.info.uri)))
  ) {
    return `https://img.youtube.com/vi/${identifier}/hqdefault.jpg`;
  }
  return null;
}

module.exports = {
  buildTrackEmbed,
  buildNowPlayingEmbed,
  resolveArtwork,
};
