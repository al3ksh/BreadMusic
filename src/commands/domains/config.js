const createConfigCommands = (context) => {
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
      .setName('config')
      .setDescription('Manage guild settings (or use dashboard).')
      .addSubcommand((sub) =>
        sub.setName('get').setDescription('Show current configuration (dashboard available).'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('set')
          .setDescription('Set selected options (dashboard available).')
          .addRoleOption((option) => option.setName('dj_role').setDescription('Rola DJ (tylko muzyka, np. Activity).'))
          .addRoleOption((option) => option.setName('mod_role').setDescription('Rola moderatora dashboardu.'))
          .addIntegerOption((option) =>
            option
              .setName('max_volume')
              .setDescription('Maximum volume (10-500).')
              .setMinValue(10)
              .setMaxValue(500),
          )
          .addNumberOption((option) =>
            option
              .setName('voteskip_percent')
              .setDescription('Vote skip threshold as a percentage (10-100).')
              .setMinValue(10)
              .setMaxValue(100),
          )
          .addBooleanOption((option) =>
            option.setName('stay_24_7').setDescription('Stay in channel?'),
          )
          .addChannelOption((option) =>
            option.setName('voice_channel').setDescription('24/7 voice channel').setRequired(false),
          )
          .addIntegerOption((option) =>
            option.setName('afk_timeout').setDescription('AFK timeout in minutes.'),
          )
          .addBooleanOption((option) =>
            option.setName('persistent_queue').setDescription('Persist queue?'),
          )
          .addBooleanOption((option) =>
            option.setName('voice_status').setDescription('Show the current track as voice channel status?'),
          )
          .addStringOption((option) =>
            option
              .setName('dashboard_access')
              .setDescription('Who can open the server dashboard?')
              .addChoices(
                { name: 'Administrators only', value: 'admin' },
                { name: 'Administrators and moderators', value: 'mod' },
                { name: 'All server members', value: 'members' },
              ),
          )
          .addStringOption((option) =>
            option
              .setName('preferred_source')
              .setDescription('Preferred provider')
              .addChoices(
                { name: 'YouTube', value: 'ytsearch' },
                { name: 'SoundCloud', value: 'scsearch' },
                { name: 'Spotify', value: 'spsearch' },
              ),
          )
          .addStringOption((option) =>
            option
              .setName('autoplay_mode')
              .setDescription('Autoplay recommendation engine (when autoplay is on)')
              .addChoices(
                { name: 'Classic - local recommendations, no AI', value: 'classic' },
                { name: 'AI assisted - current hybrid behavior', value: 'ai_assisted' },
                { name: 'Discovery - AI genre radio with fresh tracks', value: 'discovery' },
              ),
          )
          .addStringOption((option) =>
            option
              .setName('activity_control')
              .setDescription('Who can control playback inside the Activity (must be in the bot voice channel)')
              .addChoices(
                { name: 'Inherit - follow dashboard access', value: 'inherit' },
                { name: 'Administrators only', value: 'admin' },
                { name: 'Admins and moderators', value: 'mod' },
                { name: 'Admins, moderators and DJs', value: 'dj' },
                { name: 'All members', value: 'members' },
              ),
          ),
      )
      .addSubcommand((sub) => sub.setName('reset').setDescription('Restore default settings (dashboard available).'))
      .setDMPermission(false),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const sub = interaction.options.getSubcommand();
      if (sub === 'get') {
        const config = getConfig(interaction.guildId);
        const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
        const embed = new EmbedBuilder()
          .setTitle('Current configuration')
          .setColor(BRAND_COLORS.secondary)
          .setDescription(`Dashboard: ${dashboardUrl}\n\`\`\`\n${formatConfig(config)}\n\`\`\``);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new CommandError('Manage Guild permission is required.');
      }

      if (sub === 'reset') {
        deleteConfig(interaction.guildId);
        const fresh = getConfig(interaction.guildId);
        const player = interaction.client.lavalink?.getPlayer(interaction.guildId);
        if (player && Number.isFinite(player.volume) && player.volume > fresh.maxVolume) {
          await player.setVolume(fresh.maxVolume);
          await queuePersist(player);
          await interaction.client.musicUI?.refresh(player).catch(() => {});
        }
        if (fresh.voiceChannelStatus && player?.queue.current) {
          await setVoiceTrackStatus(interaction.client, player, player.queue.current);
        }
        const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
        const embed = new EmbedBuilder()
          .setTitle('Configuration reset')
          .setColor(BRAND_COLORS.secondary)
          .setDescription(`Dashboard: ${dashboardUrl}\n\`\`\`\n${formatConfig(fresh)}\n\`\`\``);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const updates = {};
      const djRole = interaction.options.getRole('dj_role');
      if (djRole) updates.djRoleId = djRole.id;
      const modRole = interaction.options.getRole('mod_role');
      if (modRole) updates.modRoleId = modRole.id;
      const maxVolume = interaction.options.getInteger('max_volume');
      if (maxVolume !== null) updates.maxVolume = Math.max(10, Math.min(500, maxVolume));
      const voteSkip = interaction.options.getNumber('voteskip_percent');
      if (voteSkip !== null) updates.voteSkipPercent = Math.min(Math.max(voteSkip / 100, 0.1), 1);
      const stay = interaction.options.getBoolean('stay_24_7');
      if (stay !== null) updates.stayInChannel = stay;
      const voiceChannel = interaction.options.getChannel('voice_channel');
      if (voiceChannel) updates.twentyFourSevenChannelId = voiceChannel.id;
      const afk = interaction.options.getInteger('afk_timeout');
      if (afk !== null) updates.afkTimeout = Math.max(1, afk) * 60 * 1000;
      const persistent = interaction.options.getBoolean('persistent_queue');
      if (persistent !== null) updates.persistentQueue = persistent;
      const voiceStatus = interaction.options.getBoolean('voice_status');
      if (voiceStatus !== null) updates.voiceChannelStatus = voiceStatus;
      const dashboardAccess = interaction.options.getString('dashboard_access');
      if (dashboardAccess) updates.dashboardAccess = dashboardAccess;
      const prefSource = interaction.options.getString('preferred_source');
      if (prefSource) updates.preferredSource = prefSource;
      const autoplayMode = interaction.options.getString('autoplay_mode');
      if (autoplayMode) updates.autoplayMode = autoplayMode;
      const activityControl = interaction.options.getString('activity_control');
      if (activityControl) updates.activityControl = activityControl;

      const updated = setConfig(interaction.guildId, updates);
      const player = interaction.client.lavalink?.getPlayer(interaction.guildId);
      if (player && Number.isFinite(player.volume) && player.volume > updated.maxVolume) {
        await player.setVolume(updated.maxVolume);
        await queuePersist(player);
        await interaction.client.musicUI?.refresh(player).catch(() => {});
      }
      if (voiceStatus === false && player) {
        await clearVoiceTrackStatus(interaction.client, player);
      } else if (voiceStatus === true && player?.queue.current) {
        await setVoiceTrackStatus(interaction.client, player, player.queue.current);
      }
      const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
      const embed = new EmbedBuilder()
        .setTitle('Configuration updated')
        .setColor(BRAND_COLORS.primary)
        .setDescription(`Dashboard: ${dashboardUrl}\n\`\`\`\n${formatConfig(updated)}\n\`\`\``);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  ];
};

module.exports = { createConfigCommands };
