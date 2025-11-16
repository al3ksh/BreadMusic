const { EmbedBuilder } = require('discord.js');
const { formatDuration } = require('../utils/time');

function buildTrackEmbed(track, requester, voiceChannelId) {
  const requesterLabel = requester?.tag ?? requester?.username ?? requester?.id ?? 'Unknown user';
  const description = track.info.uri
    ? `[${track.info.title ?? 'Unknown title'}](${track.info.uri})`
    : `${track.info.title ?? 'Unknown title'}`;

  const embed = new EmbedBuilder()
    .setTitle('✅ Added to queue')
    .setDescription(description)
    .addFields(
      { name: '🎙️ Artist', value: track.info.author ?? 'Unknown', inline: true },
      {
        name: '⏱️ Duration',
        value: formatDuration(track.info.duration ?? track.info.length ?? 0),
        inline: true,
      },
      {
        name: '🎧 Channel',
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

function resolveArtwork(track) {
  if (track.info.artworkUrl) return track.info.artworkUrl;
  const identifier = track.info.identifier;
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
};
