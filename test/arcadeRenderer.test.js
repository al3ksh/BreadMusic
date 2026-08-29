const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { renderArcadeImage } = require('../src/games/arcadeRenderer');
const { logoDataUri } = require('../src/games/brandAssets');
const { buildSlotsMessage, buildRouletteMessage, buildCoinflipMessage } = require('../src/games/gambling');
const { buildReplayComponents, consumeReplayToken, parseReplayCustomId } = require('../src/games/arcadeControls');
const { resolveWorkerCount } = require('../src/games/arcadeAnimation');
const {
  buildRPSMessage,
  build8BallMessage,
  buildDiceMessage,
  buildRPSPrepareMessage,
  buildRPSChallengeMessage,
  buildRPSDuelResultMessage,
  buildRPSExpiredMessage,
} = require('../src/games/fun');

async function assertImageMessage(message, filename, expected = { format: 'png', width: 1200, height: 700 }) {
  assert.equal(message.embeds.length, 1);
  assert.equal(message.files.length, 1);
  assert.equal(message.files[0].name, filename);
  assert.equal(message.embeds[0].data.image.url, `attachment://${filename}`);
  const metadata = await sharp(message.files[0].attachment, { animated: true }).metadata();
  assert.equal(metadata.format, expected.format);
  assert.equal(metadata.width, expected.width);
  assert.equal(metadata.pageHeight || metadata.height, expected.height);
  if (expected.pages) assert.equal(metadata.pages, expected.pages);
}

test('arcade renderer produces a Discord-ready PNG', async () => {
  assert.match(logoDataUri, /^data:image\/png;base64,/);
  const buffer = await renderArcadeImage({
    type: 'coinflip',
    title: 'Coinflip',
    username: 'Player',
    status: 'YOU WIN',
    detail: '+200 BREAD',
    accent: '#61d59b',
    data: { result: 'heads' },
    metrics: [{ label: 'BET', value: '100 BREAD' }],
  });
  const metadata = await sharp(buffer).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['png', 1200, 700]);
});

test('gambling commands build graphical messages', async () => {
  await assertImageMessage(
    await buildSlotsMessage('Player', ['🍞', '🍞', '🍞'], 0, 0, true, 1200),
    'slots.gif',
    { format: 'gif', width: 800, height: 467, pages: 15 },
  );
  await assertImageMessage(
    await buildRouletteMessage('Player', 17, 'black', 'black', 0, true, 0, 1200),
    'roulette.gif',
    { format: 'gif', width: 800, height: 467, pages: 20 },
  );
  await assertImageMessage(
    await buildCoinflipMessage('Player', 'heads', 'heads', 100, true, 200, 1200),
    'coinflip.gif',
    { format: 'gif', width: 800, height: 467, pages: 16 },
  );
});

test('every arcade wager remains optional', () => {
  const { commands } = require('../src/commands');
  for (const name of ['blackjack', 'slots', 'roulette', 'coinflip']) {
    const command = commands.find((entry) => entry.data.name === name).data.toJSON();
    const bet = command.options?.find((option) => option.name === 'bet');
    assert.ok(bet, `${name} should expose a bet option`);
    assert.notEqual(bet.required, true, `${name} bet should be optional`);
  }
  const rps = commands.find((entry) => entry.data.name === 'rps').data.toJSON();
  const duel = rps.options.find((option) => option.name === 'duel');
  const duelBet = duel.options.find((option) => option.name === 'bet');
  assert.notEqual(duelBet.required, true);
  const stats = commands.find((entry) => entry.data.name === 'stats').data.toJSON();
  assert.ok(stats.options.some((option) => option.name === 'arcade'));
});

test('replay buttons preserve the game options and can only be consumed once', () => {
  const rows = buildReplayComponents({ game: 'roulette', userId: '123', bet: 250, option: 'black' });
  const customId = rows[0].components[0].data.custom_id;
  const parsed = parseReplayCustomId(customId);
  assert.deepEqual(
    { game: parsed.game, userId: parsed.userId, bet: parsed.bet, option: parsed.option },
    { game: 'roulette', userId: '123', bet: 250, option: 'black' },
  );
  assert.equal(consumeReplayToken(parsed.token, 'different-user'), false);
  assert.equal(consumeReplayToken(parsed.token, '123'), true);
  assert.equal(consumeReplayToken(parsed.token, '123'), false);
});

test('two animations render concurrently and a third falls back to a static PNG', async () => {
  const messages = await Promise.all([
    buildSlotsMessage('Player', ['🍒', '🍒', '🍒'], 100, 300, true, 1300),
    buildRouletteMessage('Player', 8, 'black', 'black', 100, true, 200, 1200),
    buildCoinflipMessage('Player', 'heads', 'heads', 100, true, 200, 1200),
  ]);
  const names = messages.map((message) => message.files[0].name).sort();
  assert.equal(names.filter((name) => name.endsWith('.gif')).length, 2);
  assert.equal(names.filter((name) => name.endsWith('.png')).length, 1);
});

test('animation worker limit defaults safely and stays within supported bounds', () => {
  assert.equal(resolveWorkerCount(undefined), 2);
  assert.equal(resolveWorkerCount('1'), 1);
  assert.equal(resolveWorkerCount('3'), 3);
  assert.equal(resolveWorkerCount('0'), 1);
  assert.equal(resolveWorkerCount('99'), 4);
  assert.equal(resolveWorkerCount('invalid'), 2);
});

test('fun commands build graphical messages', async () => {
  await assertImageMessage(await buildRPSMessage('rock', 'scissors', 'win', 'Player'), 'rps.png');
  await assertImageMessage(await build8BallMessage('Player', 'Will this work?', 'Without a doubt.'), '8ball.png');
  await assertImageMessage(
    await buildDiceMessage('Player', { notation: '3d20', rolls: [6, 12, 20], total: 38 }),
    'dice.gif',
    { format: 'gif', width: 800, height: 467, pages: 13 },
  );
});

test('RPS duel keeps every interaction state graphical', async () => {
  const challenge = {
    challengerId: '1',
    challengerName: 'Player One',
    targetId: '2',
    targetName: 'Player Two',
    challengerChoice: 'rock',
    targetChoice: 'scissors',
    bet: 250,
  };
  const components = [];
  await assertImageMessage(await buildRPSPrepareMessage('Player One', 'Player Two', 250, components), 'rps-prepare.png');
  await assertImageMessage(await buildRPSChallengeMessage(challenge, components), 'rps-challenge.png');
  await assertImageMessage(await buildRPSDuelResultMessage(challenge, { result: 'challenger_wins', winnerId: '1' }), 'rps-result.png');
  await assertImageMessage(await buildRPSExpiredMessage(challenge), 'rps-expired.png');
});
