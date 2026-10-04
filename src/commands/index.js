const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { ensureVoice, ensurePlayer, CommandError } = require('../music/utils');
const { buildTrackEmbed, buildNowPlayingEmbed } = require('../music/embeds');
const { savePlayerState } = require('../state/queueStore');
const {
  getConfig,
  setConfig,
  deleteConfig,
  assertDJ,
  hasDJPermissions,
  formatConfig,
} = require('../state/guildConfig');
const {
  buildQueueEmbed,
  buildQueueComponents,
} = require('../music/queueFormatter');
const { formatDuration, parseTimecode } = require('../utils/time');
const { cleanTrackTitle } = require('../utils/trackTitles');
const { isTrackSeekable, isUnseekableTrackError, seekTrack } = require('../music/trackCapabilities');
const { getSelection, deleteSelection } = require('../state/searchCache');
const {
  startGame: startBlackjack,
  endGame: endBlackjack,
  buildEmbed: buildBlackjackEmbed,
  buildMessage: buildBlackjackMessage,
  buildComponents: buildBlackjackComponents,
  getGame: getBlackjackGame,
} = require('../games/blackjack');
const {
  getBalance,
  addBalance,
  claimHourly,
  getLeaderboard,
  hasBalance,
  HOURLY_COOLDOWN,
} = require('../games/economy');
const {
  playSlots,
  playRoulette,
  playCoinflip,
  buildSlotsEmbed,
  buildRouletteEmbed,
  buildCoinflipEmbed,
  buildSlotsMessage,
  buildRouletteMessage,
  buildCoinflipMessage,
} = require('../games/gambling');
const {
  playRPS,
  magic8Ball,
  rollDice,
  buildRPSEmbed,
  build8BallEmbed,
  buildDiceEmbed,
  buildRPSMessage,
  build8BallMessage,
  buildDiceMessage,
  buildRPSPrepareMessage,
  buildRPSChoiceComponents,
} = require('../games/fun');
const { applyPreferredSource } = require('../music/searchUtils');
const { buildReplayComponents } = require('../games/arcadeControls');
const { getArcadeStats, recordArcadeGame } = require('../games/arcadeStats');
const { handleSkipRequest } = require('../music/skipManager');
const { markPlayerStopping } = require('../music/playerLifecycle');
const { deleteInteractionReply } = require('../utils/interactions');
const { isAutoplayEnabled, toggleAutoplay, addManualSeed, clearAutoplayState } = require('../music/autoplay');
const { classifyPlaybackError, describeSearchFailure } = require('../music/playbackErrors');
const { clearVoiceTrackStatus, setVoiceTrackStatus } = require('../music/voiceStatus');
const { findLyrics, trackToLyricsQuery, LyricsProviderError } = require('../music/lyrics');
const { BRAND_COLORS } = require('../theme');
const { buildDashboardUrl } = require('../dashboard/url');
const { getGuildInsights, getUserInsights } = require('../state/analyticsStore');
const { withGuildMutex } = require('../music/guildMutex');

function formatStatsDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.round((milliseconds || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${totalMinutes}m`;
}

function formatCompactRankedCounts(items, emptyMessage) {
  if (!items?.length) return emptyMessage;
  return items.map((item) => {
    const name = String(item.name || 'Unknown');
    const label = name.length > 30 ? `${name.slice(0, 27)}...` : name;
    return `**${label}** ${item.count}x`;
  }).join(' \u00b7 ').slice(0, 1024);
}

function formatSourceLabel(value) {
  const source = String(value || 'unknown');
  const normalized = source.replace(/[\s_-]+/g, '').toLowerCase();
  const labels = {
    youtube: 'YouTube',
    spotify: 'Spotify',
    soundcloud: 'SoundCloud',
    deezer: 'Deezer',
    localupload: 'Upload',
    unknown: 'Unknown',
  };
  return labels[normalized] || source.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function formatRankedSources(items, emptyMessage) {
  if (!items?.length) return emptyMessage;
  return items.map((item) => (
    `**${item.rank}.** ${formatSourceLabel(item.name)} \u2014 ${item.count} ${item.count === 1 ? 'play' : 'plays'}`
  )).join('\n').slice(0, 1024);
}

function formatRankedRequesters(items, emptyMessage) {
  if (!items?.length) return emptyMessage;
  return items.map((item) => (
    `**${item.rank}.** ${item.displayName} \u2014 ${item.count} ${item.count === 1 ? 'request' : 'requests'}`
  )).join('\n').slice(0, 1024);
}

function formatRankedTracks(items, emptyMessage) {
  if (!items?.length) return emptyMessage;
  return items.map((item) => {
    const rawTitle = cleanTrackTitle(String(item.title || 'Unknown'));
    const title = rawTitle.length > 48 ? `${rawTitle.slice(0, 45)}...` : rawTitle;
    return `**${item.rank}.** ${title} \u2014 ${item.count}x`;
  }).join('\n').slice(0, 1024);
}

async function queuePersist(player) {
  await savePlayerState(player).catch(() => {});
}

const HELP_CATEGORIES = [
  {
    name: 'Music',
    description: 'Control playback, queue, and sound.',
    commands: [
      { name: '/play', value: 'Play or queue a track/playlist.' },
      { name: '/radio', value: 'Play a live radio station (name, genre, country or link).' },
      { name: '/pause', value: 'Pause playback.' },
      { name: '/resume', value: 'Resume playback.' },
      { name: '/skip', value: 'Skip the track or start/join a listener vote.' },
      { name: '/stop', value: 'Stop playback and clear queue.' },
      { name: '/queue', value: 'Show the queue.' },
      { name: '/nowplaying', value: 'Show current track info.' },
      { name: '/loop', value: 'Set repeat mode (off/track/queue).' },
      { name: '/shuffle', value: 'Shuffle the queue.' },
      { name: '/volume', value: 'Set volume.' },
      { name: '/seek', value: 'Seek to a specific time.' },
      { name: '/sound', value: 'Equalizer, presets, speed and pitch in one panel.' },
      { name: '/history', value: 'Recently played tracks; queue any of them again.' },
      { name: '/leave', value: 'Disconnect the bot.' },
      { name: '/clearqueue', value: 'Clear upcoming tracks.' },
      { name: '/remove', value: 'Remove specific tracks.' },
      { name: '/move', value: 'Move a track in the queue.' },
      { name: '/skipto', value: 'Skip to a specific track.' },
      { name: '/back', value: 'Play previous track.' },
      { name: '/replay', value: 'Replay current track.' },
      { name: '/autoplay', value: 'Toggle autoplay, like, dislike or reroll its picks, or review your dislikes.' },
      { name: '/lyrics', value: 'Show lyrics for the current track or a search.' },
    ],
  },
  {
    name: 'Misc',
    description: 'Configuration and system commands.',
    commands: [
      { name: '/help', value: 'Show this help menu.' },
      { name: '/ping', value: 'Check latency.' },
      { name: '/dashboard', value: 'Open the web dashboard for this server.' },
      { name: '/stats', value: 'Show listening or Arcade statistics.' },
      { name: '/config', value: 'Manage guild settings (or use the dashboard).' },
    ],
  },
  {
    name: 'Arcade',
    description: 'Arcade games and casual commands.',
    commands: [
      { name: '/blackjack', value: 'Play blackjack (bet optional).' },
      { name: '/slots', value: 'Spin the slot machine.' },
      { name: '/roulette', value: 'Spin the roulette wheel.' },
      { name: '/coinflip', value: 'Flip a coin.' },
      { name: '/rps', value: 'Rock, paper, scissors.' },
      { name: '/8ball', value: 'Ask the magic 8-ball.' },
      { name: '/roll', value: 'Roll dice.' },
    ],
  },
  {
    name: 'Economy',
    description: 'Currency and leaderboards.',
    commands: [
      { name: '/hourly', value: 'Claim hourly reward.' },
      { name: '/balance', value: 'Check your balance.' },
      { name: '/leaderboard', value: 'See top earners.' },
    ],
  },
];

const HELP_PAGE_COUNT = HELP_CATEGORIES.length + 1;

function buildHelpEmbed(pageIndex, options = {}) {
  if (pageIndex === 0) {
    const embed = new EmbedBuilder()
      .setTitle('Bread is easier to use now')
      .setDescription('Bread now includes a web dashboard and a Discord Activity for simpler music playback and control.')
      .setColor(BRAND_COLORS.primary)
      .addFields(
        {
          name: '\u{1F310} Web Dashboard',
          value: 'Manage the queue, settings, lyrics, uploads, history, and live playback from `/dashboard`.',
          inline: true,
        },
        {
          name: '\u{1F3AE} Discord Activity',
          value: 'Open Bread from your voice channel to search, queue, control playback, and use karaoke together.',
          inline: true,
        },
        {
          name: '\u{1F680} Quick start',
          value: 'Use `/play` in Discord, `/dashboard` for the full control panel, or press **Next** for the command list.',
        },
      )
      .setFooter({ text: `Page 1/${HELP_PAGE_COUNT} - Use the buttons to browse` });

    if (options.botAvatar) embed.setImage(options.botAvatar);
    return embed;
  }

  const category = HELP_CATEGORIES[pageIndex - 1] || HELP_CATEGORIES[0];
  const embed = new EmbedBuilder()
    .setTitle(`Bread - Help (${category.name})`)
    .setDescription(category.description)
    .setColor(BRAND_COLORS.primary)
    .setFooter({ text: `Page ${pageIndex + 1}/${HELP_PAGE_COUNT}` });

  for (const cmd of category.commands) {
    embed.addFields({ name: cmd.name, value: cmd.value, inline: true });
  }

  return embed;
}

function buildHelpComponents(pageIndex, userId, dashboardUrl) {
  const row = new ActionRowBuilder();

  const prevButton = new ButtonBuilder()
    .setCustomId(`help:prev:${userId}:${pageIndex}`)
    .setLabel('◀')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(pageIndex === 0);

  const nextButton = new ButtonBuilder()
    .setCustomId(`help:next:${userId}:${pageIndex}`)
    .setLabel('▶')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(pageIndex === HELP_PAGE_COUNT - 1);

  row.addComponents(prevButton, nextButton);
  if (pageIndex === 0 && dashboardUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open Dashboard')
        .setURL(dashboardUrl),
    );
  }
  return [row];
}
const { createUtilityCommands } = require('./domains/utility');
const { createMusicCommands } = require('./domains/music');
const { createRadioCommands } = require('./domains/radio');
const { createStatsCommands } = require('./domains/stats');
const { createMusicControlCommands } = require('./domains/musicControls');
const { createLibraryCommands } = require('./domains/library');
const { createConfigCommands } = require('./domains/config');
const { createSystemCommands } = require('./domains/system');
const { createBlackjackCommands } = require('./domains/games');
const { createEconomyCommands } = require('./domains/economy');
const { createArcadeCommands } = require('./domains/arcade');

const { createSoundCommands } = require('./domains/sound');
const { createHistoryCommands } = require('./domains/history');

const commandContext = {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ensureVoice,
  ensurePlayer,
  CommandError,
  buildTrackEmbed,
  buildNowPlayingEmbed,
  savePlayerState,
  getConfig,
  setConfig,
  deleteConfig,
  assertDJ,
  hasDJPermissions,
  formatConfig,
  buildQueueEmbed,
  buildQueueComponents,
  formatDuration,
  parseTimecode,
  isTrackSeekable,
  isUnseekableTrackError,
  seekTrack,
  getSelection,
  deleteSelection,
  startBlackjack,
  endBlackjack,
  buildBlackjackEmbed,
  buildBlackjackMessage,
  buildBlackjackComponents,
  getBlackjackGame,
  getBalance,
  addBalance,
  claimHourly,
  getLeaderboard,
  hasBalance,
  HOURLY_COOLDOWN,
  playSlots,
  playRoulette,
  playCoinflip,
  buildSlotsEmbed,
  buildRouletteEmbed,
  buildCoinflipEmbed,
  buildSlotsMessage,
  buildRouletteMessage,
  buildCoinflipMessage,
  playRPS,
  magic8Ball,
  rollDice,
  buildRPSEmbed,
  build8BallEmbed,
  buildDiceEmbed,
  buildRPSMessage,
  build8BallMessage,
  buildDiceMessage,
  buildRPSPrepareMessage,
  buildRPSChoiceComponents,
  buildReplayComponents,
  getArcadeStats,
  recordArcadeGame,
  applyPreferredSource,
  handleSkipRequest,
  markPlayerStopping,
  deleteInteractionReply,
  isAutoplayEnabled,
  toggleAutoplay,
  addManualSeed,
  clearAutoplayState,
  classifyPlaybackError,
  describeSearchFailure,
  clearVoiceTrackStatus,
  setVoiceTrackStatus,
  findLyrics,
  trackToLyricsQuery,
  LyricsProviderError,
  BRAND_COLORS,
  buildDashboardUrl,
  getGuildInsights,
  getUserInsights,
  withGuildMutex,
  formatStatsDuration,
  formatCompactRankedCounts,
  formatSourceLabel,
  formatRankedSources,
  formatRankedRequesters,
  formatRankedTracks,
  queuePersist,
  HELP_CATEGORIES,
  HELP_PAGE_COUNT,
  buildHelpEmbed,
  buildHelpComponents,
};

const commands = [
  ...createUtilityCommands(commandContext),
  ...createMusicCommands(commandContext),
  ...createRadioCommands(commandContext),
  ...createStatsCommands(commandContext),
  ...createMusicControlCommands(commandContext),
  ...createSoundCommands(commandContext),
  ...createHistoryCommands(commandContext),
  ...createLibraryCommands(commandContext),
  ...createConfigCommands(commandContext),
  ...createSystemCommands(commandContext),
  ...createBlackjackCommands(commandContext),
  ...createEconomyCommands(commandContext),
  ...createArcadeCommands(commandContext),
];

module.exports = {
  commands,
  buildHelpEmbed,
  buildHelpComponents,
  HELP_CATEGORIES,
  HELP_PAGE_COUNT,
};
