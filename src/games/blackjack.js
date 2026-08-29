const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const { getBalance, addBalance, removeBalance, hasBalance } = require('./economy');
const { renderBlackjackImage } = require('./blackjackRenderer');
const { recordArcadeGame } = require('./arcadeStats');

const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BUTTON_PREFIX = 'blackjack';
const GAME_TIMEOUT = 10 * 60 * 1000; 

const games = new Map();
const gameTimers = new Map();

function scheduleGameCleanup(userId) {
  clearGameTimer(userId);
  const timer = setTimeout(() => {
    games.delete(userId);
    gameTimers.delete(userId);
  }, GAME_TIMEOUT);
  gameTimers.set(userId, timer);
}

function clearGameTimer(userId) {
  const timer = gameTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    gameTimers.delete(userId);
  }
}

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function formatHand(cards, revealAll) {
  if (!revealAll) {
    return `${formatCard(cards[0])} ??`;
  }
  return cards.map(formatCard).join(' ');
}

function recordFinishedGame(userId, game) {
  if (!game.finished || game.statsRecorded) return;
  game.statsRecorded = true;
  recordArcadeGame({
    guildId: game.guildId,
    userId,
    game: 'blackjack',
    outcome: game.outcome,
    bet: game.bet,
    payout: game.winnings,
  });
}

function startGame(userId, bet = 0, guildId = null) {
  if (bet > 0) {
    if (!hasBalance(userId, bet)) {
      return { error: "You don't have enough 🍞!" };
    }
    removeBalance(userId, bet);
  }

  const deck = createDeck();
  const game = {
    deck,
    player: [deck.pop(), deck.pop()],
    dealer: [deck.pop(), deck.pop()],
    finished: false,
    result: null,
    bet,
    winnings: 0,
    guildId,
    outcome: null,
    statsRecorded: false,
  };

  const playerValue = handValue(game.player);
  const dealerValue = handValue(game.dealer);
  
  if (playerValue === 21) {
    game.finished = true;
    if (dealerValue === 21) {
      game.result = '🤝 Push! Both have Blackjack - bet returned!';
      game.winnings = bet;
      game.outcome = 'draw';
    } else {
      game.result = '🎉 Blackjack! You win 2.5x!';
      game.winnings = Math.floor(bet * 2.5);
      game.outcome = 'win';
    }
    addBalance(userId, game.winnings);
  }

  games.set(userId, game);
  scheduleGameCleanup(userId);
  recordFinishedGame(userId, game);
  return game;
}

function getGame(userId) {
  return games.get(userId);
}

function hit(userId) {
  const game = getGame(userId);
  if (!game || game.finished) return null;
  game.player.push(game.deck.pop());
  const total = handValue(game.player);
  if (total >= 21) {
    return stand(userId, { autoStand: true });
  }
  return game;
}

function stand(userId, options = {}) {
  const game = getGame(userId);
  if (!game || game.finished) return null;
  while (handValue(game.dealer) < 17) {
    game.dealer.push(game.deck.pop());
  }
  const playerTotal = handValue(game.player);
  const dealerTotal = handValue(game.dealer);

  if (playerTotal > 21) {
    game.result = 'You busted - over 21!';
    game.winnings = 0;
    game.outcome = 'loss';
  } else if (dealerTotal > 21) {
    game.result = '🎉 You win! Dealer busted!';
    game.winnings = game.bet * 2;
    game.outcome = 'win';
  } else if (playerTotal > dealerTotal) {
    game.result = '🎉 You win!';
    game.winnings = game.bet * 2;
    game.outcome = 'win';
  } else if (playerTotal < dealerTotal) {
    game.result = 'Dealer wins!';
    game.winnings = 0;
    game.outcome = 'loss';
  } else {
    game.result = 'Push - bet returned!';
    game.winnings = game.bet;
    game.outcome = 'draw';
  }

  if (game.winnings > 0) {
    addBalance(userId, game.winnings);
  }

  game.finished = true;
  recordFinishedGame(userId, game);
  return game;
}

function endGame(userId) {
  clearGameTimer(userId);
  games.delete(userId);
}

