const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-blackjack-'));
const originalDbPath = process.env.BREAD_DB_PATH;
process.env.BREAD_DB_PATH = path.join(tempDir, 'bread.sqlite');

const { closeDatabases } = require('../src/state/sqliteStore');
const { buildComponents, buildMessage } = require('../src/games/blackjack');

const user = {
  id: '123456789012345678',
  username: 'aleksh',
  globalName: 'aleksh',
};

function createGame(overrides = {}) {
  return {
    dealer: [
      { rank: '10', suit: '♠' },
      { rank: '7', suit: '♦' },
    ],
    player: [
      { rank: 'A', suit: '♥' },
      { rank: '8', suit: '♣' },
    ],
    finished: false,
    result: null,
    bet: 250,
    winnings: 0,
    ...overrides,
  };
}

test.after(() => {
  closeDatabases();
  if (originalDbPath === undefined) delete process.env.BREAD_DB_PATH;
  else process.env.BREAD_DB_PATH = originalDbPath;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('blackjack message renders a Discord-ready PNG board', async () => {
  const message = await buildMessage(user, createGame(), true);

  assert.equal(message.embeds.length, 1);
  assert.equal(message.files.length, 1);
  assert.equal(message.components.length, 1);
  assert.match(message.embeds[0].data.image.url, /^attachment:\/\/blackjack-/);

  const attachment = message.files[0].attachment;
  const metadata = await sharp(attachment).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 700);
});

test('finished blackjack message offers a replay with the previous bet', async () => {
  const game = createGame({
    finished: true,
    result: 'You win!',
    winnings: 500,
  });
  const message = await buildMessage(user, game, false);
  const button = message.components[0].components[0].data;

  assert.equal(button.label, 'Play again');
  assert.equal(button.custom_id, `blackjack:replay:${user.id}:250`);
});

test('active blackjack controls preserve hit, stand and double actions', () => {
  const components = buildComponents(user.id, false, true, 250);
  const customIds = components[0].components.map((button) => button.data.custom_id);

  assert.deepEqual(customIds, [
    `blackjack:hit:${user.id}`,
    `blackjack:stand:${user.id}`,
    `blackjack:double:${user.id}`,
  ]);
});
