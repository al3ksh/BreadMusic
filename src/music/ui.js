const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { buildNowPlayingEmbed } = require('./embeds');
const { buildPlaybackErrorEmbed, buildReplacementEmbed } = require('./playbackErrors');
const { isAutoplayEnabled, getAutoplayNext } = require('./autoplay');
const { isStreamTrack } = require('./autoplay/normalize');
const { playerEmoji } = require('./playerEmojis');

const BUTTON_PREFIX = 'music';
const PLAYBACK_ERROR_TTL_MS = 30_000;
const AUTOPLAY_NOTICE_COLOR = '#f59e0b';
const AUTOPLAY_REFRESH_DELAY_MS = 750;
const BUTTONS = {
  PLAY_PAUSE: 'playpause',
  SKIP: 'skip',
  STOP: 'stop',
  LOOP: 'loop',
  SHUFFLE: 'shuffle',
  BACK: 'back',
  LYRICS: 'lyrics',
  ACTIVITY: 'activity',
  LIKE: 'like',
  DISLIKE: 'dislike',
  REROLL: 'reroll',
};

const FALLBACK_EMOJI = {
  play: '▶️',
  pause: '⏸️',
  skip: '⏭️',
  stop: '⏹️',
  previous: '⏮️',
  loop: '🔁',
  shuffle: '🔀',
  lyrics: '📖',
  dashboard: '🎵',
  like: '👍',
  dislike: '👎',
  reroll: '🎲',
};

// Resolved per render: the uploaded icons arrive after login.
function icon(name) {
  return playerEmoji(name, FALLBACK_EMOJI[name]);
}

class MusicUI {
  constructor(client) {
    this.client = client;
    this.messages = new Map(); 
    this.locks = new Map(); // guildId -> Promise (mutex to prevent race conditions)
    this.autoplayRefreshTimers = new Map();
  }

  buildNowPlayingPayload(player, track) {
    return {
      embeds: [buildNowPlayingEmbed(player, track)],
      components: track ? this.buildControlRows(player) : [],
    };
  }

