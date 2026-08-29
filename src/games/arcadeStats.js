const { FileStore } = require('../state/fileStore');

const arcadeStore = new FileStore('arcade-stats.json', {});

function emptyStats() {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    totalWagered: 0,
    totalPayout: 0,
    biggestPayout: 0,
    byGame: {},
    updatedAt: null,
  };
}

function normalizeStats(value) {
  const stats = { ...emptyStats(), ...(value || {}) };
  stats.byGame = { ...(value?.byGame || {}) };
  return stats;
}

function applyEvent(stats, event) {
  stats.games += 1;
  if (event.outcome === 'win') stats.wins += 1;
  else if (event.outcome === 'draw') stats.draws += 1;
  else stats.losses += 1;
  stats.totalWagered += Math.max(0, Number(event.bet) || 0);
  stats.totalPayout += Math.max(0, Number(event.payout) || 0);
  stats.biggestPayout = Math.max(stats.biggestPayout, Math.max(0, Number(event.payout) || 0));
  const game = String(event.game || 'unknown');
  const gameStats = { games: 0, wins: 0, ...(stats.byGame[game] || {}) };
  gameStats.games += 1;
  if (event.outcome === 'win') gameStats.wins += 1;
  stats.byGame[game] = gameStats;
  stats.updatedAt = Date.now();
  return stats;
}

function recordArcadeGame(event) {
  if (!event?.userId || !event?.game) return;
  const globalKey = `global:${event.userId}`;
  arcadeStore.set(globalKey, applyEvent(normalizeStats(arcadeStore.get(globalKey, null)), event));

  if (event.guildId) {
    const guildKey = `guild:${event.guildId}:${event.userId}`;
    arcadeStore.set(guildKey, applyEvent(normalizeStats(arcadeStore.get(guildKey, null)), event));
  }

}

function getArcadeStats(userId, guildId = null) {
  const key = guildId ? `guild:${guildId}:${userId}` : `global:${userId}`;
  return normalizeStats(arcadeStore.get(key, null));
}

module.exports = {
  getArcadeStats,
  recordArcadeGame,
};
