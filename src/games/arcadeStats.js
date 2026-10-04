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

// Sums every member's record on one server and ranks the players.
function getGuildArcadeStats(guildId, limit = 5) {
  const prefix = `guild:${guildId}:`;
  const totals = emptyStats();
  const players = [];
  for (const [key, value] of arcadeStore.entries()) {
    if (!key.startsWith(prefix)) continue;
    const stats = normalizeStats(value);
    players.push({ userId: key.slice(prefix.length), ...stats });
    for (const field of ['games', 'wins', 'losses', 'draws', 'totalWagered', 'totalPayout']) totals[field] += stats[field];
    totals.biggestPayout = Math.max(totals.biggestPayout, stats.biggestPayout);
    for (const [game, gameStats] of Object.entries(stats.byGame)) {
      const merged = totals.byGame[game] || { games: 0, wins: 0 };
      totals.byGame[game] = { games: merged.games + (gameStats.games || 0), wins: merged.wins + (gameStats.wins || 0) };
    }
  }
  players.sort((a, b) => (b.totalPayout - b.totalWagered) - (a.totalPayout - a.totalWagered) || b.games - a.games);
  return { ...totals, players: players.slice(0, limit), playerCount: players.length };
}

module.exports = {
  getGuildArcadeStats,
  getArcadeStats,
  recordArcadeGame,
};
