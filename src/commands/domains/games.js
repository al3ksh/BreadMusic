const createBlackjackCommands = (context) => {
  const {
    SlashCommandBuilder,
    MessageFlags,
    startBlackjack,
    endBlackjack,
    buildBlackjackMessage,
    getBlackjackGame,
    getBalance,
    hasBalance,
  } = context;
  return [
  {
    data: new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Play blackjack versus the dealer.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet (optional)').setMinValue(1),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet') || 0;

      if (bet > 0 && !hasBalance(interaction.user.id, bet)) {
        await interaction.reply({ content: `You don't have enough 🍞! Your balance: ${getBalance(interaction.user.id)} 🍞`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (getBlackjackGame(interaction.user.id)) {
        await interaction.reply({ content: 'You already have an active game! Finish it first.', flags: MessageFlags.Ephemeral });
        return;
      }

      const game = startBlackjack(interaction.user.id, bet, interaction.guildId);
      if (game.error) {
        await interaction.reply({ content: game.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const canDouble = game.player.length === 2 && !game.finished && bet > 0 && hasBalance(interaction.user.id, bet);
      const message = await buildBlackjackMessage(interaction.user, game, canDouble);
      await interaction.reply(message);
      if (game.finished) {
        endBlackjack(interaction.user.id);
      }
    },
  },
  ];
};

module.exports = { createBlackjackCommands };
