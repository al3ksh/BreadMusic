const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { getBalance, addBalance, removeBalance, hasBalance } = require('./economy');

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

function startGame(userId, bet = 0) {
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
  };

  const playerValue = handValue(game.player);
  if (playerValue === 21) {
    game.finished = true;
    game.result = '🎉 Blackjack! You win 2.5x!';
    game.winnings = Math.floor(bet * 2.5);
    addBalance(userId, game.winnings);
  }

  games.set(userId, game);
  scheduleGameCleanup(userId);
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
  } else if (dealerTotal > 21) {
    game.result = '🎉 You win! Dealer busted!';
    game.winnings = game.bet * 2;
  } else if (playerTotal > dealerTotal) {
    game.result = '🎉 You win!';
    game.winnings = game.bet * 2;
  } else if (playerTotal < dealerTotal) {
    game.result = 'Dealer wins!';
    game.winnings = 0;
  } else {
    game.result = 'Push - bet returned!';
    game.winnings = game.bet;
  }

  if (game.winnings > 0) {
    addBalance(userId, game.winnings);
  }

  game.finished = true;
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

function buildComponents(userId, finished = false, canDouble = false) {
  if (finished) return [];
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
  buildComponents,
  BUTTON_PREFIX: 'blackjack',
};
