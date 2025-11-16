const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildNowPlayingEmbed } = require('./embeds');

const BUTTON_PREFIX = 'music';
const BUTTONS = {
  PLAY_PAUSE: 'playpause',
  SKIP: 'skip',
  STOP: 'stop',
  LOOP: 'loop',
  SHUFFLE: 'shuffle',
  BACK: 'back',
};

const EMOJI = {
  PLAY: '\u25B6\uFE0F',
  PAUSE: '\u23F8\uFE0F',
  SKIP: '\u23ED\uFE0F',
  STOP: '\u23F9\uFE0F',
  PREVIOUS: '\u23EE\uFE0F',
  LOOP: '\uD83D\uDD01',
  SHUFFLE: '\uD83D\uDD00',
};

class MusicUI {
  constructor(client) {
    this.client = client;
    this.messages = new Map(); // guildId -> { message, trackId }
  }

  buildNowPlayingPayload(player, track) {
    return {
      embeds: [buildNowPlayingEmbed(player, track)],
      components: track ? this.buildControlRows(player) : [],
    };
  }

  buildControlRows(player) {
    const disabled = !player.queue.current;
    const pauseLabel = player.paused ? 'Resume' : 'Pause';
    const pauseEmoji = player.paused ? EMOJI.PLAY : EMOJI.PAUSE;
    const loopStyle =
      player.repeatMode && player.repeatMode !== 'off'
        ? ButtonStyle.Success
        : ButtonStyle.Secondary;

    const rowOne = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.PLAY_PAUSE, player.guildId))
        .setEmoji(pauseEmoji)
        .setLabel(pauseLabel)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.SKIP, player.guildId))
        .setEmoji(EMOJI.SKIP)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.STOP, player.guildId))
        .setEmoji(EMOJI.STOP)
        .setLabel('Stop')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    );

    const rowTwo = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.BACK, player.guildId))
        .setEmoji(EMOJI.PREVIOUS)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.LOOP, player.guildId))
        .setEmoji(EMOJI.LOOP)
        .setLabel('Loop')
        .setStyle(loopStyle)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(this.buildCustomId(BUTTONS.SHUFFLE, player.guildId))
        .setEmoji(EMOJI.SHUFFLE)
        .setLabel('Shuffle')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || player.queue.tracks.length === 0),
    );

    return [rowOne, rowTwo];
  }

  buildCustomId(action, guildId) {
    return `${BUTTON_PREFIX}:${action}:${guildId}`;
  }

  async sendNowPlaying(player, track) {
    const payload = this.buildNowPlayingPayload(player, track);
    const trackId = track?.info?.identifier ?? null;
    await this.upsertMessage(player, payload, trackId, true);
  }

  async refresh(player) {
    const payload = this.buildNowPlayingPayload(player, player.queue.current);
    const trackId = player.queue.current?.info?.identifier ?? null;
    await this.upsertMessage(player, payload, trackId, false);
  }

  async upsertMessage(player, payload, trackId, allowChannelChange) {
    const record = this.messages.get(player.guildId);
    const existing = record?.message;
    const sameChannel = existing && existing.channelId === player.textChannelId;

    if (existing && sameChannel && record.trackId === trackId) {
      try {
        await existing.edit(payload);
        record.trackId = trackId;
        return;
      } catch (error) {
        if (error.code !== 10008 && error.code !== 50083) {
          console.error('Failed to edit now-playing message:', error);
          return;
        }
        this.messages.delete(player.guildId);
      }
    }

    if (!allowChannelChange && existing && sameChannel) {
      return;
    }

    const channelId = player.textChannelId;
    if (!channelId) return;

    const channel = this.client.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return;

    const previous = this.messages.get(player.guildId);
    if (previous?.message) {
      try {
        await previous.message.delete();
      } catch (error) {
        if (error.code !== 10008) {
          console.error('Failed to delete previous now-playing message:', error);
        }
      }
    }

    try {
      const message = await channel.send(payload);
      this.messages.set(player.guildId, { message, trackId });
    } catch (error) {
      console.error('Failed to send now-playing embed:', error);
    }
  }

  async clear(guildId) {
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
  }
}

module.exports = {
  MusicUI,
  BUTTONS,
  BUTTON_PREFIX,
};

