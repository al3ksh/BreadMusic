const votes = new Map();

function resetVotes(guildId) {
  const previous = votes.get(guildId) || null;
  votes.delete(guildId);
  return previous;
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
  votes.set(guildId, { trackKey, userIds: current, updatedAt: Date.now() });
  return current.size;
}

function getVoteState(guildId, eligibleUserIds = null, trackKey = null) {
  const existing = votes.get(guildId);
  if (!existing || (trackKey && existing.trackKey !== trackKey)) return null;

  if (eligibleUserIds) {
    const eligible = eligibleUserIds instanceof Set ? eligibleUserIds : new Set(eligibleUserIds);
    for (const userId of existing.userIds) {
      if (!eligible.has(userId)) existing.userIds.delete(userId);
    }
  }

  return {
    trackKey: existing.trackKey,
    userIds: new Set(existing.userIds),
    updatedAt: existing.updatedAt,
  };
}

function getVotes(guildId) {
  return getVoteState(guildId)?.userIds ?? new Set();
}

module.exports = {
  resetVotes,
  registerVote,
  getVoteState,
  getVotes,
};
