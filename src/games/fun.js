const { EmbedBuilder } = require('discord.js');

const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_EMOJIS = { rock: '🪨', paper: '📄', scissors: '✂️' };
const RPS_WINS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

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

function build8BallEmbed(question, answer) {
  return new EmbedBuilder()
    .setTitle('🎱 Magic 8 Ball')
    .setColor('#6366f1')
    .addFields(
      { name: 'Question', value: question },
      { name: 'Answer', value: `*${answer}*` },
    );
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

module.exports = {
  playRPS,
  magic8Ball,
  rollDice,
  buildRPSEmbed,
  build8BallEmbed,
  buildDiceEmbed,
  RPS_CHOICES,
};
