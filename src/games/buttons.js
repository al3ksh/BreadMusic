const { MessageFlags } = require('discord.js');
const {
  startGame: startBlackjack,
  getGame: getBlackjackGame,
  hit: hitBlackjack,
  stand: standBlackjack,
  doubleDown: doubleBlackjack,
  endGame: endBlackjack,
  buildMessage: buildBlackjackMessage,
} = require('./blackjack');
const { hasBalance, addBalance, removeBalance, getBalance } = require('./economy');
const {
  playSlots,
  playRoulette,
  playCoinflip,
  buildSlotsMessage,
  buildRouletteMessage,
  buildCoinflipMessage,
} = require('./gambling');
const {
  buildReplayComponents,
  consumeReplayToken,
  parseReplayCustomId,
  restoreReplayToken,
} = require('./arcadeControls');
const { recordArcadeGame } = require('./arcadeStats');
const {
  RPS_CHOICES,
  createChallenge,
  setMessageInfo,
  buildRPSChallengeMessage,
  buildRPSChallengeComponents,
  getChallenge,
  cancelChallenge,
  setTargetChoice,
  determineWinner,
  cleanupChallenge,
  buildRPSDuelResultMessage,
} = require('./fun');

// Buttons on game messages. Each handler answers the interaction itself.

async function handleBlackjackButton(interaction) {
  const [, action, userId, replayBetString] = interaction.customId.split(':');
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'Only the player can use these controls.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (action === 'replay') {
    if (getBlackjackGame(userId)) {
      await interaction.reply({ content: 'You already have an active game! Finish it first.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    await interaction.deferUpdate();
    const replayBet = Math.max(0, Number(replayBetString) || 0);
    const replayGame = startBlackjack(userId, replayBet, interaction.guildId);
    if (replayGame.error) {
      await interaction.followUp({ content: replayGame.error, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const canDouble = replayGame.player.length === 2 && !replayGame.finished && replayBet > 0 && hasBalance(userId, replayBet);
    const message = await buildBlackjackMessage(interaction.user, replayGame, canDouble);
    if (replayGame.finished) {
      endBlackjack(userId);
    }
    await interaction.editReply({ ...message, attachments: [] }).catch(() => {});
    return;
  }

  const game = getBlackjackGame(userId);
  if (!game) {
    await interaction.reply({ content: 'This blackjack game has ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  await interaction.deferUpdate();

  let updatedGame;
  if (action === 'hit') {
    updatedGame = hitBlackjack(userId);
  } else if (action === 'stand') {
    updatedGame = standBlackjack(userId);
  } else if (action === 'double') {
    const result = doubleBlackjack(userId);
    if (result && result.error) {
      await interaction.followUp({ content: result.error, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    updatedGame = result;
  } else {
    return;
  }

  if (!updatedGame) {
    await interaction.followUp({ content: 'This blackjack game has ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const canDouble = updatedGame.player && updatedGame.player.length === 2 && !updatedGame.finished && updatedGame.bet > 0 && hasBalance(userId, updatedGame.bet);
  const message = await buildBlackjackMessage(interaction.user, updatedGame, canDouble);

  if (updatedGame.finished) {
    endBlackjack(userId);
  }

  await interaction.editReply({ ...message, attachments: [] }).catch(() => {});
}

async function handleArcadeReplayButton(interaction) {
  const replay = parseReplayCustomId(interaction.customId);
  if (!replay) {
    await interaction.reply({ content: 'This replay button is invalid.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (interaction.user.id !== replay.userId) {
    await interaction.reply({ content: 'Only the player can replay this game.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (!consumeReplayToken(replay.token, replay.userId)) {
    await interaction.reply({ content: 'This replay button was already used or expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  let result;
  if (replay.game === 'slots') result = playSlots(replay.userId, replay.bet);
  else if (replay.game === 'roulette') result = playRoulette(replay.userId, replay.bet, replay.option);
  else result = playCoinflip(replay.userId, replay.bet, replay.option);

  if (!result.success) {
    restoreReplayToken(replay.token, replay.userId);
    await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  await interaction.deferUpdate();
  let message;
  if (replay.game === 'slots') {
    message = await buildSlotsMessage(
      interaction.user.username,
      result.result,
      replay.bet,
      result.winnings,
      result.isWin,
      result.newBalance,
    );
  } else if (replay.game === 'roulette') {
    message = await buildRouletteMessage(
      interaction.user.username,
      result.spinResult,
      result.color,
      replay.option,
      replay.bet,
      result.isWin,
      result.winnings,
      result.newBalance,
    );
  } else {
    message = await buildCoinflipMessage(
      interaction.user.username,
      result.result,
      replay.option,
      replay.bet,
      result.isWin,
      result.winnings,
      result.newBalance,
    );
  }

  recordArcadeGame({
    guildId: interaction.guildId,
    userId: replay.userId,
    game: replay.game,
    outcome: result.isWin ? 'win' : 'loss',
    bet: replay.bet,
    payout: result.winnings,
  });
  await interaction.editReply({
    ...message,
    attachments: [],
    components: buildReplayComponents({
      game: replay.game,
      userId: replay.userId,
      bet: replay.bet,
      option: replay.option,
    }),
  });
}

function recordRpsDuel(challenge, outcome, guildId) {
  for (const userId of [challenge.challengerId, challenge.targetId]) {
    const draw = outcome.result === 'draw';
    const won = outcome.winnerId === userId;
    recordArcadeGame({
      guildId,
      userId,
      game: 'rps-duel',
      outcome: draw ? 'draw' : won ? 'win' : 'loss',
      bet: challenge.bet,
      payout: draw ? challenge.bet : won ? challenge.bet * 2 : 0,
    });
  }
}

async function handleRPSButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];

  if (!action) {
    await interaction.reply({ content: 'Invalid RPS action.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  
  if (action === 'choice') {
    if (parts.length < 6) {
      await interaction.update({ content: 'Invalid duel payload.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    const challengerId = parts[2];
    const targetId = parts[3];
    const bet = Math.max(0, parseInt(parts[4], 10) || 0);
    const choice = parts[5];

    if (interaction.user.id !== challengerId) {
      await interaction.reply({ content: 'This hidden choice menu is not for you!', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (!RPS_CHOICES.includes(choice)) {
      await interaction.update({ content: 'Invalid move selected.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (targetId === challengerId) {
      await interaction.update({ content: "You can't challenge yourself!", embeds: [], components: [] }).catch(() => {});
      return;
    }

    const opponent = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!opponent) {
      await interaction.update({ content: 'Could not find that opponent. Try again.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (opponent.bot) {
      await interaction.update({ content: "You can't challenge a bot. Use `/rps solo` instead.", embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (bet > 0) {
      if (!hasBalance(challengerId, bet)) {
        await interaction.update({ content: `You don't have enough 🍞! Your balance: ${getBalance(challengerId)} 🍞`, embeds: [], components: [] }).catch(() => {});
        return;
      }
      if (!hasBalance(targetId, bet)) {
        await interaction.update({ content: `**${opponent.username}** doesn't have enough 🍞 for this bet!`, embeds: [], components: [] }).catch(() => {});
        return;
      }
    }

    if (!interaction.channel || typeof interaction.channel.send !== 'function') {
      await interaction.update({ content: 'Could not send challenge in this channel.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    const challenge = createChallenge(
      challengerId,
      interaction.user.username,
      targetId,
      opponent.username,
      bet,
      choice,
    );

    const components = buildRPSChallengeComponents(challenge);
    const challengeMessage = await buildRPSChallengeMessage(challenge, components);

    try {
      const message = await interaction.channel.send({ content: `<@${targetId}>`, ...challengeMessage });
      setMessageInfo(challenge.id, message.channelId, message.id);
      await interaction.update({
        content: `✅ Challenge sent to <@${targetId}>. Your move is hidden until duel ends.`,
        embeds: [],
        components: [],
      }).catch(() => {});
    } catch {
      cancelChallenge(challenge.id);
      await interaction.update({ content: 'Failed to send challenge message.', embeds: [], components: [] }).catch(() => {});
    }
    return;
  }

  const challengeId = parts[2];
  const parsedMeta = parseChallengeMeta(challengeId);
  const targetId = parsedMeta?.targetId || parts[3];

  if (!targetId) {
    await interaction.reply({ content: 'Invalid RPS interaction payload.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const hasExtendedPayload = action === 'play' ? parts.length >= 6 : parts.length >= 5;
  const encodedChallengerChoice = hasExtendedPayload ? parts[3] : null;
  const encodedBet = hasExtendedPayload ? Math.max(0, parseInt(parts[4], 10) || 0) : 0;
  const choice = action === 'play'
    ? (hasExtendedPayload ? parts[5] : parts[4])
    : null;

  const challenge = getChallenge(challengeId);
  
  if (interaction.user.id !== targetId) {
    await interaction.reply({ content: 'This challenge is not for you!', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  
  if (!challenge || challenge.status !== 'pending') {
    const canFallbackResolve = Boolean(
      parsedMeta &&
      encodedChallengerChoice &&
      RPS_CHOICES.includes(encodedChallengerChoice) &&
      Date.now() - parsedMeta.createdAt <= 60_000,
    );

    if (canFallbackResolve && action === 'decline') {
      await interaction.update({
        content: `❌ **${interaction.user.username}** declined the challenge.`,
        embeds: [],
        components: [],
      }).catch(() => {});
      return;
    }

    if (canFallbackResolve && action === 'play' && choice && RPS_CHOICES.includes(choice)) {
      const fallbackChallenge = {
        id: challengeId,
        challengerId: parsedMeta.challengerId,
        challengerName: 'Challenger',
        targetId: parsedMeta.targetId,
        targetName: interaction.user.username,
        bet: encodedBet,
        challengerChoice: encodedChallengerChoice,
        targetChoice: choice,
      };

      const challengerUser = await interaction.client.users.fetch(parsedMeta.challengerId).catch(() => null);
      if (challengerUser) {
        fallbackChallenge.challengerName = challengerUser.username;
      }

      if (fallbackChallenge.bet > 0) {
        if (!hasBalance(fallbackChallenge.challengerId, fallbackChallenge.bet)) {
          await interaction.update({
            content: `Challenge cancelled - **${fallbackChallenge.challengerName}** no longer has enough 🍞!`,
            embeds: [],
            components: [],
          }).catch(() => {});
          return;
        }

        if (!hasBalance(fallbackChallenge.targetId, fallbackChallenge.bet)) {
          await interaction.update({
            content: `Challenge cancelled - **${fallbackChallenge.targetName}** doesn't have enough 🍞!`,
            embeds: [],
            components: [],
          }).catch(() => {});
          return;
        }

        removeBalance(fallbackChallenge.challengerId, fallbackChallenge.bet);
        removeBalance(fallbackChallenge.targetId, fallbackChallenge.bet);
      }

      const outcome = determineWinner(fallbackChallenge);

      if (fallbackChallenge.bet > 0) {
        if (outcome.result === 'draw') {
          addBalance(fallbackChallenge.challengerId, fallbackChallenge.bet);
          addBalance(fallbackChallenge.targetId, fallbackChallenge.bet);
        } else {
          addBalance(outcome.winnerId, fallbackChallenge.bet * 2);
        }
      }

      const resultMessage = await buildRPSDuelResultMessage(fallbackChallenge, outcome);
      await interaction.update({ ...resultMessage, components: [] }).catch(() => {});
      recordRpsDuel(fallbackChallenge, outcome, interaction.guildId);
      return;
    }

    await interaction.update({ 
      content: 'This challenge has expired or was cancelled.', 
      embeds: [], 
      components: [] 
    }).catch(() => {});
    return;
  }
  
  if (action === 'decline') {
    cleanupChallenge(challengeId);
    await interaction.update({ 
      content: `❌ **${interaction.user.username}** declined the challenge.`, 
      embeds: [], 
      components: [] 
    }).catch(() => {});
    return;
  }
  
  if (action === 'play') {
    if (!choice || !RPS_CHOICES.includes(choice)) {
      await interaction.update({ content: 'Invalid move selected.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (challenge.bet > 0) {
      if (!hasBalance(challenge.challengerId, challenge.bet)) {
        await interaction.update({ 
          content: `Challenge cancelled - **${challenge.challengerName}** no longer has enough 🍞!`, 
          embeds: [], 
          components: [] 
        }).catch(() => {});
        cleanupChallenge(challengeId);
        return;
      }
      if (!hasBalance(challenge.targetId, challenge.bet)) {
        await interaction.update({ 
          content: `Challenge cancelled - **${challenge.targetName}** doesn't have enough 🍞!`, 
          embeds: [], 
          components: [] 
        }).catch(() => {});
        cleanupChallenge(challengeId);
        return;
      }
      
      removeBalance(challenge.challengerId, challenge.bet);
      removeBalance(challenge.targetId, challenge.bet);
    }
    
    const updatedChallenge = setTargetChoice(challengeId, choice);
    
    if (!updatedChallenge) {
      await interaction.update({ content: 'Error saving choice.', embeds: [], components: [] }).catch(() => {});
      return;
    }
    
    const outcome = determineWinner(updatedChallenge);
    
    if (updatedChallenge.bet > 0) {
      if (outcome.result === 'draw') {
        addBalance(updatedChallenge.challengerId, updatedChallenge.bet);
        addBalance(updatedChallenge.targetId, updatedChallenge.bet);
      } else {
        addBalance(outcome.winnerId, updatedChallenge.bet * 2);
      }
    }
    
    const resultMessage = await buildRPSDuelResultMessage(updatedChallenge, outcome);
    
    await interaction.update({ 
      ...resultMessage,
      components: [] 
    }).catch(() => {});
    recordRpsDuel(updatedChallenge, outcome, interaction.guildId);
    
    cleanupChallenge(challengeId);
    return;
  }
}

function parseChallengeMeta(challengeId) {
  if (!challengeId || typeof challengeId !== 'string') return null;
  const match = challengeId.match(/^(\d+)-(\d+)-(\d+)$/);
  if (!match) return null;

  const createdAt = Number(match[3]);
  if (!Number.isFinite(createdAt)) return null;

  return {
    challengerId: match[1],
    targetId: match[2],
    createdAt,
  };
}

module.exports = {
  handleBlackjackButton,
  handleArcadeReplayButton,
  handleRPSButton,
};
