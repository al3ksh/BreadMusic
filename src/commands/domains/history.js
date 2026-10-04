const { tagOrigin } = require('../../music/trackOrigin');
const { getGuildHistory } = require('../../state/analyticsStore');

const COMPONENT_PREFIX = 'history:';
const PAGE_SIZE = 10;

function clip(text, length) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function buildHistoryPanel(context, guildId, requestedPage = 0, { history = getGuildHistory } = {}) {
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, BRAND_COLORS } = context;
  let result = history(guildId, { page: requestedPage, limit: PAGE_SIZE });
  if (requestedPage > 0 && result.items.length === 0 && result.total > 0) {
    result = history(guildId, { page: result.totalPages - 1, limit: PAGE_SIZE });
  }
  const { items, page, totalPages, total } = result;

  const lines = items.map((item, index) => {
    const tag = item.autoplay ? ' · 🤖' : '';
    const when = item.playedAt ? ` · <t:${Math.floor(item.playedAt / 1000)}:R>` : '';
    return `\`${page * PAGE_SIZE + index + 1}.\` **${clip(item.track.title, 70)}** — ${clip(item.track.author || 'Unknown artist', 40)}${when}${tag}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('🕘 Recently played')
    .setDescription(lines.length ? lines.join('\n') : 'Nothing has been played here yet.')
    .setColor(BRAND_COLORS.secondary)
    .setFooter({ text: `Page ${page + 1}/${totalPages} · ${total} plays · 🤖 = autoplay pick` });

  const components = [];
  const options = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.track.uri && item.playedAt)
    .map(({ item, index }) => ({
      label: clip(`${page * PAGE_SIZE + index + 1}. ${item.track.title}`, 100),
      description: clip(item.track.author || 'Unknown artist', 100),
      value: String(item.playedAt),
    }));
  // The same moment can only hold one play, but guard against duplicate values anyway.
  const unique = options.filter((option, index) => options.findIndex((other) => other.value === option.value) === index);
  if (unique.length) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`${COMPONENT_PREFIX}${guildId}:play:${page}`)
      .setPlaceholder('Queue one of these again')
      .addOptions(unique)));
  }
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${COMPONENT_PREFIX}${guildId}:page:${page - 1}`)
        .setLabel('Newer')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`${COMPONENT_PREFIX}${guildId}:page:${page + 1}`)
        .setLabel('Older')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
    ));
  }
  return { embeds: [embed], components };
}

// New plays push entries further back, so the picked one is on its page or the next one.
function findHistoryItem(guildId, page, playedAt, history = getGuildHistory) {
  for (const candidate of [page, page + 1]) {
    const { items } = history(guildId, { page: candidate, limit: PAGE_SIZE });
    const match = items.find((item) => String(item.playedAt) === playedAt);
    if (match) return match;
  }
  return null;
}

const createHistoryCommands = (context) => {
  const {
    SlashCommandBuilder,
    MessageFlags,
    CommandError,
    ensureVoice,
    addManualSeed,
    buildTrackEmbed,
    classifyPlaybackError,
    queuePersist,
    history = getGuildHistory,
  } = context;

  async function queueAgain(interaction, guildId, page) {
    const item = findHistoryItem(guildId, page, interaction.values?.[0], history);
    if (!item?.track.uri) throw new CommandError('That play is no longer in the history.');

    await interaction.deferReply();
    const { player, voiceChannelId } = await ensureVoice(interaction, { requireSameChannel: true, createPlayer: true });
    let track;
    try {
      const result = await player.search(item.track.uri, interaction.user);
      track = result?.tracks?.[0];
    } catch (error) {
      const failure = classifyPlaybackError(error);
      await interaction.deleteReply().catch(() => {});
      await interaction.followUp({ content: `**${failure.title}**\n${failure.description}`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!track) {
      await interaction.deleteReply().catch(() => {});
      await interaction.followUp({ content: `Could not load **${item.track.title}** again.`, flags: MessageFlags.Ephemeral });
      return;
    }

    tagOrigin(track, 'history');
    addManualSeed(player.guildId, track);
    const autoplayIndex = player.queue.tracks.findIndex((queued) => queued.isAutoplay);
    if (autoplayIndex !== -1) player.queue.tracks.splice(autoplayIndex, 0, track);
    else await player.queue.add(track);
    if (!player.playing && !player.paused) await player.play();
    await queuePersist(player);
    await interaction.editReply({ embeds: [buildTrackEmbed(track, interaction.user, voiceChannelId)] });
  }

  return [
    {
      componentPrefix: COMPONENT_PREFIX,
      data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Recently played tracks on this server; queue any of them again.'),
      async execute(interaction) {
        if (!interaction.guildId) throw new CommandError('History is only available in a server.');
        await interaction.reply({ ...buildHistoryPanel(context, interaction.guildId, 0, { history }), flags: MessageFlags.Ephemeral });
      },
      async handleComponent(interaction) {
        const [guildId, action, rawPage] = interaction.customId.slice(COMPONENT_PREFIX.length).split(':');
        if (guildId !== interaction.guildId) throw new CommandError('This list belongs to another server.');
        const page = Math.max(0, Number.parseInt(rawPage, 10) || 0);
        if (action === 'page') {
          await interaction.update(buildHistoryPanel(context, guildId, page, { history }));
          return;
        }
        if (action === 'play') await queueAgain(interaction, guildId, page);
      },
    },
  ];
};

module.exports = { createHistoryCommands, buildHistoryPanel, findHistoryItem, PAGE_SIZE };
