// Live player updates: SSE subscribers and short notices.
const crypto = require('crypto');

const playerEventSubscribers = new Map();
const playerNotices = new Map();

function publishPlayerNotice(guildId, message, tone = 'info') {
  if (!guildId || !message) return;
  playerNotices.set(guildId, {
    id: crypto.randomUUID(),
    message,
    tone,
    expiresAt: Date.now() + 8000,
  });
  broadcastPlayerUpdate(guildId);
}

function getPlayerNotice(guildId) {
  const notice = playerNotices.get(guildId);
  if (!notice) return null;
  if (notice.expiresAt <= Date.now()) {
    playerNotices.delete(guildId);
    return null;
  }
  return notice;
}

function broadcastPlayerUpdate(guildId) {
  const subscribers = playerEventSubscribers.get(guildId);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    try {
      subscriber();
    } catch (error) {
      console.warn(`Failed to broadcast player update for ${guildId}:`, error.message);
    }
  }
}

module.exports = {
  playerEventSubscribers,
  publishPlayerNotice,
  getPlayerNotice,
  broadcastPlayerUpdate,
};
