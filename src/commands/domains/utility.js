const createUtilityCommands = (context) => {
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
    data: new SlashCommandBuilder().setName('help').setDescription('Command list and quick tips.'),
    async execute(interaction) {
      const pageIndex = 0;
      const botAvatar = interaction.client.user?.displayAvatarURL({ size: 1024 }) ?? null;
      const dashboardUrl = interaction.guildId
        ? buildDashboardUrl(interaction.guildId, 'player')
        : `${String(process.env.WEB_URL || 'https://breadmusic.aleksh.xyz').replace(/\/$/, '')}/dashboard`;
      const embed = buildHelpEmbed(pageIndex, { botAvatar });
      const components = buildHelpComponents(pageIndex, interaction.user.id, dashboardUrl);
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('dashboard')
      .setDescription('Open dashboard for this server.')
      .setDMPermission(false),
    async execute(interaction) {
      const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
      const botAvatar = interaction.client.user?.displayAvatarURL({ size: 128 }) ?? null;
      const embed = new EmbedBuilder()
        .setTitle('Bread Dashboard')
        .setColor(BRAND_COLORS.primary)
        .setDescription('Manage playback, queue, lyrics, history, uploads, economy, and server settings from the web dashboard.')
        .setFooter({ text: 'Dashboard link for this server.' });

      if (botAvatar) {
        embed.setThumbnail(botAvatar);
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('Open Web Dashboard')
          .setURL(dashboardUrl),
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    },
  },
  ];
};

module.exports = { createUtilityCommands };
