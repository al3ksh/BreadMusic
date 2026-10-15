const { MessageFlags } = require('discord.js');
const { CommandError, ensurePlayer } = require('./utils');
const { BUTTONS } = require('./ui');
const { handleSkipRequest, clearVoteSkip, getTrackKey, getTrackToken } = require('./skipManager');
const { markPlayerStopping } = require('./playerLifecycle');
const { savePlayerState } = require('../state/queueStore');
const { withGuildMutex } = require('./guildMutex');
const { getConfig, assertDJ, canActAsDJ } = require('../state/guildConfig');
const { buildQueueEmbed, buildQueueComponents } = require('./queueFormatter');
const {
  handleAutoplay,
  clearAutoplayState,
  likeTrack,
  dislikeTrack,
  undislikeTrack,
  rerollNext,
  REROLL_FAILURES,
} = require('./autoplay');
const { toggleLiked } = require('./library');
const { clearVoiceTrackStatus } = require('./voiceStatus');

// Buttons on the player, queue and vote-skip messages.
function createMusicButtons({ client, broadcastPlayerUpdate }) {
  async function handleMusicButton(interaction) {
    const [, action, guildId] = interaction.customId.split(':');
    if (!guildId || guildId !== interaction.guildId) {
      await interaction.reply({ content: 'Invalid button.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (action === BUTTONS.ACTIVITY) {
      await interaction.launchActivity();
      return;
    }

    const handlers = {
      [BUTTONS.PLAY_PAUSE]: togglePlayPause,
      [BUTTONS.SKIP]: skipTrack,
      [BUTTONS.STOP]: stopPlayback,
      [BUTTONS.BACK]: playPrevious,
      [BUTTONS.LOOP]: toggleLoop,
      [BUTTONS.SHUFFLE]: shuffleQueue,
      [BUTTONS.LYRICS]: showLyrics,
      [BUTTONS.HEART]: heartCurrent,
      [BUTTONS.LIKE]: likeCurrent,
      [BUTTONS.DISLIKE]: dislikeCurrent,
      [BUTTONS.REROLL]: rerollAutoplay,
    };

    const handler = handlers[action];
    if (!handler) return;
    await handler(interaction);
  }

  async function handleQueueButton(interaction) {
    const [, action, guildId, pageString, ownerId] = interaction.customId.split(':');
    if (ownerId && ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the author can use this pagination.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const page = Number(pageString ?? '0');
    const direction = action === 'next' ? 1 : -1;

    const { player } = await ensurePlayer(interaction, { allowCreate: false });
    const nextPage = Math.max(0, page + direction);
    const pageData = buildQueueEmbed(player, nextPage);

    await interaction.update({
      embeds: [pageData.embed],
      components: buildQueueComponents(guildId, nextPage, pageData.totalPages, ownerId ?? interaction.user.id),
    }).catch(() => {});
  }

  async function togglePlayPause(interaction) {
    const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
    assertDJ(interaction, config);
    await interaction.deferUpdate();
    if (player.paused) await player.resume();
    else await player.pause();
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);
  }

  async function skipTrack(interaction) {
    const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
    await interaction.deferUpdate();
    if (player.repeatMode === 'track' && canControlPlayer(interaction, config)) {
      const restarted = await restartCurrent(player);
      if (!restarted) {
        await interaction
          .followUp({ content: 'Nothing is playing to restart.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
      return;
    }
    const result = await withGuildMutex(interaction.guildId, () =>
      handleSkipRequest(interaction, player, config, client),
    );
    broadcastPlayerUpdate(interaction.guildId);
    if (result.skipped) {
      if (result.needsAutoplay && result.lastTrack) {
        await handleAutoplay(player, result.lastTrack, client);
      }
      await savePlayerState(player).catch(() => {});
    } else {
      await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  // The heart saves the track to the listener's own Liked list, so only they see the confirmation.
  async function heartCurrent(interaction) {
    const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
    const track = player.queue.current;
    const result = toggleLiked(interaction.user.id, track);
    if (!result) throw new CommandError('This track cannot be saved.');
    broadcastPlayerUpdate(interaction.guildId);
    await interaction.reply({
      content: result.liked ? `Saved **${track.info.title}** to your Library.` : `Removed **${track.info.title}** from your Library.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Autoplay likes and dislikes are the listener's own and only steer autoplay.
  async function likeCurrent(interaction) {
    const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
    const track = player.queue.current;
    const result = likeTrack(interaction.user.id, track);
    if (!result) throw new CommandError('This track cannot be liked.');
    broadcastPlayerUpdate(interaction.guildId);
    await interaction.reply({
      content: result.liked ? `👍 Liked **${track.info.title}**. Autoplay will pick more like it.` : `Removed your like from **${track.info.title}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // The dislike does not skip, that is the skip button's job. Pressing it again takes it back.
  async function dislikeCurrent(interaction) {
    const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
    const track = player.queue.current;
    if (undislikeTrack(interaction.user.id, track)) {
      broadcastPlayerUpdate(interaction.guildId);
      await interaction.reply({ content: `Removed your dislike from **${track.info.title}**.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!dislikeTrack(interaction.guildId, interaction.user.id, track)) {
      throw new CommandError('This track cannot be disliked.');
    }
    broadcastPlayerUpdate(interaction.guildId);
    await interaction.reply({
      content: `👎 Disliked **${track.info.title}**. Autoplay will steer clear of it.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  async function rerollAutoplay(interaction) {
    const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
    await interaction.deferUpdate();
    const result = await rerollNext(player, client);
    if (!result.ok) {
      await interaction
        .followUp({ content: REROLL_FAILURES[result.reason] ?? 'Could not reroll.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    broadcastPlayerUpdate(interaction.guildId);
    await client.musicUI.refresh(player);
  }

  async function stopPlayback(interaction) {
    const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
    assertDJ(interaction, config);
    await interaction.deferUpdate();
    clearAutoplayState(player.guildId);
    markPlayerStopping(player);
    await clearVoiceTrackStatus(client, player);
    await player.stopPlaying(true);
    player.queue.tracks.splice(0, player.queue.tracks.length);
    await player.destroy('Stopped via UI', true);
    await savePlayerState(player).catch(() => {});
    await client.musicUI.clear(player.guildId);
  }

  async function playPrevious(interaction) {
    const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
    assertDJ(interaction, config);
    await interaction.deferUpdate();
    if (player.repeatMode === 'track') {
      const restarted = await restartCurrent(player);
      if (!restarted) {
        await interaction
          .followUp({ content: 'Nothing is playing to restart.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
      return;
    }
    const current = player.queue.current;
    const previous = await player.queue.shiftPrevious();
    if (!previous) {
      await interaction.followUp({ content: 'No previous track.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (current) {
      await player.queue.add(current, 0);
    }
    await player.play({ clientTrack: previous });
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);
  }

  async function toggleLoop(interaction) {
    const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
    assertDJ(interaction, config);
    await interaction.deferUpdate();
    const order = ['off', 'track', 'queue'];
    const currentIndex = order.indexOf(player.repeatMode ?? 'off');
    const nextMode = order[(currentIndex + 1) % order.length];
    await player.setRepeatMode(nextMode);
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);
  }

  async function shuffleQueue(interaction) {
    const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
    assertDJ(interaction, config);
    await interaction.deferUpdate();
    if (player.queue.tracks.length === 0) {
      await interaction.followUp({ content: 'No tracks to shuffle.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    await player.queue.shuffle();
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);
  }

  async function handleVoteSkipButton(interaction) {
    const [, guildId, trackToken] = interaction.customId.split(':');
    if (!guildId || guildId !== interaction.guildId) {
      await interaction.reply({ content: 'This vote is no longer valid.', flags: MessageFlags.Ephemeral });
      return;
    }

    const player = client.lavalink?.getPlayer(guildId);
    if (!player?.queue?.current || getTrackToken(getTrackKey(player.queue.current)) !== trackToken) {
      await interaction.reply({ content: 'This track is no longer playing.', flags: MessageFlags.Ephemeral });
      await clearVoteSkip(guildId);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = getConfig(guildId);
    const result = await withGuildMutex(guildId, () =>
      handleSkipRequest(interaction, player, config, client),
    );
    broadcastPlayerUpdate(guildId);
    if (result.needsAutoplay && result.lastTrack) {
      await handleAutoplay(player, result.lastTrack, client);
    }
    if (result.skipped) await savePlayerState(player).catch(() => {});
    await interaction.editReply(result.message);
  }

  async function showLyrics(interaction) {
    const { player } = await ensurePlayer(interaction, { allowCreate: false });
    const track = player.queue.current;
    if (!track) {
      throw new CommandError('Nothing is playing.');
    }
    await client.lyricsUI.send(interaction, player, track);
  }

  async function restartCurrent(player) {
    const current = player.queue.current;
    if (!current) return false;
    await player.play({ clientTrack: current, startTime: 0 });
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);
    return true;
  }

  function canControlPlayer(interaction, guildConfig) {
    return canActAsDJ(interaction.member, guildConfig);
  }

  return { handleMusicButton, handleQueueButton, handleVoteSkipButton };
}

module.exports = { createMusicButtons };
