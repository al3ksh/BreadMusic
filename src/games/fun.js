const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { BRAND_COLORS } = require('../theme');
const { renderArcadeImage } = require('./arcadeRenderer');
const { renderDiceAnimation } = require('./arcadeAnimation');

const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_EMOJIS = { rock: '🪨', paper: '📄', scissors: '✂️' };
const RPS_WINS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_BUTTON_PREFIX = 'rps';
const RPS_CHALLENGE_TIMEOUT = 60_000; 

const rpsChallenges = new Map();
const challengeTimers = new Map();

let onChallengeExpire = null;

function setExpireCallback(callback) {
  onChallengeExpire = callback;
}

function createChallenge(challengerId, challengerName, targetId, targetName, bet, challengerChoice) {
  const challengeId = `${challengerId}-${targetId}-${Date.now()}`;
  
  const challenge = {
    id: challengeId,
    challengerId,
    challengerName,
    targetId,
    targetName,
    bet,
    challengerChoice, 
    targetChoice: null,
    status: 'pending', 
    createdAt: Date.now(),
    channelId: null, 
    messageId: null, 
  };
  
  rpsChallenges.set(challengeId, challenge);
  
  const timer = setTimeout(() => {
    const ch = rpsChallenges.get(challengeId);
    if (ch && ch.status === 'pending') {
      ch.status = 'expired';
      if (onChallengeExpire) {
        onChallengeExpire(ch);
      }
      rpsChallenges.delete(challengeId);
    }
    challengeTimers.delete(challengeId);
  }, RPS_CHALLENGE_TIMEOUT);
  
  challengeTimers.set(challengeId, timer);
  
  return challenge;
}

function setMessageInfo(challengeId, channelId, messageId) {
  const challenge = rpsChallenges.get(challengeId);
  if (challenge) {
    challenge.channelId = channelId;
    challenge.messageId = messageId;
  }
}

function getChallenge(challengeId) {
  return rpsChallenges.get(challengeId);
}

function cancelChallenge(challengeId) {
  const timer = challengeTimers.get(challengeId);
  if (timer) {
    clearTimeout(timer);
    challengeTimers.delete(challengeId);
  }
  rpsChallenges.delete(challengeId);
}

function setTargetChoice(challengeId, choice) {
  const challenge = rpsChallenges.get(challengeId);
  if (!challenge || challenge.status !== 'pending') return null;
  
  challenge.targetChoice = choice;
  challenge.status = 'finished';
  
  return challenge;
}

function determineWinner(challenge) {
  const { challengerChoice, targetChoice, challengerId, targetId } = challenge;
  
  if (challengerChoice === targetChoice) {
    return { result: 'draw', winnerId: null, loserId: null };
  }
  
  if (RPS_WINS[challengerChoice] === targetChoice) {
    return { result: 'challenger_wins', winnerId: challengerId, loserId: targetId };
  }
  
  return { result: 'target_wins', winnerId: targetId, loserId: challengerId };
}

function cleanupChallenge(challengeId) {
  const timer = challengeTimers.get(challengeId);
  if (timer) {
    clearTimeout(timer);
    challengeTimers.delete(challengeId);
  }
  rpsChallenges.delete(challengeId);
}

const MAGIC_8BALL_RESPONSES = [
  'Yes.',
  'Definitely yes.',
  'Without a doubt.',
  'For sure.',
  'You can count on it.',
  'Most likely.',
  'Looks good.',
  'Yes, in my opinion.',
  'Signs point to yes.',
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  'Don\'t count on it.',
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.',
];

function playRPS(playerChoice) {
  const botChoice = RPS_CHOICES[Math.floor(Math.random() * RPS_CHOICES.length)];

  let result;
  if (playerChoice === botChoice) {
    result = 'draw';
  } else if (RPS_WINS[playerChoice] === botChoice) {
    result = 'win';
  } else {
    result = 'lose';
  }

  return { playerChoice, botChoice, result };
}

function magic8Ball() {
  return MAGIC_8BALL_RESPONSES[Math.floor(Math.random() * MAGIC_8BALL_RESPONSES.length)];
}

function rollDice(notation = '1d6') {
  const match = notation.toLowerCase().match(/^(\d+)d(\d+)$/);
  if (!match) return null;

  const count = Math.min(parseInt(match[1]), 100);
  const sides = Math.min(parseInt(match[2]), 1000);

  if (count < 1 || sides < 2) return null;

  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }

  const total = rolls.reduce((a, b) => a + b, 0);
  return { rolls, total, notation: `${count}d${sides}` };
}