  buildControlRows(player) {
    const disabled = !player.queue.current;
    const pauseEmoji = icon(player.paused ? 'play' : 'pause');
    const pauseStyle = player.paused ? ButtonStyle.Success : ButtonStyle.Danger;
    const loopStyle =
      player.repeatMode && player.repeatMode !== 'off'
        ? ButtonStyle.Primary
        : ButtonStyle.Secondary;

    const rowOne = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.BACK, player.guildId))
        .setEmoji(icon('previous'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.PLAY_PAUSE, player.guildId))
        .setEmoji(pauseEmoji)
        .setStyle(pauseStyle)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.SKIP, player.guildId))
        .setEmoji(icon('skip'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.STOP, player.guildId))
        .setEmoji(icon('stop'))
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    );

    const rowTwo = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.LOOP, player.guildId))
        .setEmoji(icon('loop'))
        .setStyle(loopStyle)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.SHUFFLE, player.guildId))
        .setEmoji(icon('shuffle'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || player.queue.tracks.length === 0),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.LYRICS, player.guildId))
        .setEmoji(icon('lyrics'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.ACTIVITY, player.guildId))
        .setEmoji(icon('dashboard'))
        .setStyle(ButtonStyle.Secondary),
    );

    const rows = [rowOne, rowTwo];
    // Autoplay feedback only appears while autoplay is on, so the player stays two rows otherwise.
    if (!disabled && isAutoplayEnabled(player.guildId) && !isStreamTrack(player.queue.current)) {
      const canReroll = player.queue.tracks.length === 0 && Boolean(getAutoplayNext(player.guildId));
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(this.buildCustomId(BUTTONS.LIKE, player.guildId))
          .setEmoji(icon('like'))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(this.buildCustomId(BUTTONS.DISLIKE, player.guildId))
          .setEmoji(icon('dislike'))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(this.buildCustomId(BUTTONS.REROLL, player.guildId))
          .setEmoji(icon('reroll'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!canReroll),
      ));
    }
    return rows;
  }

  buildCustomId(action, guildId) {
    return `${BUTTON_PREFIX}:${action}:${guildId}`;
  }

  async sendNowPlaying(player, track) {
    const payload = this.buildNowPlayingPayload(player, track);
    const trackId = track?.info?.identifier ?? null;
    await this.withLock(player.guildId, () => this.upsertMessage(player, payload, trackId));
  }

  async refresh(player) {
    const payload = this.buildNowPlayingPayload(player, player.queue.current);
    const trackId = player.queue.current?.info?.identifier ?? null;
    await this.withLock(player.guildId, () => this.upsertMessage(player, payload, trackId));
  }

  // The prepared autoplay track changes in bursts; only edit the message that already shows
  // the current track, never post a new one from here.
  scheduleAutoplayRefresh(player) {
    const guildId = player?.guildId;
    if (!guildId || this.autoplayRefreshTimers.has(guildId)) return;
    const timeout = setTimeout(() => {
      this.autoplayRefreshTimers.delete(guildId);
      const record = this.messages.get(guildId);
      const trackId = player.queue.current?.info?.identifier ?? null;
      if (!record || !trackId || record.trackId !== trackId) return;
      this.refresh(player).catch(() => {});
    }, AUTOPLAY_REFRESH_DELAY_MS);
    timeout.unref?.();
    this.autoplayRefreshTimers.set(guildId, timeout);
  }

  async sendPlaybackError(player, track, payload) {
    const channelId = player?.textChannelId;
    if (!channelId) return;

    const channel =
      this.client.channels.cache.get(channelId) ??
      await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const { embed } = buildPlaybackErrorEmbed(track, payload);
    try {
      const message = await channel.send({ embeds: [embed] });
      const timeout = setTimeout(() => {
        message.delete().catch((error) => {
          if (error.code !== 10008) {
            console.warn('Failed to delete playback error message:', error.message);
          }
        });
      }, PLAYBACK_ERROR_TTL_MS);
      timeout.unref?.();
    } catch (error) {
      console.error('Failed to send playback error message:', error);
    }
  }

  async sendReplacementNotice(player, failedTrack, replacement) {
    const channelId = player?.textChannelId;
    if (!channelId) return;

    const channel =
      this.client.channels.cache.get(channelId) ??
      await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const embed = buildReplacementEmbed(failedTrack, replacement);
    try {
      const message = await channel.send({ embeds: [embed] });
      const timeout = setTimeout(() => {
        message.delete().catch((error) => {
          if (error.code !== 10008) {
            console.warn('Failed to delete replacement notice:', error.message);
          }
        });
      }, PLAYBACK_ERROR_TTL_MS);
      timeout.unref?.();
    } catch (error) {
      console.error('Failed to send replacement notice:', error);
    }
  }

  async sendAutoplayNotice(player, message) {
    const channelId = player?.textChannelId;
    if (!channelId || !message) return;

    const channel =
      this.client.channels.cache.get(channelId) ??
      await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setDescription(`📻 ${message}`)
      .setColor(AUTOPLAY_NOTICE_COLOR);
    try {
      const sent = await channel.send({ embeds: [embed] });
      const timeout = setTimeout(() => {
        sent.delete().catch((error) => {
          if (error.code !== 10008) {
            console.warn('Failed to delete autoplay notice:', error.message);
          }
        });
      }, PLAYBACK_ERROR_TTL_MS);
      timeout.unref?.();
    } catch (error) {
      console.error('Failed to send autoplay notice:', error);
    }
  }

  async withLock(guildId, fn) {
    const existing = this.locks.get(guildId);
    if (existing) {
      await existing.catch(() => {});
    }
    
    const promise = fn();
    this.locks.set(guildId, promise);
    
    try {
      return await promise;
    } finally {
      if (this.locks.get(guildId) === promise) {
        this.locks.delete(guildId);
      }
    }
  }

  async upsertMessage(player, payload, trackId) {
    const guildId = player.guildId;
    const record = this.messages.get(guildId);
    const existing = record?.message;
    const sameChannel = existing && existing.channelId === player.textChannelId;

    if (existing && sameChannel && record.trackId === trackId) {
      try {
        await existing.edit(payload);
        return;
      } catch (error) {
        if (error.code !== 10008 && error.code !== 50083) {
          console.error('Failed to edit now-playing message:', error);
          return;
        }
        this.messages.delete(guildId);
      }
    }

    const channelId = player.textChannelId;
    if (!channelId) return;

    const channel = this.client.channels.cache.get(channelId) ??
      await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    if (existing) {
      try {
        await existing.delete();
      } catch (error) {
        if (error.code !== 10008) {
          console.error('Failed to delete previous now-playing message:', error);
        }
      }
      this.messages.delete(guildId);
    }

    try {
      const message = await channel.send(payload);
      this.messages.set(guildId, { message, trackId });
    } catch (error) {
      console.error('Failed to send now-playing embed:', error);
    }
  }

  async clear(guildId) {
    await this.withLock(guildId, async () => {
      const record = this.messages.get(guildId);
      if (record?.message) {
        try {
          await record.message.delete();
        } catch (error) {
          if (error.code !== 10008) {
            console.error('Failed to clear now-playing message:', error);
          }
        }
      }
      this.messages.delete(guildId);
    });
  }
}

module.exports = {
  MusicUI,
  BUTTONS,
  BUTTON_PREFIX,
};

