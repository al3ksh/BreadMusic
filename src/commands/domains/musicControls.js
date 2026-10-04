const { likeTrack, dislikeTrack, rerollNext, REROLL_FAILURES, handleAutoplay } = require('../../music/autoplay');

const createMusicControlCommands = (context) => {
  const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ensureVoice,
    ensurePlayer,
    CommandError,
    buildTrackEmbed,
    buildNowPlayingEmbed,
    savePlayerState,
    getConfig,
    setConfig,
    deleteConfig,
    assertDJ,
    hasDJPermissions,
    formatConfig,
    buildQueueEmbed,
    buildQueueComponents,
    formatDuration,
    parseTimecode,
    isTrackSeekable,
    isUnseekableTrackError,
    seekTrack,
    getSelection,
    deleteSelection,
    startBlackjack,
    endBlackjack,
    buildBlackjackEmbed,
    buildBlackjackComponents,
    getBlackjackGame,
    getBalance,
    addBalance,
    claimHourly,
    getLeaderboard,
    hasBalance,
    HOURLY_COOLDOWN,
    playSlots,
    playRoulette,
    playCoinflip,
    buildSlotsEmbed,
    buildRouletteEmbed,
    buildCoinflipEmbed,
    playRPS,
    magic8Ball,
    rollDice,
    buildRPSEmbed,
    build8BallEmbed,
    buildDiceEmbed,
    buildRPSChoiceComponents,
    applyPreferredSource,
    handleSkipRequest,
    markPlayerStopping,
    deleteInteractionReply,
    isAutoplayEnabled,
    toggleAutoplay,
    addManualSeed,
    clearAutoplayState,
    classifyPlaybackError,
    describeSearchFailure,
    clearVoiceTrackStatus,
    setVoiceTrackStatus,
    findLyrics,
    trackToLyricsQuery,
    LyricsProviderError,
    BRAND_COLORS,
    buildDashboardUrl,
    getGuildInsights,
    getUserInsights,
    withGuildMutex,
    FILTER_PRESET_CHOICES,
    BASSBOOST_EQ,
    RADIO_EQ,
    formatStatsDuration,
    formatCompactRankedCounts,
    formatSourceLabel,
    formatRankedSources,
    formatRankedRequesters,
    formatRankedTracks,
    FILTER_PRESETS,
    queuePersist,
    HELP_CATEGORIES,
    HELP_PAGE_COUNT,
    buildHelpEmbed,
    buildHelpComponents,
  } = context;
  return [
  {
    data: new SlashCommandBuilder()
      .setName('autoplay')
      .setDescription('Autoplay - automatically plays similar tracks.')
      .addSubcommand((sub) => sub.setName('toggle').setDescription('Turn autoplay on or off.'))
      .addSubcommand((sub) => sub.setName('like').setDescription('Like the current track so autoplay picks more like it.'))
      .addSubcommand((sub) => sub.setName('dislike').setDescription('Dislike and skip the current track; autoplay will avoid it.'))
      .addSubcommand((sub) => sub.setName('next').setDescription('Pick a different autoplay track to play next.')),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      const subcommand = interaction.options.getSubcommand(false) ?? 'toggle';

      if (subcommand === 'like') {
        const track = player.queue.current;
        const result = likeTrack(interaction.guildId, track);
        if (!result) {
          await interaction.editReply('This track cannot be liked.');
          return;
        }
        await interaction.client.musicUI.refresh(player);
        await interaction.editReply(
          result.liked
            ? `\uD83D\uDC4D Liked **${track.info.title}**. Autoplay will pick more like it.`
            : `Removed your like from **${track.info.title}**.`,
        );
        return;
      }

      // A dislike is remembered for autoplay and then goes through the normal skip rules.
      if (subcommand === 'dislike') {
        const track = player.queue.current;
        if (!dislikeTrack(interaction.guildId, track)) {
          await interaction.editReply('This track cannot be disliked.');
          return;
        }
        const result = await withGuildMutex(interaction.guildId, () =>
          handleSkipRequest(interaction, player, config, interaction.client),
        );
        if (result.skipped && result.needsAutoplay && result.lastTrack) {
          await handleAutoplay(player, result.lastTrack, interaction.client);
        }
        if (result.skipped) await queuePersist(player);
        await interaction.editReply(
          result.skipped
            ? `\uD83D\uDC4E Disliked and skipped **${track.info.title}**. Autoplay will avoid it.`
            : `\uD83D\uDC4E Disliked **${track.info.title}**. ${result.message}`,
        );
        return;
      }

      if (subcommand === 'next') {
        const result = await rerollNext(player, interaction.client);
        if (!result.ok) {
          await interaction.editReply(REROLL_FAILURES[result.reason] ?? 'Could not reroll.');
          return;
        }
        await interaction.client.musicUI.refresh(player);
        await interaction.editReply(
          result.next
            ? `\uD83C\uDFB2 Up next: **${result.next.title}** by ${result.next.author || 'Unknown'}.`
            : '\uD83C\uDFB2 Picked a different next track.',
        );
        return;
      }

      assertDJ(interaction, config);
      const enabled = toggleAutoplay(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle(enabled ? 'Autoplay Enabled' : 'Autoplay Disabled')
        .setDescription(
          enabled
            ? 'When the queue ends, I\'ll automatically find and play similar tracks based on the last played song.'
            : 'Autoplay has been turned off. Playback will stop when the queue is empty.'
        )
        .setColor(enabled ? '#22c55e' : '#ef4444');

      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Loop mode.')
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('off / track / queue')
          .setRequired(true)
          .addChoices(
            { name: 'Off', value: 'off' },
            { name: 'Track', value: 'track' },
            { name: 'Queue', value: 'queue' },
          ),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      const mode = interaction.options.getString('mode', true);
      await player.setRepeatMode(mode);
      await interaction.client.musicUI.refresh(player);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set volume (0-100) with per-guild limit.')
      .addIntegerOption((option) =>
        option.setName('value').setDescription('Volume in %').setRequired(true),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);

      const requested = interaction.options.getInteger('value', true);
      const clamped = Math.min(config.maxVolume, Math.max(0, requested));
      await player.setVolume(clamped);
      await queuePersist(player);
      await interaction.editReply(`Volume set to ${clamped}% (limit: ${config.maxVolume}%).`);
      await interaction.client.musicUI.refresh(player);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('filter')
      .setDescription('Manage audio filters.')
      .addSubcommand((sub) =>
        sub
          .setName('preset')
          .setDescription('Enable preset.')
          .addStringOption((option) =>
            option
              .setName('name')
              .setDescription('Preset name')
              .setRequired(true)
              .addChoices(
                ...FILTER_PRESET_CHOICES.map(({ label, value }) => ({
                  name: label,
                  value,
                })),
              ),
          ),
      )
      .addSubcommand((sub) => sub.setName('clear').setDescription('Reset filters.'))
      .addSubcommand((sub) => sub.setName('list').setDescription('Show active filters.')),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const activePreset = player.filterManager.activePreset || null;
        const description = FILTER_PRESET_CHOICES.map(({ label, value, description }) => {
          const status = activePreset === value ? 'ON' : 'OFF';
          const details = description ? ` - ${description}` : '';
          return `- [${status}] ${label}${details}`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('Filter presets')
          .setColor(BRAND_COLORS.secondary)
          .setDescription(description);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'clear') {
        await player.filterManager.resetFilters();
        await player.filterManager.clearEQ();
        await player.filterManager.applyPlayerFilters();
        player.filterManager.activePreset = null;
        await interaction.editReply('Filters cleared.');
        return;
      }

      const preset = interaction.options.getString('name', true);
      const handler = FILTER_PRESETS[preset];
      if (!handler) throw new CommandError('Unknown preset.');
      await handler(player.filterManager);
      await player.filterManager.applyPlayerFilters();
      player.filterManager.activePreset = preset;
      await interaction.editReply(`Applied preset **${preset}**.`);
    },
  },
  ];
};

module.exports = { createMusicControlCommands };