function buildRPSEmbed(playerChoice, botChoice, result, username) {
  const resultText = result === 'win' ? '🎉 You won!' : result === 'lose' ? '😢 You lost!' : '🤝 It\'s a tie!';
  const color = result === 'win' ? '#22c55e' : result === 'lose' ? '#ef4444' : '#eab308';

  return new EmbedBuilder()
    .setTitle('🎮 Rock, Paper, Scissors')
    .setColor(color)
    .addFields(
      { name: username, value: `${RPS_EMOJIS[playerChoice]} ${playerChoice}`, inline: true },
      { name: 'vs', value: '⚔️', inline: true },
      { name: 'Bot', value: `${RPS_EMOJIS[botChoice]} ${botChoice}`, inline: true },
    )
    .setDescription(resultText);
}

function buildRPSChallengeEmbed(challenge) {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ RPS Challenge!')
    .setColor('#f59e0b')
    .setDescription(
      `**${challenge.challengerName}** has challenged **${challenge.targetName}** to a duel!`
    )
    .addFields(
      { name: '💰 Bet', value: challenge.bet > 0 ? `${challenge.bet} 🍞` : 'No bet', inline: true },
      { name: '⏰ Time', value: '60 seconds to respond', inline: true },
    )
    .setFooter({ text: 'Pick your move to accept!' })
    .setTimestamp();
  
  return embed;
}

function buildRPSChallengeComponents(challengeOrId, targetId) {
  if (typeof challengeOrId === 'string') {
    const challengeId = challengeOrId;
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${RPS_BUTTON_PREFIX}:play:${challengeId}:${targetId}:rock`)
          .setLabel('Rock')
          .setEmoji('🪨')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${RPS_BUTTON_PREFIX}:play:${challengeId}:${targetId}:paper`)
          .setLabel('Paper')
          .setEmoji('📄')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${RPS_BUTTON_PREFIX}:play:${challengeId}:${targetId}:scissors`)
          .setLabel('Scissors')
          .setEmoji('✂️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${RPS_BUTTON_PREFIX}:decline:${challengeId}:${targetId}`)
          .setLabel('Decline')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  const challenge = challengeOrId;
  const challengeId = challenge.id;
  const encodedChoice = challenge.challengerChoice;
  const encodedBet = Math.max(0, challenge.bet || 0);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${RPS_BUTTON_PREFIX}:play:${challengeId}:${encodedChoice}:${encodedBet}:rock`)
        .setLabel('Rock')
        .setEmoji('🪨')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${RPS_BUTTON_PREFIX}:play:${challengeId}:${encodedChoice}:${encodedBet}:paper`)
        .setLabel('Paper')
        .setEmoji('📄')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${RPS_BUTTON_PREFIX}:play:${challengeId}:${encodedChoice}:${encodedBet}:scissors`)
        .setLabel('Scissors')
        .setEmoji('✂️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${RPS_BUTTON_PREFIX}:decline:${challengeId}:${encodedChoice}:${encodedBet}`)
        .setLabel('Decline')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildRPSChoiceComponents(challengerId, targetId, bet = 0) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${RPS_BUTTON_PREFIX}:choice:${challengerId}:${targetId}:${bet}:rock`)
        .setLabel('Rock')
        .setEmoji('🪨')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${RPS_BUTTON_PREFIX}:choice:${challengerId}:${targetId}:${bet}:paper`)
        .setLabel('Paper')
        .setEmoji('📄')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${RPS_BUTTON_PREFIX}:choice:${challengerId}:${targetId}:${bet}:scissors`)
        .setLabel('Scissors')
        .setEmoji('✂️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildRPSWaitingEmbed(challenge, userId) {
  const isChallenger = userId === challenge.challengerId;
  const waiting = isChallenger ? challenge.targetName : challenge.challengerName;
  
  return new EmbedBuilder()
    .setTitle('⏳ Waiting...')
    .setColor('#6b7280')
    .setDescription(`Waiting for **${waiting}** to choose...`);
}

function buildRPSDuelResultEmbed(challenge, outcome) {
  const { challengerChoice, targetChoice, challengerName, targetName, bet } = challenge;
  
  let resultText, color;
  if (outcome.result === 'draw') {
    resultText = "🤝 It's a tie! Bets refunded.";
    color = '#eab308';
  } else if (outcome.result === 'challenger_wins') {
    resultText = `🎉 **${challengerName}** wins${bet > 0 ? ` ${bet * 2} 🍞` : ''}!`;
    color = '#22c55e';
  } else {
    resultText = `🎉 **${targetName}** wins${bet > 0 ? ` ${bet * 2} 🍞` : ''}!`;
    color = '#22c55e';
  }
  
  return new EmbedBuilder()
    .setTitle('⚔️ RPS Duel - Results!')
    .setColor(color)
    .setDescription(resultText)
    .addFields(
      { name: challengerName, value: `${RPS_EMOJIS[challengerChoice]} ${challengerChoice}`, inline: true },
      { name: 'vs', value: '⚔️', inline: true },
      { name: targetName, value: `${RPS_EMOJIS[targetChoice]} ${targetChoice}`, inline: true },
    )
    .setTimestamp();
}

function build8BallEmbed(question, answer) {
  return new EmbedBuilder()
    .setTitle('🎱 Magic 8 Ball')
    .setColor(BRAND_COLORS.primary)
    .addFields(
      { name: 'Question', value: question },
      { name: 'Answer', value: `*${answer}*` },
    );
}

function buildRPSExpiredEmbed(challenge) {
  return new EmbedBuilder()
    .setTitle('⚔️ RPS Challenge - Expired')
    .setColor('#6b7280')
    .setDescription(
      `The challenge from **${challenge.challengerName}** to **${challenge.targetName}** has expired.`
    )
    .addFields(
      { name: '💰 Bet', value: challenge.bet > 0 ? `${challenge.bet} 🍞` : 'No bet', inline: true },
    )
    .setFooter({ text: 'Challenge timed out after 60 seconds' })
    .setTimestamp();
}

function buildDiceEmbed(result) {
  const rollsDisplay = result.rolls.length > 20
    ? result.rolls.slice(0, 20).join(', ') + '...'
    : result.rolls.join(', ');

  return new EmbedBuilder()
    .setTitle('🎲 Dice Roll')
    .setColor('#f59e0b')
    .setDescription(`**${result.notation}**`)
    .addFields(
      { name: 'Results', value: `[${rollsDisplay}]` },
      { name: 'Total', value: `**${result.total}**`, inline: true },
    );
}

async function buildFunMessage(filename, input, fallbackEmbed, components = undefined, renderer = renderArcadeImage) {
  try {
    const buffer = await renderer(input);
    const attachment = new AttachmentBuilder(buffer, { name: filename });
    const embed = new EmbedBuilder()
      .setColor(input.accent)
      .setImage(`attachment://${filename}`)
      .setFooter({ text: input.detail });
    return { embeds: [embed], files: [attachment], ...(components ? { components } : {}) };
  } catch (error) {
    if (error.message !== 'Animation renderer is busy') {
      console.warn(`[Arcade] Could not render ${input.title}: ${error.message}`);
    }
    if (renderer !== renderArcadeImage) {
      return buildFunMessage(filename.replace(/\.gif$/i, '.png'), input, fallbackEmbed, components);
    }
    return { embeds: [fallbackEmbed], ...(components ? { components } : {}) };
  }
}

