const idleTimers = new Map();

function scheduleIdleLeave(player, config) {
  if (!player) return;
  clearIdle(player.guildId);
  if (config.stayInChannel) return;
  if (!config.afkTimeout || config.afkTimeout <= 0) return;

  const timeout = setTimeout(async () => {
    try {
      if (!player.queue.current && player.queue.tracks.length === 0) {
        await player.destroy('idle-timeout', true);
      }
    } catch (error) {
      console.error('Idle leave failed', error);
    }
  }, config.afkTimeout);

  idleTimers.set(player.guildId, timeout);
}

function clearIdle(guildId) {
  const timeout = idleTimers.get(guildId);
  if (timeout) {
    clearTimeout(timeout);
    idleTimers.delete(guildId);
  }
}

module.exports = {
  scheduleIdleLeave,
  clearIdle,
};
