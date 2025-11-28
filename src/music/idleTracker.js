const { clearStoredQueue } = require('../state/queueStore');
const { getConfig } = require('../state/guildConfig');

const emptyChannelTimers = new Map();
const idleTimers = new Map();

const EMPTY_CHANNEL_TIMEOUT = 30 * 1000;
const DEFAULT_IDLE_TIMEOUT = 150 * 1000;

function scheduleIdleLeave(player, client) {
  if (!player) return;
  const guildId = player.guildId;
  const config = getConfig(guildId);

  if (config.stayInChannel) {
    clearIdleTimer(guildId);
    return;
  }

  if (player.queue.current || player.playing) {
    clearIdleTimer(guildId);
    return;
  }

  if (idleTimers.has(guildId)) return;

  const idleTimeout = config.afkTimeout ?? DEFAULT_IDLE_TIMEOUT;

  const timeout = setTimeout(async () => {
    idleTimers.delete(guildId);
    try {
      const latestPlayer = client?.lavalink?.getPlayer(guildId) ?? player;
      if (!latestPlayer || latestPlayer.destroyed) return;
      if (latestPlayer.queue.current || latestPlayer.playing) return;
      const latestConfig = getConfig(guildId);
      if (latestConfig.stayInChannel) return;
      await latestPlayer.destroy('idle-timeout', true);
    } catch (error) {
      console.error('Idle leave failed:', error);
    }
  }, idleTimeout);

  idleTimers.set(guildId, timeout);
}

function scheduleEmptyChannelLeave(player, client) {
  if (!player) return;
  const guildId = player.guildId;
  const config = getConfig(guildId);

  if (config.stayInChannel) {
    clearEmptyChannelTimer(guildId);
    return;
  }

  if (channelHasListeners(player, client)) {
    clearEmptyChannelTimer(guildId);
    return;
  }

  if (emptyChannelTimers.has(guildId)) return;

  const timeout = setTimeout(async () => {
    emptyChannelTimers.delete(guildId);
    try {
      const latestPlayer = client?.lavalink?.getPlayer(guildId) ?? player;
      if (!latestPlayer || latestPlayer.destroyed) return;
      if (channelHasListeners(latestPlayer, client)) return;
      const latestConfig = getConfig(guildId);
      if (latestConfig.stayInChannel) return;
      if (!latestConfig.persistentQueue) {
        latestPlayer.queue.tracks.splice(0, latestPlayer.queue.tracks.length);
        clearStoredQueue(guildId);
      }
      await latestPlayer.destroy('empty-channel', true);
    } catch (error) {
      console.error('Empty channel leave failed:', error);
    }
  }, EMPTY_CHANNEL_TIMEOUT);

  emptyChannelTimers.set(guildId, timeout);
}

function handleVoiceStateUpdate(player, client) {
  if (!player) return;

  if (channelHasListeners(player, client)) {
    clearEmptyChannelTimer(player.guildId);
    return;
  }

  scheduleEmptyChannelLeave(player, client);
}

function channelHasListeners(player, client) {
  if (!client) return true;
  const guild = client.guilds.cache.get(player.guildId);
  if (!guild) return true;
  const voiceChannelId = player.voiceChannelId;
  if (!voiceChannelId) return true;

  const listeners = guild.voiceStates?.cache?.filter((state) => {
    if (state.channelId !== voiceChannelId) return false;
    if (state.id === client.user?.id) return false;
    const member = state.member ?? guild.members.cache.get(state.id);
    return member ? !member.user?.bot : true;
  });

  return (listeners?.size ?? 0) > 0;
}

function clearEmptyChannelTimer(guildId) {
  const timeout = emptyChannelTimers.get(guildId);
  if (timeout) {
    clearTimeout(timeout);
    emptyChannelTimers.delete(guildId);
  }
}

function clearIdleTimer(guildId) {
  const timeout = idleTimers.get(guildId);
  if (timeout) {
    clearTimeout(timeout);
    idleTimers.delete(guildId);
  }
}

function clearAllTimers(guildId) {
  clearEmptyChannelTimer(guildId);
  clearIdleTimer(guildId);
}

module.exports = {
  scheduleIdleLeave,
  scheduleEmptyChannelLeave,
  handleVoiceStateUpdate,
  clearEmptyChannelTimer,
  clearIdleTimer,
  clearAllTimers,
};