async function buildRPSMessage(playerChoice, botChoice, result, username) {
  const state = result === 'win'
    ? { status: 'YOU WIN', detail: `${playerChoice} beats ${botChoice}`, accent: '#61d59b' }
    : result === 'lose'
      ? { status: 'BREAD WINS', detail: `${botChoice} beats ${playerChoice}`, accent: '#ef6877' }
      : { status: 'DRAW', detail: `Both picked ${playerChoice}`, accent: '#e9bb63' };
  return buildFunMessage('rps.png', {
    type: 'rps',
    title: 'Rock Paper Scissors',
    username,
    ...state,
    data: { playerChoice, botChoice, playerName: username, opponentName: 'Bread' },
    metrics: [
      { label: 'YOUR MOVE', value: playerChoice.toUpperCase() },
      { label: 'OPPONENT', value: 'BREAD' },
      { label: 'RESULT', value: state.status },
    ],
  }, buildRPSEmbed(playerChoice, botChoice, result, username));
}

async function build8BallMessage(username, question, answer) {
  return buildFunMessage('8ball.png', {
    type: '8ball',
    title: 'Magic 8 Ball',
    username,
    status: answer.toUpperCase(),
    detail: question,
    accent: '#8f82eb',
    data: { answer },
    metrics: [
      { label: 'QUESTION', value: String(question).slice(0, 24) },
      { label: 'VERDICT', value: answer.toUpperCase() },
      { label: 'CERTAINTY', value: 'MYSTERIOUS' },
    ],
  }, build8BallEmbed(question, answer));
}

async function buildDiceMessage(username, result) {
  const rolls = result.rolls.length > 8 ? [...result.rolls.slice(0, 7), `+${result.rolls.length - 7}`] : result.rolls;
  return buildFunMessage('dice.gif', {
    type: 'dice',
    title: 'Dice Roll',
    username,
    status: `TOTAL ${result.total}`,
    detail: `${result.notation} rolled ${result.rolls.length} dice`,
    accent: '#e9bb63',
    data: { rolls, notation: result.notation },
    metrics: [
      { label: 'NOTATION', value: result.notation.toUpperCase() },
      { label: 'DICE', value: String(result.rolls.length) },
      { label: 'TOTAL', value: String(result.total) },
    ],
  }, buildDiceEmbed(result), undefined, renderDiceAnimation);
}

