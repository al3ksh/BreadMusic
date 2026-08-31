const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getBalance, addBalance, removeBalance, hasBalance, checkGamblingCooldown } = require('./economy');
const { renderArcadeImage, compactNumber } = require('./arcadeRenderer');
const { renderSlotsAnimation, renderRouletteAnimation, renderCoinflipAnimation } = require('./arcadeAnimation');
const {
  COINFLIP_MULTIPLIER,
  COINFLIP_WIN_CHANCE,
  ROULETTE_EVEN_MONEY_MULTIPLIER,
  ROULETTE_GREEN_MULTIPLIER,
  ROULETTE_NUMBER_MULTIPLIER,
  SLOTS_MULTIPLIERS,
  SLOTS_PAIR_MULTIPLIER,
  SLOTS_SYMBOLS,
  roundExpectedPayout,
} = require('./arcadeOdds');

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
    multiplier = SLOTS_PAIR_MULTIPLIER;
    winnings = roundExpectedPayout(bet * multiplier);
    addBalance(userId, winnings);
  }

  return {
    success: true,
    result,
    winnings,
    multiplier,
    newBalance: getBalance(userId),
    isWin: multiplier > 0,
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
    multiplier = ROULETTE_NUMBER_MULTIPLIER;
  } else if (betType === 'red') {
    isWin = ROULETTE_NUMBERS.red.includes(spinResult);
    multiplier = ROULETTE_EVEN_MONEY_MULTIPLIER;
  } else if (betType === 'black') {
    isWin = ROULETTE_NUMBERS.black.includes(spinResult);
    multiplier = ROULETTE_EVEN_MONEY_MULTIPLIER;
  } else if (betType === 'green') {
    isWin = spinResult === 0;
    multiplier = ROULETTE_GREEN_MULTIPLIER;
  } else if (betType === 'odd') {
    isWin = spinResult !== 0 && spinResult % 2 === 1;
    multiplier = ROULETTE_EVEN_MONEY_MULTIPLIER;
  } else if (betType === 'even') {
    isWin = spinResult !== 0 && spinResult % 2 === 0;
    multiplier = ROULETTE_EVEN_MONEY_MULTIPLIER;
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
  const isWin = Math.random() < COINFLIP_WIN_CHANCE;
  const result = isWin ? choice : (choice === 'heads' ? 'tails' : 'heads');

  let winnings = 0;
  if (isWin) {
    winnings = bet * COINFLIP_MULTIPLIER;
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

async function buildRenderedMessage(filename, input, fallbackEmbed, renderer = renderArcadeImage) {
  try {
    const buffer = await renderer(input);
    const attachment = new AttachmentBuilder(buffer, { name: filename });
    const embed = new EmbedBuilder()
      .setColor(input.accent)
      .setImage(`attachment://${filename}`)
      .setFooter({ text: input.detail });
    return { embeds: [embed], files: [attachment] };
  } catch (error) {
    if (error.message !== 'Animation renderer is busy') {
      console.warn(`[Arcade] Could not render ${input.title}: ${error.message}`);
    }
    if (renderer !== renderArcadeImage) {
      return buildRenderedMessage(filename.replace(/\.gif$/i, '.png'), input, fallbackEmbed);
    }
    return { embeds: [fallbackEmbed] };
  }
}

function resultStatus(isWin, winnings, bet) {
  if (bet === 0) {
    return isWin
      ? { status: 'YOU WIN', detail: 'Just for fun', accent: '#61d59b' }
      : { status: 'HOUSE WINS', detail: 'Just for fun', accent: '#ef6877' };
  }
  return isWin
    ? { status: 'YOU WIN', detail: `+${compactNumber(winnings)} BREAD`, accent: '#61d59b' }
    : { status: 'HOUSE WINS', detail: `-${compactNumber(bet)} BREAD`, accent: '#ef6877' };
}

async function buildSlotsMessage(username, result, bet, winnings, isWin, newBalance) {
  const state = resultStatus(isWin, winnings, bet);
  return buildRenderedMessage('slots.gif', {
    type: 'slots',
    title: 'Slots',
    username,
    ...state,
    data: { symbols: result },
    metrics: [
      { label: 'BET', value: bet > 0 ? `${compactNumber(bet)} BREAD` : 'JUST FOR FUN' },
      { label: 'MULTIPLIER', value: isWin && bet > 0 ? `${winnings / bet}x` : (isWin ? 'WIN' : '0x') },
      { label: 'BALANCE', value: `${compactNumber(newBalance)} BREAD` },
    ],
  }, buildSlotsEmbed(result, bet, winnings, isWin, newBalance), renderSlotsAnimation);
}

async function buildRouletteMessage(username, spinResult, color, betType, bet, isWin, winnings, newBalance) {
  const state = resultStatus(isWin, winnings, bet);
  return buildRenderedMessage('roulette.gif', {
    type: 'roulette',
    title: 'Roulette',
    username,
    ...state,
    data: { number: spinResult, color },
    metrics: [
      { label: 'BET', value: bet > 0 ? `${compactNumber(bet)} BREAD` : 'JUST FOR FUN' },
      { label: 'PICK', value: String(betType).toUpperCase() },
      { label: 'BALANCE', value: `${compactNumber(newBalance)} BREAD` },
    ],
  }, buildRouletteEmbed(spinResult, color, betType, bet, isWin, winnings, newBalance), renderRouletteAnimation);
}

async function buildCoinflipMessage(username, result, choice, bet, isWin, winnings, newBalance) {
  const state = resultStatus(isWin, winnings, bet);
  return buildRenderedMessage('coinflip.gif', {
    type: 'coinflip',
    title: 'Coinflip',
    username,
    ...state,
    data: { result },
    metrics: [
      { label: 'BET', value: bet > 0 ? `${compactNumber(bet)} BREAD` : 'JUST FOR FUN' },
      { label: 'RESULT / YOUR PICK', value: `${String(result).toUpperCase()} / ${String(choice).toUpperCase()}` },
      { label: 'BALANCE', value: `${compactNumber(newBalance)} BREAD` },
    ],
  }, buildCoinflipEmbed(result, choice, bet, isWin, winnings, newBalance), renderCoinflipAnimation);
}

module.exports = {
  playSlots,
  playRoulette,
  playCoinflip,
  buildSlotsEmbed,
  buildRouletteEmbed,
  buildCoinflipEmbed,
  buildSlotsMessage,
  buildRouletteMessage,
  buildCoinflipMessage,
};
