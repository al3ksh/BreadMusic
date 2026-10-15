const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-game-buttons-'));
const originalDbPath = process.env.BREAD_DB_PATH;
process.env.BREAD_DB_PATH = path.join(tempDir, 'bread.sqlite');

const { closeDatabases } = require('../src/state/sqliteStore');
const { handleBlackjackButton, handleArcadeReplayButton, handleRPSButton } = require('../src/games/buttons');
const { startGame, getGame, endGame } = require('../src/games/blackjack');
const { addBalance, getBalance, checkGamblingCooldown } = require('../src/games/economy');
const { buildReplayComponents } = require('../src/games/arcadeControls');
const { createChallenge, getChallenge, cleanupChallenge } = require('../src/games/fun');

let nextUserId = 100000000000000000n;
const newUserId = () => String(nextUserId++);

function createInteraction({ customId, userId, username = 'player', users = {}, channel } = {}) {
  const calls = [];
  const record = (name) => async (payload) => { calls.push({ name, payload }); };
  return {
    calls,
    customId,
    guildId: 'game-guild',
    user: { id: userId, username, globalName: username },
    client: {
      users: {
        fetch: async (id) => {
          if (!users[id]) throw new Error('Unknown user');
          return users[id];
        },
      },
    },
    channel,
    reply: record('reply'),
    update: record('update'),
    deferUpdate: record('deferUpdate'),
    followUp: record('followUp'),
    editReply: record('editReply'),
    last() {
      return calls.at(-1);
    },
  };
}

function replayCustomId(components) {
  return components[0].components[0].data.custom_id;
}

