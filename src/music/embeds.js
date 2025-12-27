const { EmbedBuilder } = require('discord.js');
const { formatDuration, buildProgressBar } = require('../utils/time');
const { isAutoplayEnabled } = require('./autoplay');

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
  const description = track.info.uri
    ? `[${track.info.title ?? 'Unknown title'}](${track.info.uri})`
    : `${track.info.title ?? 'Unknown title'}`;

  const embed = new EmbedBuilder()
    .setTitle('➕ Added to queue')
    .setDescription(description)
    .addFields(
      { name: LABELS.ARTIST, value: track.info.author ?? 'Unknown', inline: true },
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
    .setColor('#22d3ee')
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
      .setColor('#6b7280');
  }

  const duration = track.info.duration ?? track.info.length ?? 0;
  const position = player?.position ?? 0;
  const progressBar = buildProgressBar(position, duration, 18);
  
  const autoplayOn = player?.guildId && isAutoplayEnabled(player.guildId);
  const title = autoplayOn ? 'Now Playing [AUTO]' : 'Now Playing';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `[${track.info.author ?? 'Unknown'} - ${track.info.title ?? 'Unknown'}](${track.info.uri ?? ''})\n${progressBar}\n${formatDuration(position)} / ${formatDuration(
        duration,
      )}`,
    )
    .setColor('#22d3ee')
    .addFields(
      { name: LABELS.ARTIST, value: track.info.author ?? 'Unknown', inline: true },
      { name: LABELS.DURATION, value: formatDuration(duration), inline: true },
      { name: LABELS.VOLUME, value: formatVolume(player?.volume), inline: true },
      { name: LABELS.LOOP, value: formatLoopMode(player?.repeatMode), inline: true },
      {
        name: LABELS.SOURCE,
        value: track.info.sourceName ?? 'Unknown',
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