function duelState(challenge, outcome = null) {
  if (!outcome) {
    return { status: 'CHALLENGE OPEN', detail: `${challenge.targetName} has 60 seconds to choose`, accent: '#e9bb63' };
  }
  if (outcome.result === 'draw') {
    return { status: 'DRAW', detail: 'Bets returned', accent: '#e9bb63' };
  }
  const winner = outcome.winnerId === challenge.challengerId ? challenge.challengerName : challenge.targetName;
  return {
    status: `${winner.toUpperCase()} WINS`,
    detail: challenge.bet > 0 ? `${challenge.bet * 2} BREAD payout` : 'Duel complete',
    accent: '#61d59b',
  };
}

async function buildRPSPrepareMessage(username, opponentName, bet, components) {
  return buildFunMessage('rps-prepare.png', {
    type: 'rps',
    title: 'RPS Duel',
    username,
    status: 'CHOOSE YOUR MOVE',
    detail: `Your choice stays hidden from ${opponentName}`,
    accent: '#8f82eb',
    data: { playerChoice: null, botChoice: null, playerName: username, opponentName },
    metrics: [
      { label: 'OPPONENT', value: opponentName.toUpperCase() },
      { label: 'BET', value: bet > 0 ? `${bet} BREAD` : 'NO BET' },
      { label: 'PRIVACY', value: 'HIDDEN MOVE' },
    ],
  }, new EmbedBuilder()
    .setTitle('⚔️ Prepare RPS duel')
    .setColor('#f59e0b')
    .setDescription(`Choose your hidden move against **${opponentName}**.`), components);
}

async function buildRPSChallengeMessage(challenge, components) {
  const state = duelState(challenge);
  return buildFunMessage('rps-challenge.png', {
    type: 'rps',
    title: 'RPS Duel',
    username: challenge.challengerName,
    ...state,
    data: {
      playerChoice: null,
      botChoice: null,
      playerName: challenge.challengerName,
      opponentName: challenge.targetName,
    },
    metrics: [
      { label: 'CHALLENGER', value: challenge.challengerName.toUpperCase() },
      { label: 'OPPONENT', value: challenge.targetName.toUpperCase() },
      { label: 'BET', value: challenge.bet > 0 ? `${challenge.bet} BREAD` : 'NO BET' },
    ],
  }, buildRPSChallengeEmbed(challenge), components);
}

async function buildRPSDuelResultMessage(challenge, outcome) {
  const state = duelState(challenge, outcome);
  return buildFunMessage('rps-result.png', {
    type: 'rps',
    title: 'RPS Duel',
    username: challenge.challengerName,
    ...state,
    data: {
      playerChoice: challenge.challengerChoice,
      botChoice: challenge.targetChoice,
      playerName: challenge.challengerName,
      opponentName: challenge.targetName,
    },
    metrics: [
      { label: challenge.challengerName.toUpperCase(), value: challenge.challengerChoice.toUpperCase() },
      { label: challenge.targetName.toUpperCase(), value: challenge.targetChoice.toUpperCase() },
      { label: 'BET', value: challenge.bet > 0 ? `${challenge.bet} BREAD` : 'NO BET' },
    ],
  }, buildRPSDuelResultEmbed(challenge, outcome));
}

async function buildRPSExpiredMessage(challenge) {
  return buildFunMessage('rps-expired.png', {
    type: 'rps',
    title: 'RPS Duel',
    username: challenge.challengerName,
    status: 'CHALLENGE EXPIRED',
    detail: `${challenge.targetName} did not choose in time`,
    accent: '#777381',
    data: { playerChoice: null, botChoice: null, playerName: challenge.challengerName, opponentName: challenge.targetName },
    metrics: [
      { label: 'CHALLENGER', value: challenge.challengerName.toUpperCase() },
      { label: 'OPPONENT', value: challenge.targetName.toUpperCase() },
      { label: 'BET', value: challenge.bet > 0 ? `${challenge.bet} BREAD` : 'NO BET' },
    ],
  }, buildRPSExpiredEmbed(challenge));
}

module.exports = {
  playRPS,
  magic8Ball,
  rollDice,
  buildRPSEmbed,
  build8BallEmbed,
  buildDiceEmbed,
  buildRPSMessage,
  build8BallMessage,
  buildDiceMessage,
  buildRPSPrepareMessage,
  buildRPSChallengeMessage,
  buildRPSDuelResultMessage,
  buildRPSExpiredMessage,
  RPS_CHOICES,
  RPS_BUTTON_PREFIX,
  RPS_EMOJIS,
  createChallenge,
  getChallenge,
  cancelChallenge,
  setTargetChoice,
  setMessageInfo,
  determineWinner,
  cleanupChallenge,
  setExpireCallback,
  buildRPSChallengeEmbed,
  buildRPSChallengeComponents,
  buildRPSChoiceComponents,
  buildRPSDuelResultEmbed,
  buildRPSExpiredEmbed,
};
