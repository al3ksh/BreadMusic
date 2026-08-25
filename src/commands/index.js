const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
} = require('../games/gambling');
const {
  playRPS,
  magic8Ball,
  rollDice,
  buildRPSEmbed,
  build8BallEmbed,
  buildDiceEmbed,
  buildRPSChoiceComponents,
} = require('../games/fun');
const { applyPreferredSource } = require('../music/searchUtils');
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

const FILTER_PRESET_CHOICES = [
  { value: 'bassboost', label: 'Bassboost', description: 'Deep, punchy bass boost.' },
  { value: 'nightcore', label: 'Nightcore', description: 'Faster tempo (1.25x) + higher pitch.' },
  { value: 'vaporwave', label: 'Vaporwave', description: 'Slower tempo (0.85x) + lower pitch.' },
  { value: 'soft', label: 'Soft', description: 'Warm EQ with enhanced mids for vocals.' },
  { value: 'karaoke', label: 'Karaoke', description: 'Reduces center vocals (mono channel).' },
  { value: '8d', label: '8D Audio', description: 'Rotating stereo panning effect.' },
  { value: 'vibrato', label: 'Vibrato', description: 'Pitch modulation (retro/synth vibe).' },
  { value: 'tremolo', label: 'Tremolo', description: 'Volume modulation (pulsating effect).' },
  { value: 'radio', label: 'Radio', description: 'Lo-fi radio/telephone effect.' },
];

const BASSBOOST_EQ = [
  { band: 0, gain: 0.15 },   // 25Hz - deep sub-bass
  { band: 1, gain: 0.20 },   // 40Hz - sub-bass punch
  { band: 2, gain: 0.18 },   // 63Hz - bass body
  { band: 3, gain: 0.12 },   // 100Hz - low bass, warmth
  { band: 4, gain: 0.06 },   // 160Hz - upper bass
  { band: 5, gain: 0.0 },    // 250Hz - low mids (neutral)
  { band: 6, gain: -0.03 },  // 400Hz - slight cut to reduce muddiness
  { band: 7, gain: -0.03 },  // 630Hz - slight cut for clarity
  { band: 8, gain: 0.0 },    // 1kHz - mids (neutral)
  { band: 9, gain: 0.0 },    // 1.6kHz - presence (neutral)
  { band: 10, gain: 0.03 },  // 2.5kHz - slight boost for definition
  { band: 11, gain: 0.03 },  // 4kHz - clarity
  { band: 12, gain: 0.0 },   // 6.3kHz - highs (neutral)
  { band: 13, gain: 0.0 },   // 10kHz - highs (neutral)
  { band: 14, gain: 0.0 },   // 16kHz - air (neutral)
];

const RADIO_EQ = [
  { band: 0, gain: -0.25 },  // 25Hz - cut
  { band: 1, gain: -0.20 },  // 40Hz - cut
  { band: 2, gain: -0.15 },  // 63Hz - cut
  { band: 3, gain: -0.10 },  // 100Hz - slight cut
  { band: 4, gain: 0.0 },    // 160Hz - neutral
  { band: 5, gain: 0.10 },   // 250Hz - boost low-mids
  { band: 6, gain: 0.15 },   // 400Hz - boost mids
  { band: 7, gain: 0.20 },   // 630Hz - boost mids (telephone range)
  { band: 8, gain: 0.15 },   // 1kHz - boost presence
  { band: 9, gain: 0.10 },   // 1.6kHz - boost
  { band: 10, gain: 0.0 },   // 2.5kHz - neutral
  { band: 11, gain: -0.10 }, // 4kHz - cut
  { band: 12, gain: -0.15 }, // 6.3kHz - cut
  { band: 13, gain: -0.20 }, // 10kHz - cut
  { band: 14, gain: -0.25 }, // 16kHz - cut
];

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

const FILTER_PRESETS = {
  bassboost: async (manager) => manager.setEQ(BASSBOOST_EQ),
  nightcore: async (manager) => manager.toggleNightcore(1.25, 1.2, 1),
  vaporwave: async (manager) => manager.toggleVaporwave(0.85, 0.8, 1),
  soft: async (manager) => manager.setEQPreset('FullSound'),
  karaoke: async (manager) => manager.toggleKaraoke(),
  '8d': async (manager) => manager.toggleRotation(0.15),
  vibrato: async (manager) => manager.toggleVibrato(8, 1),
  tremolo: async (manager) => manager.toggleTremolo(4, 0.6),
  radio: async (manager) => {
    await manager.setEQ(RADIO_EQ);
    await manager.toggleLowPass(15);
  },
};

async function queuePersist(player) {
  await savePlayerState(player).catch(() => {});
}

const HELP_CATEGORIES = [
  {
    name: 'Music',
    description: 'Control playback, queue, and audio filters.',
    commands: [
      { name: '/play', value: 'Play or queue a track/playlist.' },
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
      { name: '/filter', value: 'Apply audio filters.' },
      { name: '/leave', value: 'Disconnect the bot.' },
      { name: '/clearqueue', value: 'Clear upcoming tracks.' },
      { name: '/remove', value: 'Remove specific tracks.' },
      { name: '/move', value: 'Move a track in the queue.' },
      { name: '/skipto', value: 'Skip to a specific track.' },
      { name: '/back', value: 'Play previous track.' },
      { name: '/replay', value: 'Replay current track.' },
      { name: '/autoplay', value: 'Toggle autoplay mode.' },
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
      { name: '/stats', value: 'Show member or server listening statistics.' },
      { name: '/config', value: 'Manage guild settings (or use the dashboard).' },
    ],
  },
  {
    name: 'Fun',
    description: 'Games and memes.',
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
const { createStatsCommands } = require('./domains/stats');
const { createMusicControlCommands } = require('./domains/musicControls');
const { createConfigCommands } = require('./domains/config');
const { createSystemCommands } = require('./domains/system');
const { createBlackjackCommands } = require('./domains/games');
const { createEconomyCommands } = require('./domains/economy');
const { createArcadeCommands } = require('./domains/arcade');

const commandContext = {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
  playRPS,
  magic8Ball,
  rollDice,
  buildRPSEmbed,
  build8BallEmbed,
  buildDiceEmbed,
  buildRPSChoiceComponents,
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
  FILTER_PRESET_CHOICES,
  BASSBOOST_EQ,
  RADIO_EQ,
  formatStatsDuration,
  formatCompactRankedCounts,
  formatSourceLabel,
  formatRankedSources,
  formatRankedRequesters,
  formatRankedTracks,
  FILTER_PRESETS,
  queuePersist,
  HELP_CATEGORIES,
  HELP_PAGE_COUNT,
  buildHelpEmbed,
  buildHelpComponents,
};

const commands = [
  ...createUtilityCommands(commandContext),
  ...createMusicCommands(commandContext),
  ...createStatsCommands(commandContext),
  ...createMusicControlCommands(commandContext),
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
