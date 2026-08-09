const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { CommandError } = require('../utils/commandError');
const { BRAND_COLORS } = require('../theme');
const {
  findActiveLyricIndex,
  findLyrics,
  LyricsProviderError,
  parseSyncedLyrics,
  trackToLyricsQuery,
} = require('./lyrics');

const LIVE_LYRICS_BUTTON_PREFIX = 'lyricslive:';
const CLOSE_LYRICS_BUTTON_PREFIX = 'lyricsclose:';
const PAGE_LYRICS_BUTTON_PREFIX = 'lyricspage:';
const LIVE_LYRICS_POLL_MS = 500;
const LYRICS_PAGE_MAX_LENGTH = 3600;
const LYRICS_DOCUMENT_TTL_MS = 60 * 60 * 1000;
const LYRICS_DOCUMENT_MAX_ENTRIES = 100;

function buildLyricsControls(document, options = {}) {
  const components = [];
  if (document.pages.length > 1 && !options.active) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`${PAGE_LYRICS_BUTTON_PREFIX}previous:${document.guildId}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(document.currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`${PAGE_LYRICS_BUTTON_PREFIX}next:${document.guildId}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(document.currentPage >= document.pages.length - 1),
    );
  }
  components.push(
    new ButtonBuilder()
      .setCustomId(`${LIVE_LYRICS_BUTTON_PREFIX}${document.guildId}`)
      .setLabel(options.active ? 'Stop live' : 'Live')
      .setStyle(options.active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(Boolean(options.disabled)),
    new ButtonBuilder()
      .setCustomId(`${CLOSE_LYRICS_BUTTON_PREFIX}${document.guildId}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger),
  );
  return new ActionRowBuilder().addComponents(components);
}

function getLyricsBody(lyrics) {
  return lyrics.instrumental
    ? '*This track is marked as instrumental.*'
    : lyrics.plainLyrics || lyrics.syncedLyrics.replace(/^\[[^\]]+]\s*/gm, '');
}

function paginateLyrics(body, maxLength = LYRICS_PAGE_MAX_LENGTH) {
  const pages = [];
  let current = '';

  for (const line of String(body || '').split('\n')) {
    const chunks = [];
    if (line.length <= maxLength) {
      chunks.push(line);
    } else {
      for (let index = 0; index < line.length; index += maxLength) {
        chunks.push(line.slice(index, index + maxLength));
      }
    }

    for (const chunk of chunks) {
      const candidate = current ? `${current}\n${chunk}` : chunk;
      if (candidate.length > maxLength && current) {
        pages.push(current);
        current = chunk;
      } else {
        current = candidate;
      }
    }
  }

  if (current || pages.length === 0) pages.push(current || '*Lyrics are empty.*');
  return pages;
}

function buildFullLyricsEmbed(lyrics, options = {}) {
  const pages = options.pages || paginateLyrics(getLyricsBody(lyrics));
  const pageIndex = Math.min(Math.max(options.pageIndex || 0, 0), pages.length - 1);
  const pageLabel = pages.length > 1 ? `Page ${pageIndex + 1}/${pages.length} · ` : '';

  return new EmbedBuilder()
    .setTitle(lyrics.title)
    .setAuthor({ name: lyrics.artist })
    .setDescription(pages[pageIndex])
    .setColor(BRAND_COLORS.primary)
    .setFooter({ text: `${pageLabel}Lyrics provided by ${lyrics.provider}` });
}

function buildLiveLyricsEmbed(lyrics, lines, activeIndex) {
  const beforeFirstLine = activeIndex < 0;
  const previous = beforeFirstLine ? '...' : lines[activeIndex - 1]?.text || '...';
  const current = beforeFirstLine ? '...' : lines[activeIndex]?.text || '...';
  const next = beforeFirstLine ? lines[0]?.text || '...' : lines[activeIndex + 1]?.text || '...';

  return new EmbedBuilder()
    .setTitle(lyrics.title)
    .setAuthor({ name: lyrics.artist })
    .setDescription(`*${previous}*\n**${current}**\n*${next}*`)
    .setColor(BRAND_COLORS.primary)
    .setFooter({ text: `Live lyrics provided by ${lyrics.provider}` });
}

function getTrackKey(track) {
  const info = track?.info || {};
  return track?.encoded || [info.identifier, info.title, info.author, info.duration].join('|');
}

async function loadTrackLyrics(track) {
  const query = trackToLyricsQuery(track);
  let lyrics;
  try {
    lyrics = await findLyrics(query);
  } catch (error) {
    if (error instanceof LyricsProviderError) {
      throw new CommandError('The lyrics provider is temporarily unavailable. Try again in a moment.');
    }
    throw error;
  }

  if (!lyrics) {
    throw new CommandError(`Lyrics were not found for **${query.artist} - ${query.title}**.`);
  }
  return lyrics;
}

class LyricsUI {
  constructor(client) {
    this.client = client;
    this.sessions = new Map();
    this.documents = new Map();
  }

  async send(interaction, player, track) {
    await interaction.deferReply();
    const lyrics = await loadTrackLyrics(track);
    await this.present(interaction, lyrics, { guildId: player.guildId, track });
  }

  async present(interaction, lyrics, options = {}) {
    const syncedLines = parseSyncedLyrics(lyrics.syncedLyrics);
    const document = {
      guildId: options.guildId || interaction.guildId,
      trackKey: options.track ? getTrackKey(options.track) : null,
      lyrics,
      syncedLines,
      pages: paginateLyrics(getLyricsBody(lyrics)),
      currentPage: 0,
      expiresAt: Date.now() + LYRICS_DOCUMENT_TTL_MS,
      message: null,
      messageId: null,
    };
    const message = await interaction.editReply(this.buildFullPayload(document));
    document.message = message;
    document.messageId = message.id;
    this.documents.set(message.id, document);
    this.pruneDocuments();
  }

  async toggle(interaction) {
    const guildId = interaction.customId.slice(LIVE_LYRICS_BUTTON_PREFIX.length);
    if (!guildId || guildId !== interaction.guildId) {
      await interaction.reply({ content: 'Invalid lyrics button.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const document = this.getDocument(interaction);
    if (!document) {
      await interaction.reply({ content: 'These lyrics controls have expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const activeSession = this.sessions.get(guildId);
    if (activeSession?.messageId === interaction.message.id) {
      await interaction.deferUpdate();
      await this.stop(guildId, { restore: true });
      return;
    }

    await interaction.deferUpdate();
    const player = this.client.lavalink?.getPlayer(guildId);
    const track = player?.queue?.current;
    if (!track || getTrackKey(track) !== document.trackKey) {
      await this.sendPrivateError(interaction, 'This track is no longer playing.');
      return;
    }

    const lines = document.syncedLines;
    if (!lines.length) {
      await this.sendPrivateError(interaction, 'Synced lyrics are not available for this track.');
      return;
    }

    if (activeSession) {
      await this.stop(guildId, { restore: true });
    }

    const session = {
      guildId,
      message: interaction.message,
      messageId: interaction.message.id,
      trackKey: document.trackKey,
      document,
      lyrics: document.lyrics,
      lines,
      lastIndex: null,
      lastObservedPosition: Number(player.paused ? player.lastPosition : player.position) || 0,
      pausedPosition: null,
      updating: false,
      timer: null,
    };
    this.sessions.set(guildId, session);
    await this.tick(session, true);
    if (this.sessions.get(guildId) !== session) return;
    session.timer = setInterval(() => this.tick(session).catch(() => {}), LIVE_LYRICS_POLL_MS);
    session.timer.unref?.();
  }

  async tick(session, force = false) {
    if (session.updating || this.sessions.get(session.guildId) !== session) return;
    const player = this.client.lavalink?.getPlayer(session.guildId);
    const track = player?.queue?.current;
    if (!track || getTrackKey(track) !== session.trackKey) {
      await this.stop(session.guildId, { restore: false });
      return;
    }

    const position = this.resolvePosition(session, player);
    const activeIndex = findActiveLyricIndex(session.lines, position);
    if (!force && activeIndex === session.lastIndex) return;
    session.lastIndex = activeIndex;
    session.updating = true;
    try {
      await session.message.edit({
        embeds: [buildLiveLyricsEmbed(session.lyrics, session.lines, activeIndex)],
        components: [buildLyricsControls(session.document, { active: true })],
      });
    } catch (error) {
      if (error.code !== 10008) console.warn('Failed to update live lyrics:', error.message);
      this.clear(session.guildId);
    } finally {
      session.updating = false;
    }
  }

  resolvePosition(session, player) {
    if (player.paused) {
      if (session.pausedPosition === null) {
        session.pausedPosition = session.lastObservedPosition;
      }
      return session.pausedPosition;
    }

    session.pausedPosition = null;
    session.lastObservedPosition = Number(player.position) || 0;
    return session.lastObservedPosition;
  }

  async close(interaction) {
    const guildId = interaction.customId.slice(CLOSE_LYRICS_BUTTON_PREFIX.length);
    if (!guildId || guildId !== interaction.guildId) {
      await interaction.reply({ content: 'Invalid lyrics button.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const session = this.sessions.get(guildId);
    if (session?.messageId === interaction.message.id) this.clear(guildId);
    this.documents.delete(interaction.message.id);
    await interaction.deferUpdate();
    await interaction.message.delete().catch((error) => {
      if (error.code !== 10008) console.warn('Failed to close lyrics:', error.message);
    });
  }

  async changePage(interaction) {
    const [direction, guildId] = interaction.customId.slice(PAGE_LYRICS_BUTTON_PREFIX.length).split(':');
    if (!['previous', 'next'].includes(direction) || !guildId || guildId !== interaction.guildId) {
      await interaction.reply({ content: 'Invalid lyrics page.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const document = this.getDocument(interaction);
    if (!document) {
      await interaction.reply({ content: 'These lyrics controls have expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    const offset = direction === 'next' ? 1 : -1;
    document.currentPage = Math.min(Math.max(document.currentPage + offset, 0), document.pages.length - 1);
    document.expiresAt = Date.now() + LYRICS_DOCUMENT_TTL_MS;
    await interaction.update(this.buildFullPayload(document));
  }

  async stop(guildId, options = {}) {
    const session = this.sessions.get(guildId);
    if (!session) return;
    this.clear(guildId);

    try {
      if (options.restore) {
        await session.message.edit(this.buildFullPayload(session.document));
      } else {
        const payload = this.buildFullPayload(session.document);
        await session.message.edit({ ...payload, components: [] });
        this.documents.delete(session.messageId);
      }
    } catch (error) {
      if (error.code !== 10008) console.warn('Failed to stop live lyrics:', error.message);
    }
  }

  clear(guildId) {
    const session = this.sessions.get(guildId);
    if (session?.timer) clearInterval(session.timer);
    this.sessions.delete(guildId);
  }

  clearAll() {
    for (const guildId of this.sessions.keys()) this.clear(guildId);
    this.documents.clear();
  }

  buildFullPayload(document) {
    return {
      embeds: [buildFullLyricsEmbed(document.lyrics, {
        pages: document.pages,
        pageIndex: document.currentPage,
      })],
      components: [buildLyricsControls(document, {
        disabled: !document.trackKey || document.syncedLines.length === 0,
      })],
    };
  }

  getDocument(interaction) {
    const document = this.documents.get(interaction.message.id);
    if (!document || document.guildId !== interaction.guildId || document.expiresAt <= Date.now()) {
      if (document) this.documents.delete(interaction.message.id);
      return null;
    }
    return document;
  }

  pruneDocuments() {
    const now = Date.now();
    for (const [messageId, document] of this.documents) {
      if (document.expiresAt <= now) this.documents.delete(messageId);
    }
    const activeMessageIds = new Set([...this.sessions.values()].map((session) => session.messageId));
    while (this.documents.size > LYRICS_DOCUMENT_MAX_ENTRIES) {
      const oldestMessageId = [...this.documents.keys()].find((messageId) => !activeMessageIds.has(messageId));
      if (!oldestMessageId) break;
      this.documents.delete(oldestMessageId);
    }
  }

  async sendPrivateError(interaction, content) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

module.exports = {
  LyricsUI,
  LIVE_LYRICS_BUTTON_PREFIX,
  CLOSE_LYRICS_BUTTON_PREFIX,
  PAGE_LYRICS_BUTTON_PREFIX,
  buildFullLyricsEmbed,
  buildLiveLyricsEmbed,
  paginateLyrics,
};
