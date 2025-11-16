const votes = new Map();

function resetVotes(guildId) {
  votes.delete(guildId);
}

function registerVote(guildId, userId) {
  const current = votes.get(guildId) ?? new Set();
  current.add(userId);
  votes.set(guildId, current);
  return current.size;
}

function getVotes(guildId) {
  return votes.get(guildId) ?? new Set();
}

module.exports = {
  resetVotes,
  registerVote,
  getVotes,
};
