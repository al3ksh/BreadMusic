const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const suits = ['♠', '♥', '♦', '♣'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BUTTON_PREFIX = 'blackjack';

const games = new Map(); // userId -> game state

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

function startGame(userId) {
  const deck = createDeck();
  const game = {
    deck,
    player: [deck.pop(), deck.pop()],
    dealer: [deck.pop(), deck.pop()],
    finished: false,
    result: null,
  };
  games.set(userId, game);
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
    game.result = 'Player busts. Dealer wins!';
  } else if (dealerTotal > 21) {
    game.result = 'Dealer busts. You win!';
  } else if (playerTotal > dealerTotal) {
    game.result = 'You win!';
  } else if (playerTotal < dealerTotal) {
    game.result = 'Dealer wins!';
  } else {
    game.result = 'Push.';
  }
  game.finished = true;
  return game;
}

function endGame(userId) {
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
    .setTitle('Blackjack')
    .addFields(
      { name: 'Dealer', value: `${data.dealerHand}\nTotal: ${data.dealerValue}`, inline: false },
      {
        name: `${user.username}'s hand`,
        value: `${data.playerHand}\nTotal: ${data.playerValue}`,
        inline: false,
      },
    )
    .setColor(game.finished ? '#22c55e' : '#fbbf24')
    .setFooter({ text: data.finished ? data.result ?? 'Game over.' : 'Hit or Stand?' })
    .setTimestamp();

  return embed;
}

function buildComponents(userId, finished = false) {
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
  return [row];
}

module.exports = {
  startGame,
  getGame,
  hit,
  stand,
  endGame,
  buildEmbed,
  buildComponents,
  BUTTON_PREFIX: 'blackjack',
};
