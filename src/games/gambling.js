const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getBalance, addBalance, removeBalance, hasBalance, checkGamblingCooldown } = require('./economy');

const SLOTS_SYMBOLS = ['🍞', '🍒', '🔔', '💎', '7️⃣'];
const SLOTS_MULTIPLIERS = {
  '🍞🍞🍞': 2,
  '🍒🍒🍒': 3,
  '🔔🔔🔔': 5,
  '💎💎💎': 10,
  '7️⃣7️⃣7️⃣': 25,
};

const ROULETTE_NUMBERS = {
  red: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
  black: [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35],
  green: [0],
};

function spinSlots() {
  return [
    SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
    SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
    SLOTS_SYMBOLS[Math.floor(Math.random() * SLOTS_SYMBOLS.length)],
  ];
}

function playSlots(userId, bet) {
  const cooldown = checkGamblingCooldown(userId);
  if (cooldown.onCooldown) {
    return { success: false, error: `⏳ Wait ${(cooldown.remaining / 1000).toFixed(1)}s before playing again!` };
  }

  if (!hasBalance(userId, bet)) {
    return { success: false, error: 'You don\'t have enough 🍞!' };
  }

  removeBalance(userId, bet);
  const result = spinSlots();
  const resultKey = result.join('');

  let winnings = 0;
  let multiplier = 0;

  if (SLOTS_MULTIPLIERS[resultKey]) {
    multiplier = SLOTS_MULTIPLIERS[resultKey];
    winnings = bet * multiplier;
    addBalance(userId, winnings);
  } else if (result[0] === result[1] || result[1] === result[2] || result[0] === result[2]) {
    multiplier = 1.5;
    winnings = Math.floor(bet * multiplier);
    addBalance(userId, winnings);
  }

  return {
    success: true,
    result,
    winnings,
    multiplier,
    newBalance: getBalance(userId),
    isWin: winnings > 0,
  };
}

function playRoulette(userId, bet, betType, number = null) {
  const cooldown = checkGamblingCooldown(userId);
  if (cooldown.onCooldown) {
    return { success: false, error: `⏳ Wait ${(cooldown.remaining / 1000).toFixed(1)}s before playing again!` };
  }

  if (!hasBalance(userId, bet)) {
    return { success: false, error: 'You don\'t have enough 🍞!' };
  }

  removeBalance(userId, bet);
  const spinResult = Math.floor(Math.random() * 37);

  let isWin = false;
  let multiplier = 0;

  if (betType === 'number' && number !== null) {
    isWin = spinResult === number;
    multiplier = 35;
  } else if (betType === 'red') {
    isWin = ROULETTE_NUMBERS.red.includes(spinResult);
    multiplier = 2;
  } else if (betType === 'black') {
    isWin = ROULETTE_NUMBERS.black.includes(spinResult);
    multiplier = 2;
  } else if (betType === 'green') {
    isWin = spinResult === 0;
    multiplier = 14;
  } else if (betType === 'odd') {
    isWin = spinResult !== 0 && spinResult % 2 === 1;
    multiplier = 2;
  } else if (betType === 'even') {
    isWin = spinResult !== 0 && spinResult % 2 === 0;
    multiplier = 2;
  }

  let winnings = 0;
  if (isWin) {
    winnings = bet * multiplier;
    addBalance(userId, winnings);
  }

  const color = ROULETTE_NUMBERS.red.includes(spinResult)
    ? 'red'
    : spinResult === 0
      ? 'green'
      : 'black';

  return {
    success: true,
    spinResult,
    color,
    isWin,
    winnings,
    multiplier,
    newBalance: getBalance(userId),
  };
}

function playCoinflip(userId, bet, choice) {
  const cooldown = checkGamblingCooldown(userId);
  if (cooldown.onCooldown) {
    return { success: false, error: `⏳ Wait ${(cooldown.remaining / 1000).toFixed(1)}s before playing again!` };
  }

  if (!hasBalance(userId, bet)) {
    return { success: false, error: 'You don\'t have enough 🍞!' };
  }

  removeBalance(userId, bet);
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const isWin = result === choice;

  let winnings = 0;
  if (isWin) {
    winnings = bet * 2;
    addBalance(userId, winnings);
  }

  return {
    success: true,
    result,
    isWin,
    winnings,
    newBalance: getBalance(userId),
  };
}

function buildSlotsEmbed(result, bet, winnings, isWin, newBalance) {
  const embed = new EmbedBuilder()
    .setTitle('🎰 Slots')
    .setDescription(`\n## ${result.join(' ')}\n`)
    .setColor(isWin ? '#22c55e' : '#ef4444');

  if (isWin) {
    embed.addFields({ name: 'You won!', value: `+${winnings} 🍞`, inline: true });
  } else {
    embed.addFields({ name: 'You lost', value: `-${bet} 🍞`, inline: true });
  }

  embed.addFields({ name: 'Balance', value: `${newBalance} 🍞`, inline: true });
  return embed;
}

function buildRouletteEmbed(spinResult, color, betType, bet, isWin, winnings, newBalance) {
  const colorEmoji = color === 'red' ? '🔴' : color === 'green' ? '🟢' : '⚫';

  const embed = new EmbedBuilder()
    .setTitle('🎡 Roulette')
    .setDescription(`Result: ${colorEmoji} **${spinResult}**`)
    .setColor(isWin ? '#22c55e' : '#ef4444')
    .addFields(
      { name: 'Your bet', value: betType, inline: true },
      { name: isWin ? 'You won!' : 'You lost', value: `${isWin ? '+' : '-'}${isWin ? winnings : bet} 🍞`, inline: true },
      { name: 'Balance', value: `${newBalance} 🍞`, inline: true },
    );

  return embed;
}

function buildCoinflipEmbed(result, choice, bet, isWin, winnings, newBalance) {
  const emoji = result === 'heads' ? '🪙' : '🔵';

  const embed = new EmbedBuilder()
    .setTitle('🪙 Coinflip')
    .setDescription(`${emoji} Result: **${result === 'heads' ? 'Heads' : 'Tails'}**\nYour choice: **${choice === 'heads' ? 'Heads' : 'Tails'}**`)
    .setColor(isWin ? '#22c55e' : '#ef4444')
    .addFields(
      { name: isWin ? 'You won!' : 'You lost', value: `${isWin ? '+' : '-'}${isWin ? winnings : bet} 🍞`, inline: true },
      { name: 'Balance', value: `${newBalance} 🍞`, inline: true },
    );

  return embed;
}

module.exports = {
  playSlots,
  playRoulette,
  playCoinflip,
  buildSlotsEmbed,
  buildRouletteEmbed,
  buildCoinflipEmbed,
};
