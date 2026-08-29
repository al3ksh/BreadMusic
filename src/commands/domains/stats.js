const createStatsCommands = (context) => {
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
    getArcadeStats,
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
      .setName('stats')
      .setDescription('Show Bread listening statistics.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('user')
          .setDescription('Show requests and favorite tracks for a member.')
          .addUserOption((option) => option.setName('member').setDescription('Member (defaults to you)'))
          .addStringOption((option) =>
            option
              .setName('range')
              .setDescription('Time range')
              .addChoices(
                { name: 'Last 24 hours', value: '24h' },
                { name: 'Last 7 days', value: '7d' },
                { name: 'All time', value: 'all' },
              ),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('server')
          .setDescription('Show listening statistics for this server.')
          .addStringOption((option) =>
            option
              .setName('range')
              .setDescription('Time range')
              .addChoices(
                { name: 'Last 24 hours', value: '24h' },
                { name: 'Last 7 days', value: '7d' },
                { name: 'All time', value: 'all' },
              ),
          )
          .addBooleanOption((option) =>
            option
              .setName('detailed')
              .setDescription('Include sources, activity patterns and top requesters'),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('arcade')
          .setDescription('Show Arcade statistics for a member.')
          .addUserOption((option) => option.setName('member').setDescription('Member (defaults to you)')),
      ),
    async execute(interaction) {
      await interaction.deferReply();
      const subcommand = interaction.options.getSubcommand();
      const range = interaction.options.getString('range') || 'all';
      const rangeLabel = range === '24h' ? 'Last 24 hours' : range === '7d' ? 'Last 7 days' : 'All time';

      if (subcommand === 'arcade') {
        const user = interaction.options.getUser('member') || interaction.user;
        const stats = getArcadeStats(user.id, interaction.guildId);
        const favorite = Object.entries(stats.byGame)
          .sort((left, right) => right[1].games - left[1].games)[0];
        const winRate = stats.games > 0 ? ((stats.wins / stats.games) * 100).toFixed(1) : '0.0';
        const gameLines = Object.entries(stats.byGame)
          .sort((left, right) => right[1].games - left[1].games)
          .map(([name, value]) => `**${name}**: ${value.games} games, ${value.wins} wins`)
          .join('\n') || 'No Arcade games recorded yet.';
        const embed = new EmbedBuilder()
          .setTitle(`${user.globalName || user.username}'s Arcade Stats`)
          .setThumbnail(user.displayAvatarURL({ size: 128 }))
          .setColor(BRAND_COLORS.primary)
          .addFields(
            { name: 'Record', value: `**${stats.games}** games - **${stats.wins}W / ${stats.losses}L / ${stats.draws}D**` },
            { name: 'Performance', value: `**${winRate}%** win rate\nFavorite: **${favorite?.[0] || 'none'}**`, inline: true },
            { name: 'Economy', value: `Wagered: **${stats.totalWagered} BREAD**\nBiggest payout: **${stats.biggestPayout} BREAD**`, inline: true },
            { name: 'Games', value: gameLines.slice(0, 1024) },
          )
          .setFooter({ text: `Arcade statistics for ${interaction.guild.name}` });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (subcommand === 'server') {
        const detailed = interaction.options.getBoolean('detailed') || false;
        const insights = getGuildInsights(interaction.guildId, { range, limit: 5 });
        const tracks = formatRankedTracks(insights.topTracks, 'No plays recorded in this period.');
        const users = formatRankedRequesters(insights.topUsers, 'No requesters recorded in this period.');
        const details = insights.details;
        const activityHour = details.mostActiveHour === null
          ? 'No retained activity'
          : `${String(details.mostActiveHour).padStart(2, '0')}:00-${String((details.mostActiveHour + 1) % 24).padStart(2, '0')}:00 UTC`;
        const embed = new EmbedBuilder()
          .setTitle('\u{1F4CA} Playback Stats')
          .setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL({ size: 128 }) || undefined })
          .setDescription(`\u{1F4C5} ${rangeLabel}${detailed ? '  \u2022  detailed' : ''}`)
          .setColor(BRAND_COLORS.primary)
          .addFields(
            {
              name: '\u{1F3B6} Listening',
              value: `**${insights.summary.totalPlays}** plays  \u2022  **${formatStatsDuration(details.estimatedDuration)}** listened  \u2022  **${insights.summary.uniqueTracks}** tracks`,
              inline: true,
            },
            {
              name: '\u{1F465} Community',
              value: `**${insights.summary.uniqueUsers}** requesters  \u2022  **${details.autoplayPlays}** autoplay  \u2022  **${details.averagePerActiveDay.toFixed(1)}**/active day`,
              inline: true,
            },
            { name: '\u{1F3A7} Top Tracks', value: tracks.slice(0, 1024) },
          );
        if (detailed) {
          embed.addFields(
            { name: '\u{1F30D} Sources', value: formatRankedSources(details.topSources, 'No source data recorded.') },
            { name: '\u{23F1} Activity', value: `Peak **${activityHour}** \u2022 **${details.activeDays}** days \u2022 streak **${details.longestStreakDays}d**` },
            { name: '\u{1F465} Top Requesters', value: users },
          );
        }
        if (details.historyScoped) {
          embed.setFooter({ text: `Activity hour, streak and autoplay use the last ${insights.detailedHistoryDays} days; totals, tracks and sources are all-time.` });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const user = interaction.options.getUser('member') || interaction.user;
      const insights = getUserInsights(interaction.guildId, user.id, { range, limit: 5 });
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const tracks = formatRankedTracks(insights.topTracks, 'No requests recorded in the retained detailed history.');
      const embed = new EmbedBuilder()
        .setTitle(`\u{1F3B5} ${user.globalName || user.username}'s Music Wrapped`)
        .setDescription(`\u{1F4C5} ${rangeLabel}`)
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setColor(BRAND_COLORS.primary)
        .addFields(
          {
            name: '\u{1F3B6} Listening',
            value: `**${insights.totalRequests}** requests  \u2022  **${formatStatsDuration(insights.details.estimatedDuration)}** listened`,
            inline: true,
          },
          {
            name: '\u{1F4C8} Rhythm',
            value: `**${insights.details.averagePerActiveDay.toFixed(1)}**/day \u2022 **${insights.details.activeDays}** days \u2022 streak **${insights.details.longestStreakDays}d**`,
            inline: true,
          },
          { name: '\u{1F3A7} Top Tracks', value: tracks.slice(0, 1024) },
          { name: '\u{1F3A4} Top Artists', value: formatCompactRankedCounts(insights.details.topArtists, 'No artist data recorded.') },
        );
      if (member?.joinedTimestamp || insights.lastRequestAt) {
        const footerParts = [];
        if (member?.joinedTimestamp) footerParts.push(`Member since ${new Date(member.joinedTimestamp).toISOString().slice(0, 10)}`);
        if (insights.lastRequestAt) footerParts.push(`Last request ${new Date(insights.lastRequestAt).toISOString().slice(0, 10)}`);
        embed.setFooter({ text: footerParts.join(' - ') });
      }
      if (range === 'all') {
        const existingFooter = embed.data.footer?.text ? `${embed.data.footer.text} - ` : '';
        embed.setFooter({ text: `${existingFooter}duration, rankings and patterns use the last ${insights.detailedHistoryDays} days.` });
      }
      await interaction.editReply({ embeds: [embed] });
    },
  },
  ];
};

module.exports = { createStatsCommands };
