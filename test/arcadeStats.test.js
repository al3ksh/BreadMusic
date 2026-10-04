const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('arcade stats persist global and guild outcomes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-arcade-stats-'));
  process.env.BREAD_DATA_DIR = tempDir;

  const { closeDatabases } = require('../src/state/sqliteStore');
  const { getArcadeStats, getGuildArcadeStats, recordArcadeGame } = require('../src/games/arcadeStats');
  const userId = 'arcade-user';
  const guildId = 'arcade-guild';
  recordArcadeGame({ userId, guildId, game: 'slots', outcome: 'win', bet: 25, payout: 50 });
  recordArcadeGame({ userId, guildId, game: 'slots', outcome: 'loss', bet: 25, payout: 0 });
  recordArcadeGame({ userId, game: 'dice', outcome: 'draw', bet: 0, payout: 0 });

  const global = getArcadeStats(userId);
  const guild = getArcadeStats(userId, guildId);
  assert.deepEqual(
    { games: global.games, wins: global.wins, losses: global.losses, draws: global.draws },
    { games: 3, wins: 1, losses: 1, draws: 1 },
  );
  assert.equal(global.totalWagered, 50);
  assert.equal(global.totalPayout, 50);
  assert.deepEqual(
    { games: guild.games, wins: guild.wins, losses: guild.losses, draws: guild.draws },
    { games: 2, wins: 1, losses: 1, draws: 0 },
  );
  assert.equal(guild.byGame.slots.games, 2);
  assert.equal(guild.byGame.slots.wins, 1);

  recordArcadeGame({ userId: 'arcade-rival', guildId, game: 'dice', outcome: 'win', bet: 10, payout: 100 });
  const server = getGuildArcadeStats(guildId);
  assert.equal(server.playerCount, 2);
  assert.equal(server.games, 3);
  assert.equal(server.totalWagered, 60);
  assert.equal(server.biggestPayout, 100);
  assert.deepEqual(server.byGame.dice, { games: 1, wins: 1 });
  assert.deepEqual(server.players.map((player) => player.userId), ['arcade-rival', userId]);
  assert.equal(getGuildArcadeStats('other-guild').playerCount, 0);

  closeDatabases();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