function buildEmbedData(game) {
  const revealDealer = game.finished;
  const dealerHand = formatHand(game.dealer, revealDealer);
  const playerHand = game.player.map(formatCard).join(' ');
  const dealerValue = revealDealer ? handValue(game.dealer) : '?';
  const playerValue = handValue(game.player);
  return {
    dealerHand,
    playerHand,
    dealerValue,
    playerValue,
    result: game.result,
    finished: game.finished,
  };
}

function buildEmbed(user, game) {
  const data = buildEmbedData(game);
  const embed = new EmbedBuilder()
    .setTitle('🃏 Blackjack')
    .addFields(
      { name: 'Dealer', value: `${data.dealerHand}\nValue: ${data.dealerValue}`, inline: false },
      {
        name: `${user.username}`,
        value: `${data.playerHand}\nValue: ${data.playerValue}`,
        inline: false,
      },
    )
    .setColor(game.finished ? (game.winnings > 0 ? '#22c55e' : '#ef4444') : '#fbbf24');

  if (game.bet > 0) {
    embed.addFields({ name: 'Bet', value: `${game.bet} 🍞`, inline: true });
    if (game.finished) {
      const balanceNow = getBalance(user.id);
      embed.addFields(
        { name: game.winnings > 0 ? 'Won' : 'Lost', value: `${game.winnings > 0 ? '+' + game.winnings : '-' + game.bet} 🍞`, inline: true },
        { name: 'Balance', value: `${balanceNow} 🍞`, inline: true },
      );
    }
  }

  embed.setFooter({ text: data.finished ? data.result ?? 'Game over.' : 'Hit, Stand or Double?' });
  embed.setTimestamp();

  return embed;
}

async function buildMessage(user, game, canDouble = false) {
  const fallbackEmbed = buildEmbed(user, game);
  const filename = `blackjack-${user.id}.png`;

  try {
    const image = await renderBlackjackImage({
      username: user.globalName || user.displayName || user.username,
      game,
      balance: getBalance(user.id),
      dealerValue: handValue(game.dealer),
      playerValue: handValue(game.player),
    });
    const embed = new EmbedBuilder()
      .setColor(game.finished ? (game.winnings > 0 ? '#22c55e' : '#ef4444') : '#8f82eb')
      .setImage(`attachment://${filename}`)
      .setFooter({ text: game.finished ? game.result ?? 'Game over.' : 'Choose your move below.' });

    return {
      embeds: [embed],
      files: [new AttachmentBuilder(image, { name: filename })],
      components: buildComponents(user.id, game.finished, canDouble, game.bet),
    };
  } catch (error) {
    console.warn(`[Blackjack] Could not render game board: ${error.message}`);
    return {
      embeds: [fallbackEmbed],
      files: [],
      components: buildComponents(user.id, game.finished, canDouble, game.bet),
    };
  }
}

function buildComponents(userId, finished = false, canDouble = false, bet = 0) {
  if (finished) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX}:replay:${userId}:${Math.max(0, Number(bet) || 0)}`)
          .setLabel('Play again')
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}:hit:${userId}`)
      .setLabel('Hit')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}:stand:${userId}`)
      .setLabel('Stand')
      .setStyle(ButtonStyle.Secondary),
  );

  if (canDouble) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${BUTTON_PREFIX}:double:${userId}`)
        .setLabel('Double')
        .setStyle(ButtonStyle.Success),
    );
  }

  return [row];
}

function doubleDown(userId) {
  const game = getGame(userId);
  if (!game || game.finished) return null;
  if (game.player.length !== 2) return null;
  if (game.bet === 0) {
    return { error: "You can't double down without a bet!" };
  }

  if (!hasBalance(userId, game.bet)) {
    return { error: "You don't have enough 🍞 to double!" };
  }

  removeBalance(userId, game.bet);
  game.bet *= 2;
  game.player.push(game.deck.pop());

  return stand(userId, { autoStand: true });
}

module.exports = {
  startGame,
  getGame,
  hit,
  stand,
  doubleDown,
  endGame,
  buildEmbed,
  buildMessage,
  buildComponents,
  BUTTON_PREFIX: 'blackjack',
};