test.after(() => {
  closeDatabases();
  if (originalDbPath === undefined) delete process.env.BREAD_DB_PATH;
  else process.env.BREAD_DB_PATH = originalDbPath;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('blackjack controls only answer the player who owns the game', async () => {
  const owner = newUserId();
  const interaction = createInteraction({ customId: `bj:hit:${owner}`, userId: newUserId() });
  await handleBlackjackButton(interaction);
  assert.equal(interaction.last().name, 'reply');
  assert.match(interaction.last().payload.content, /Only the player/);
});

test('blackjack controls report a finished game instead of throwing', async () => {
  const userId = newUserId();
  const interaction = createInteraction({ customId: `bj:hit:${userId}`, userId });
  await handleBlackjackButton(interaction);
  assert.match(interaction.last().payload.content, /has ended/);
});

test('blackjack hit and stand update the same message', async () => {
  const userId = newUserId();
  startGame(userId, 0, 'game-guild');
  try {
    const hit = createInteraction({ customId: `bj:hit:${userId}`, userId });
    await handleBlackjackButton(hit);
    assert.deepEqual(hit.calls.map((call) => call.name), ['deferUpdate', 'editReply']);
    assert.ok(hit.last().payload.embeds || hit.last().payload.files || hit.last().payload.components);

    if (getGame(userId)) {
      const stand = createInteraction({ customId: `bj:stand:${userId}`, userId });
      await handleBlackjackButton(stand);
      assert.equal(stand.last().name, 'editReply');
    }
    assert.equal(getGame(userId), undefined, 'a finished game is cleared');
  } finally {
    endGame(userId);
  }
});

test('blackjack replay refuses to start over an active game', async () => {
  const userId = newUserId();
  startGame(userId, 0, 'game-guild');
  try {
    const interaction = createInteraction({ customId: `bj:replay:${userId}:0`, userId });
    await handleBlackjackButton(interaction);
    assert.match(interaction.last().payload.content, /already have an active game/);
  } finally {
    endGame(userId);
  }
});

test('blackjack replay with a bet the player cannot cover explains why', async () => {
  const userId = newUserId();
  const interaction = createInteraction({ customId: `bj:replay:${userId}:500000`, userId });
  await handleBlackjackButton(interaction);
  assert.equal(interaction.last().name, 'followUp');
  assert.match(interaction.last().payload.content, /enough/);
  assert.equal(getGame(userId), undefined);
});

test('arcade replay rejects malformed buttons and other players', async () => {
  const userId = newUserId();
  const invalid = createInteraction({ customId: 'arcade:replay:poker:1:0:-:x', userId });
  await handleArcadeReplayButton(invalid);
  assert.match(invalid.last().payload.content, /invalid/);

  const customId = replayCustomId(buildReplayComponents({ game: 'coinflip', userId, bet: 0, option: 'heads' }));
  const stranger = createInteraction({ customId, userId: newUserId() });
  await handleArcadeReplayButton(stranger);
  assert.match(stranger.last().payload.content, /Only the player/);
});

test('arcade replay plays once per button and keeps the token when the game refuses', async () => {
  const userId = newUserId();
  addBalance(userId, 100);
  const customId = replayCustomId(buildReplayComponents({ game: 'coinflip', userId, bet: 10, option: 'heads' }));

  const first = createInteraction({ customId, userId });
  await handleArcadeReplayButton(first);
  assert.deepEqual(first.calls.map((call) => call.name), ['deferUpdate', 'editReply']);
  assert.equal(first.last().payload.components.length, 1, 'a fresh replay button is attached');
  assert.notEqual(getBalance(userId), 100);

  const again = createInteraction({ customId, userId });
  await handleArcadeReplayButton(again);
  assert.match(again.last().payload.content, /already used or expired/);

  // The next replay lands inside the gambling cooldown, so its token must survive for a retry.
  checkGamblingCooldown(userId); // restart the cooldown so slow renders cannot let it lapse first
  const nextId = replayCustomId(first.last().payload.components);
  const cooledDown = createInteraction({ customId: nextId, userId });
  await handleArcadeReplayButton(cooledDown);
  assert.match(cooledDown.last().payload.content, /Wait/);
  const retry = createInteraction({ customId: nextId, userId });
  await handleArcadeReplayButton(retry);
  assert.doesNotMatch(retry.last().payload.content ?? '', /already used/);
});

test('rps challenge setup rejects self, bots and missing opponents', async () => {
  const challenger = newUserId();
  const bot = newUserId();
  const channel = { send: async () => ({ channelId: 'c', id: 'm' }) };

  const self = createInteraction({ customId: `rps:choice:${challenger}:${challenger}:0:rock`, userId: challenger, channel });
  await handleRPSButton(self);
  assert.match(self.last().payload.content, /challenge yourself/);

  const vsBot = createInteraction({
    customId: `rps:choice:${challenger}:${bot}:0:rock`,
    userId: challenger,
    channel,
    users: { [bot]: { id: bot, username: 'robot', bot: true } },
  });
  await handleRPSButton(vsBot);
  assert.match(vsBot.last().payload.content, /challenge a bot/);

  const missing = createInteraction({ customId: `rps:choice:${challenger}:${newUserId()}:0:rock`, userId: challenger, channel });
  await handleRPSButton(missing);
  assert.match(missing.last().payload.content, /Could not find/);
});

test('rps duel sends the challenge, then settles the bet when the target plays', async () => {
  const challenger = newUserId();
  const target = newUserId();
  addBalance(challenger, 50);
  addBalance(target, 50);
  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { channelId: 'c', id: 'm' }; } };

  const setup = createInteraction({
    customId: `rps:choice:${challenger}:${target}:20:rock`,
    userId: challenger,
    username: 'alice',
    channel,
    users: { [target]: { id: target, username: 'bob', bot: false } },
  });
  await handleRPSButton(setup);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, `<@${target}>`);
  assert.match(setup.last().payload.content, /Challenge sent/);

  const challengeId = sent[0].components[0].components[0].data.custom_id.split(':')[2];
  assert.equal(getChallenge(challengeId).status, 'pending');

  const stranger = createInteraction({ customId: `rps:play:${challengeId}:rock:20:paper`, userId: challenger });
  await handleRPSButton(stranger);
  assert.match(stranger.last().payload.content, /not for you/);

  const play = createInteraction({ customId: `rps:play:${challengeId}:rock:20:scissors`, userId: target, username: 'bob' });
  await handleRPSButton(play);
  assert.equal(play.last().name, 'update');
  assert.deepEqual(play.last().payload.components, []);
  assert.equal(getChallenge(challengeId), undefined);
  assert.equal(getBalance(challenger), 70);
  assert.equal(getBalance(target), 30);
});

test('rps decline clears a pending challenge without moving bread', async () => {
  const challenger = newUserId();
  const target = newUserId();
  const challenge = createChallenge(challenger, 'alice', target, 'bob', 0, 'paper');
  try {
    const decline = createInteraction({ customId: `rps:decline:${challenge.id}`, userId: target, username: 'bob' });
    await handleRPSButton(decline);
    assert.match(decline.last().payload.content, /declined/);
    assert.equal(getChallenge(challenge.id), undefined);
  } finally {
    cleanupChallenge(challenge.id);
  }
});

test('rps buttons on an old challenge say it expired', async () => {
  const challenger = newUserId();
  const target = newUserId();
  const staleId = `${challenger}-${target}-${Date.now() - 5 * 60_000}`;
  const play = createInteraction({ customId: `rps:play:${staleId}:rock:0:paper`, userId: target });
  await handleRPSButton(play);
  assert.match(play.last().payload.content, /expired or was cancelled/);
});
