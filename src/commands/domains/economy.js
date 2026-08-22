const createEconomyCommands = (context) => {
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
      .setName('hourly')
      .setDescription('Claim your hourly reward.'),
    async execute(interaction) {
      const result = claimHourly(interaction.user.id);

      if (!result.success) {
        const minutes = Math.floor(result.remaining / 60000);
        const seconds = Math.floor((result.remaining % 60000) / 1000);
        await interaction.reply({
          content: `⏰ You need to wait **${minutes}m ${seconds}s** for your next reward.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('💰 Hourly Reward')
        .setColor('#22c55e')
        .setDescription(`You received **${result.reward}** 🍞!`)
        .addFields({ name: 'New balance', value: `${result.newBalance} 🍞` });

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your balance.')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to check (optional)'),
      ),
    async execute(interaction) {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const balance = getBalance(targetUser.id);

      const embed = new EmbedBuilder()
        .setTitle(`💰 Balance - ${targetUser.username}`)
        .setColor(BRAND_COLORS.primary)
        .setDescription(`**${balance}** 🍞`)
        .setThumbnail(targetUser.displayAvatarURL());

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('See top earners on this server.'),
    async execute(interaction) {
      await interaction.deferReply();

      try {
        let memberIds;
        try {
          const guildMembers = await interaction.guild.members.fetch();
          memberIds = new Set(guildMembers.keys());
        } catch {
          memberIds = new Set(interaction.guild.members.cache.keys());
        }

        const allUsers = getLeaderboard(1000);
        const guildTop = allUsers
          .filter((entry) => memberIds.has(entry.userId))
          .slice(0, 10);

        if (guildTop.length === 0) {
          await interaction.editReply('Nobody on this server has any money yet!');
          return;
        }

        const medals = ['👑', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        const lines = await Promise.all(
          guildTop.map(async (entry, i) => {
            try {
              const user = await interaction.client.users.fetch(entry.userId);
              const medal = medals[i] || `${i + 1}.`;
              const balanceFormatted = entry.balance.toLocaleString();
              const isRequester = entry.userId === interaction.user.id;
              const name = isRequester ? `**${user.username}** ⬅️` : `**${user.username}**`;
              return `${medal} │ ${name} │ \`${balanceFormatted}\` 🍞`;
            } catch {
              const balanceFormatted = entry.balance.toLocaleString();
              return `${medals[i] || `${i + 1}.`} │ Unknown │ \`${balanceFormatted}\` 🍞`;
            }
          }),
        );

        const allGuildUsers = allUsers.filter((entry) => memberIds.has(entry.userId));
        const requesterIndex = allGuildUsers.findIndex((e) => e.userId === interaction.user.id);
        const requesterBalance = getBalance(interaction.user.id);

        let yourPositionText;
        if (requesterIndex === -1 || requesterBalance === 0) {
          yourPositionText = `You're not ranked yet! Use \`/hourly\` to start.`;
        } else if (requesterIndex < 10) {
          yourPositionText = `You're in the **top 10**! 🎉`;
        } else {
          yourPositionText = `#${requesterIndex + 1} │ \`${requesterBalance.toLocaleString()}\` 🍞`;
        }

        // Calculate total bread on server
        const totalBread = guildTop.reduce((sum, e) => sum + e.balance, 0).toLocaleString();

        const embed = new EmbedBuilder()
          .setTitle('🏆 Bread Leaderboard')
          .setColor('#fbbf24')
          .setDescription(`\`\`\`\n${interaction.guild.name}\n\`\`\`\n${lines.join('\n')}`)
          .addFields(
            { name: '📍 Your Position', value: yourPositionText, inline: true },
            { name: '💰 Total Server Bread', value: `\`${totalBread}\` 🍞`, inline: true },
          )
          .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Leaderboard error:', error);
        await interaction.editReply('Failed to load leaderboard.').catch(() => {});
      }
    },
  },
  ];
};

module.exports = { createEconomyCommands };
