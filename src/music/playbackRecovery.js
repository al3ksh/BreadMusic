function createPlaybackRecovery({
  recoverySet,
  isPlayerStopping,
  sendPlaybackError,
  handleAutoplay,
  clearVoiceTrackStatus,
  refreshPlayer,
  scheduleIdleLeave,
  broadcastPlayerUpdate,
  onError = (error, label, guildId) => console.error(`[${label}] Failed to recover guild ${guildId}:`, error),
}) {
  if (!(recoverySet instanceof Set)) {
    throw new TypeError('recoverySet must be a Set');
  }

  return async function recoverPlaybackFailure({ player, track, payload, label = 'Playback' }) {
    const guildId = player?.guildId;
    if (!guildId || isPlayerStopping(player) || recoverySet.has(guildId)) return false;

    recoverySet.add(guildId);
    try {
      await Promise.resolve(sendPlaybackError(player, track, payload)).catch((error) => {
        console.warn(`[${label}] Failed to send playback error for guild ${guildId}:`, error.message);
      });

      if (player.queue?.tracks?.length > 0) {
        await player.skip();
        return true;
      }

      await player.stopPlaying(false, false);
      const recovered = await handleAutoplay(player, track);
      if (!recovered) {
        await clearVoiceTrackStatus(player);
        await refreshPlayer(player);
        scheduleIdleLeave(player);
      }
      return true;
    } catch (error) {
      onError(error, label, guildId);
      return false;
    } finally {
      recoverySet.delete(guildId);
      broadcastPlayerUpdate(guildId);
    }
  };
}

module.exports = { createPlaybackRecovery };
