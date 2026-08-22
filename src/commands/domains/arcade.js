const createArcadeCommands = (context) => {
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
      .setName('slots')
      .setDescription('Spin the slot machine.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet', true);
      const result = playSlots(interaction.user.id, bet);

      if (!result.success) {
        await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildSlotsEmbed(result.result, bet, result.winnings, result.isWin, result.newBalance);
      try {
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        if (!result.isWin) {
          addBalance(interaction.user.id, bet);
        }
        console.error('Failed to send slots result:', error.message);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roulette')
      .setDescription('Spin the roulette wheel.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('Type of bet')
          .setRequired(true)
          .addChoices(
            { name: 'Red (2x)', value: 'red' },
            { name: 'Black (2x)', value: 'black' },
            { name: 'Green/0 (14x)', value: 'green' },
            { name: 'Odd (2x)', value: 'odd' },
            { name: 'Even (2x)', value: 'even' },
          ),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet', true);
      const betType = interaction.options.getString('type', true);

      const result = playRoulette(interaction.user.id, bet, betType);

      if (!result.success) {
        await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildRouletteEmbed(
        result.spinResult,
        result.color,
        betType,
        bet,
        result.isWin,
        result.winnings,
        result.newBalance,
      );
      try {
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        if (!result.isWin) {
          addBalance(interaction.user.id, bet);
        }
        console.error('Failed to send roulette result:', error.message);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('choice')
          .setDescription('Heads or tails')
          .setRequired(true)
          .addChoices(
            { name: 'Heads', value: 'heads' },
            { name: 'Tails', value: 'tails' },
          ),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet', true);
      const choice = interaction.options.getString('choice', true);

      const result = playCoinflip(interaction.user.id, bet, choice);

      if (!result.success) {
        await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildCoinflipEmbed(result.result, choice, bet, result.isWin, result.winnings, result.newBalance);
      try {
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        if (!result.isWin) {
          addBalance(interaction.user.id, bet);
        }
        console.error('Failed to send coinflip result:', error.message);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rps')
      .setDescription('Play rock, paper, scissors (vs bot or challenge a user).')
      .addSubcommand((sub) =>
        sub
          .setName('solo')
          .setDescription('Play against the bot.')
          .addStringOption((option) =>
            option
              .setName('choice')
              .setDescription('Your choice')
              .setRequired(true)
              .addChoices(
                { name: '🪨 Rock', value: 'rock' },
                { name: '📄 Paper', value: 'paper' },
                { name: '✂️ Scissors', value: 'scissors' },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('duel')
          .setDescription('Challenge another user (hidden move).')
          .addUserOption((option) =>
            option
              .setName('opponent')
              .setDescription('User to challenge')
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName('bet')
              .setDescription('Amount to bet (optional)')
              .setMinValue(1),
          ),
      ),
    async execute(interaction) {
      let mode = 'solo';
      try {
        mode = interaction.options.getSubcommand();
      } catch {
        // Fallback for stale Discord clients still sending the previous /rps payload format.
        mode = interaction.options.getUser('opponent') ? 'duel' : 'solo';
      }

      if (mode === 'solo') {
        const choice = interaction.options.getString('choice');
        if (!choice) {
          await interaction.reply({
            content: 'Choose your move in `/rps solo` (rock, paper, or scissors).',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const result = playRPS(choice);
        const embed = buildRPSEmbed(result.playerChoice, result.botChoice, result.result, interaction.user.username);
        await interaction.reply({ embeds: [embed] });
        return;
      }

      const opponent = interaction.options.getUser('opponent');
      if (!opponent) {
        await interaction.reply({
          content: 'Pick an opponent in `/rps duel`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const bet = interaction.options.getInteger('bet') || 0;

      if (opponent.id === interaction.user.id) {
        await interaction.reply({ content: "You can't challenge yourself!", flags: MessageFlags.Ephemeral });
        return;
      }

      if (opponent.bot) {
        await interaction.reply({ content: "You can't challenge a bot! Use `/rps solo` to play against the bot.", flags: MessageFlags.Ephemeral });
        return;
      }

      if (bet > 0) {
        if (!hasBalance(interaction.user.id, bet)) {
          await interaction.reply({
            content: `You don't have enough 🍞! Your balance: ${getBalance(interaction.user.id)} 🍞`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }
        if (!hasBalance(opponent.id, bet)) {
          await interaction.reply({
            content: `**${opponent.username}** doesn't have enough 🍞 for this bet!`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Prepare RPS duel')
        .setColor('#f59e0b')
        .setDescription(`Choose your hidden move against **${opponent.username}**.`)
        .addFields(
          { name: '💰 Bet', value: bet > 0 ? `${bet} 🍞` : 'No bet', inline: true },
          { name: '🔒 Privacy', value: 'Your move is hidden until duel ends.', inline: true },
        );

      const components = buildRPSChoiceComponents(interaction.user.id, opponent.id, bet);
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the magic 8-ball a question.')
      .addStringOption((option) =>
        option.setName('question').setDescription('Your question').setRequired(true),
      ),
    async execute(interaction) {
      const question = interaction.options.getString('question', true);
      const answer = magic8Ball();
      const embed = build8BallEmbed(question, answer);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roll')
      .setDescription('Roll dice.')
      .addStringOption((option) =>
        option.setName('dice').setDescription('Dice notation (e.g., 2d20, default: 1d6)'),
      ),
    async execute(interaction) {
      const notation = interaction.options.getString('dice') || '1d6';
      const result = rollDice(notation);

      if (!result) {
        await interaction.reply({ content: 'Invalid format. Use e.g. `1d6`, `2d20`.', flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildDiceEmbed(result);
      await interaction.reply({ embeds: [embed] });
    },
  },
  ];
};

module.exports = { createArcadeCommands };
