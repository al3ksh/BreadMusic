const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { formatDuration } = require('../utils/time');

const PAGE_SIZE = 10;
const QUEUE_BUTTON_PREFIX = 'queue';

function buildQueueEmbed(player, page = 0, pageSize = PAGE_SIZE) {
  const tracks = player.queue.tracks ?? [];
  const totalPages = Math.max(1, Math.ceil(Math.max(1, tracks.length) / pageSize));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const startIndex = clampedPage * pageSize;
  const slice = tracks.slice(startIndex, startIndex + pageSize);

  let etaBase = player.queue.current
    ? Math.max(0, (player.queue.current.info.duration ?? 0) - (player.position ?? 0))
    : 0;

  for (let i = 0; i < startIndex; i += 1) {
    etaBase += tracks[i]?.info?.duration ?? 0;
  }

  const lines = [];
  let runningEta = etaBase;
  slice.forEach((track, idx) => {
    const etaText = formatDuration(runningEta);
    const lengthText = formatDuration(track.info.duration ?? 0);
    lines.push(
      `\`${startIndex + idx + 1}.\` [${track.info.title ?? 'Untitled'}](${track.info.uri ?? ''})`,
      `    Author: ${track.info.author ?? 'Unknown'} | ETA ${etaText} | ${lengthText}`,
    );
    runningEta += track.info.duration ?? 0;
  });

  const remainingQueueDuration = tracks.reduce(
    (total, track) => total + (track.info.duration ?? 0),
    0,
  );
  const totalDuration =
    (player.queue.current ? Math.max(0, (player.queue.current.info.duration ?? 0) - (player.position ?? 0)) : 0) +
    remainingQueueDuration;

  const embed = new EmbedBuilder()
    .setTitle('Queue')
    .setColor('#f97316')
    .setDescription(
      lines.length ? lines.join('\n') : 'No upcoming tracks. Add something with /play.',
    )
    .addFields(
      {
        name: 'Now Playing',
        value: player.queue.current
          ? `[${player.queue.current.info.title}](${player.queue.current.info.uri ?? ''})`
          : 'Nothing is playing.',
      },
      {
        name: 'Total queue duration',
        value: formatDuration(totalDuration),
      },
    )
    .setFooter({ text: `Page ${clampedPage + 1}/${totalPages}` });

  return {
    embed,
    page: clampedPage,
    totalPages,
  };
}

function buildQueueComponents(guildId, page, totalPages, userId) {
  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;

  return [
    new ActionRowBuilder().addComponents(
        new ButtonBuilder()
        .setCustomId(`${QUEUE_BUTTON_PREFIX}:prev:${guildId}:${page}:${userId}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled),
      new ButtonBuilder()
        .setCustomId(`${QUEUE_BUTTON_PREFIX}:next:${guildId}:${page}:${userId}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled),
      new ButtonBuilder()
        .setCustomId(`${QUEUE_BUTTON_PREFIX}:close:${guildId}:${page}:${userId}`)
        .setLabel('Close')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${QUEUE_BUTTON_PREFIX}:clear:${guildId}:${page}:${userId}`)
        .setLabel('Clear Queue')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

module.exports = {
  buildQueueEmbed,
  buildQueueComponents,
  PAGE_SIZE,
  QUEUE_BUTTON_PREFIX,
};
