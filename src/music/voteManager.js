const votes = new Map();

function resetVotes(guildId) {
  votes.delete(guildId);
}

function registerVote(guildId, userId, eligibleUserIds = null, trackKey = null) {
  const existing = votes.get(guildId);
  const current = existing && existing.trackKey === trackKey
    ? existing.userIds
    : new Set();
  if (eligibleUserIds) {
    const eligible = eligibleUserIds instanceof Set
      ? eligibleUserIds
      : new Set(eligibleUserIds);
    for (const existingUserId of current) {
      if (!eligible.has(existingUserId)) current.delete(existingUserId);
    }
  }
  current.add(userId);
  votes.set(guildId, { trackKey, userIds: current });
  return current.size;
}

function getVotes(guildId) {
  return votes.get(guildId)?.userIds ?? new Set();
}

module.exports = {
  resetVotes,
  registerVote,
  getVotes,
};
