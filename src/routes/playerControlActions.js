const { REROLL_FAILURES } = require('../music/autoplay');
const { applySound, getSoundState, normalizePreset, resetSound } = require('../music/sound');

// Playback controls. Returning without a response lets the router refresh and save the player.
function createControlActions({
  client,
  savePlayerState,
  clearAutoplayState,
  markPlayerStopping,
  clearVoiceTrackStatus,
  recordAutoplaySkip,
  clearVoteSkip,
  handleAutoplay,
  handleSkipRequest,
  getRequestUser,
  setAutoplay,
  likeTrack,
  dislikeTrack,
  undislikeTrack,
  rerollNext,
  isTrackSeekable,
  seekTrack,
  isUnseekableTrackError,
  broadcastPlayerUpdate,
  library,
}) {
  const actions = {
    async pause({ player }) {
      if (!player.paused) await player.pause();
    },
    async resume({ player }) {
      if (player.paused) await player.resume();
    },
    async toggle({ player }) {
      if (player.paused) await player.resume();
      else await player.pause();
    },
    async library_like({ req, res, guildId, player }) {
      // The heart is the listener's own library Liked list.
      if (!library) return res.status(503).json({ error: 'The library is not available' });
      const result = library.toggleLiked(getRequestUser(req)?.id, player.queue.current);
      if (!result) return res.status(409).json({ error: 'This track cannot be saved.' });
      broadcastPlayerUpdate(guildId);
      return res.json({ success: true, liked: result.liked });
    },
    async autoplay_like({ req, res, player }) {
      // The badge like only steers the listener's own autoplay.
      const result = likeTrack(getRequestUser(req)?.id, player.queue.current);
      if (!result) return res.status(409).json({ error: 'This track cannot be liked.' });
      await client.musicUI?.refresh(player).catch(() => {});
      return res.json({ success: true, liked: result.liked });
    },
    async autoplay_reroll({ res, player }) {
      const result = await rerollNext(player, client);
      if (!result.ok) return res.status(409).json({ error: REROLL_FAILURES[result.reason] ?? 'Could not reroll.', reason: result.reason });
      await client.musicUI?.refresh(player).catch(() => {});
      return res.json({ success: true });
    },
    // A dislike only steers autoplay and does not skip. Pressing it again takes it back.
    async autoplay_dislike({ req, res, guildId, player }) {
      const userId = getRequestUser(req)?.id;
      if (undislikeTrack(userId, player.queue.current)) {
        broadcastPlayerUpdate(guildId);
        return res.json({ success: true, disliked: false });
      }
      if (!dislikeTrack(guildId, userId, player.queue.current)) return res.status(409).json({ error: 'This track cannot be disliked.' });
      broadcastPlayerUpdate(guildId);
      return res.json({ success: true, disliked: true });
    },
    async skip({ req, res, guildId, guild, player, guildConfig, member, privileged }) {
      if (privileged) {
        const currentTrack = player.queue.current;
        recordAutoplaySkip(guildId, currentTrack, { position: player.position });
        await clearVoteSkip(guildId);
        if (player.queue.tracks.length === 0 && player.queue.current) {
          await player.stopPlaying(false, false);
          if (guildConfig.autoplay && currentTrack) await handleAutoplay(player, currentTrack, client);
        } else await player.skip();
      } else {
        const result = await handleSkipRequest({ member, guild, user: { id: getRequestUser(req).id } }, player, guildConfig, client);
        if (result.needsAutoplay && result.lastTrack) await handleAutoplay(player, result.lastTrack, client);
        broadcastPlayerUpdate(guildId);
        return res.json({ success: true, skipped: result.skipped, message: result.message, voteSkip: result.vote || null });
      }
    },
    async stop({ res, guildId, player }) {
      clearAutoplayState(guildId);
      markPlayerStopping(player);
      await clearVoiceTrackStatus(client, player);
      await player.stopPlaying(true);
      player.queue.tracks.splice(0, player.queue.tracks.length);
      await player.destroy('Stopped via dashboard', true);
      await client.musicUI?.clear(guildId).catch(() => {});
      return res.json({ success: true, stopped: true });
    },
    async clearqueue({ res, player }) {
      const removed = player.queue.tracks.length;
      if (removed > 0) player.queue.tracks.splice(0, removed);
      await client.musicUI?.refresh(player).catch(() => {});
      await savePlayerState(player).catch(() => {});
      return res.json({ success: true, removed });
    },
    async shuffle({ player }) {
      if (player.queue.tracks.length > 0) await player.queue.shuffle();
    },
    async loop({ res, player }) {
      const order = ['off', 'track', 'queue'];
      const current = order.indexOf(player.repeatMode ?? 'off');
      const next = order[(current + 1) % order.length];
      await player.setRepeatMode(next);
      await client.musicUI?.refresh(player).catch(() => {});
      return res.json({ success: true, repeatMode: next });
    },
    async back({ res, player }) {
      const previous = await player.queue.shiftPrevious();
      if (!previous) return res.status(404).json({ error: 'No previous tracks' });
      await player.play({ clientTrack: previous });
      await client.musicUI?.refresh(player).catch(() => {});
    },
    async volume({ req, res, player, guildConfig }) {
      const volume = parseInt(req.body.volume, 10);
      if (isNaN(volume) || volume < 0 || volume > 500) return res.status(400).json({ error: 'Invalid volume value' });
      const clamped = Math.min(guildConfig.maxVolume, Math.max(0, volume));
      await player.setVolume(clamped);
      await client.musicUI?.refresh(player).catch(() => {});
      return res.json({ success: true, volume: clamped });
    },
    async filter({ req, res, player }) {
      const preset = typeof req.body?.preset === 'string' ? req.body.preset.toLowerCase() : '';
      if (!preset) return res.status(400).json({ error: 'preset is required' });
      if (preset === 'clear' || preset === 'off' || preset === 'none') {
        const sound = await resetSound(player);
        await client.musicUI?.refresh(player).catch(() => {});
        await savePlayerState(player).catch(() => {});
        return res.json({ success: true, filter: null, sound });
      }
      if (!normalizePreset(preset)) return res.status(400).json({ error: 'Unknown filter preset' });
      const sound = await applySound(player, { ...getSoundState(player), preset });
      await client.musicUI?.refresh(player).catch(() => {});
      await savePlayerState(player).catch(() => {});
      return res.json({ success: true, filter: preset, sound });
    },
    async sound({ req, res, player }) {
      const body = req.body?.sound;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'sound is required' });
      }
      if (body.preset != null && !normalizePreset(body.preset)) {
        return res.status(400).json({ error: 'Unknown filter preset' });
      }
      const sound = await applySound(player, { ...getSoundState(player), ...body });
      await client.musicUI?.refresh(player).catch(() => {});
      await savePlayerState(player).catch(() => {});
      return res.json({ success: true, filter: sound.preset, sound });
    },
    async autoplay({ req, res, guildId, player, guildConfig }) {
      const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !Boolean(guildConfig.autoplay);
      setAutoplay(guildId, enabled);
      await client.musicUI?.refresh(player).catch(() => {});
      return res.json({ success: true, autoplay: enabled });
    },
    async remove({ req, res, player }) {
      const start = parseInt(req.body.start, 10);
      const end = req.body.end != null ? parseInt(req.body.end, 10) : start;
      if (isNaN(start) || isNaN(end) || start < 0 || end < start || end >= player.queue.tracks.length) return res.status(400).json({ error: 'Invalid range' });
      const count = end - start + 1;
      player.queue.tracks.splice(start, count);
      await client.musicUI?.refresh(player).catch(() => {});
      return res.json({ success: true, removed: count });
    },
    async seek({ req, res, player }) {
      const position = parseInt(req.body.position, 10);
      if (isNaN(position) || position < 0) return res.status(400).json({ error: 'Invalid position' });
      if (!isTrackSeekable(player.queue.current)) return res.status(409).json({ error: 'This track cannot be seeked.' });
      try {
        await seekTrack(player, position);
      } catch (error) {
        if (isUnseekableTrackError(error)) return res.status(409).json({ error: 'This track cannot be seeked.' });
        throw error;
      }
      return res.json({ success: true, position });
    },
    async move({ req, res, player }) {
      const from = parseInt(req.body.from, 10);
      const to = parseInt(req.body.to, 10);
      if (isNaN(from) || isNaN(to) || from < 0 || to < 0 || from >= player.queue.tracks.length || to >= player.queue.tracks.length) return res.status(400).json({ error: 'Invalid index' });
      const removed = player.queue.tracks.splice(from, 1)[0];
      player.queue.tracks.splice(to, 0, removed);
      await client.musicUI?.refresh(player).catch(() => {});
      return res.json({ success: true });
    },
  };
  return actions;
}

module.exports = { createControlActions };
