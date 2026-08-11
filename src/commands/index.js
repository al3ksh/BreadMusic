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
const { isTrackSeekable, isUnseekableTrackError } = require('../music/trackCapabilities');
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
const { isAutoplayEnabled, toggleAutoplay, resetSeed, clearAutoplayState } = require('../music/autoplay');
const { classifyPlaybackError, describeSearchFailure } = require('../music/playbackErrors');
const { clearVoiceTrackStatus, setVoiceTrackStatus } = require('../music/voiceStatus');
const { findLyrics, trackToLyricsQuery, LyricsProviderError } = require('../music/lyrics');
const { BRAND_COLORS } = require('../theme');
const { buildDashboardUrl } = require('../dashboard/url');

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
      { name: '/skip', value: 'Skip the current track.' },
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

function buildHelpEmbed(pageIndex) {
  const category = HELP_CATEGORIES[pageIndex];
  const embed = new EmbedBuilder()
    .setTitle(`Bread - Help (${category.name})`)
    .setDescription(category.description)
    .setColor(BRAND_COLORS.primary)
    .setFooter({ text: `Page ${pageIndex + 1}/${HELP_CATEGORIES.length}` });

  for (const cmd of category.commands) {
    embed.addFields({ name: cmd.name, value: cmd.value, inline: true });
  }

  return embed;
}

function buildHelpComponents(pageIndex, userId) {
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
    .setDisabled(pageIndex === HELP_CATEGORIES.length - 1);

  row.addComponents(prevButton, nextButton);
  return [row];
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Command list and quick tips.'),
    async execute(interaction) {
      const pageIndex = 0;
      const embed = buildHelpEmbed(pageIndex);
      const components = buildHelpComponents(pageIndex, interaction.user.id);
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('dashboard')
      .setDescription('Open dashboard for this server.')
      .setDMPermission(false),
    async execute(interaction) {
      const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
      const botAvatar = interaction.client.user?.displayAvatarURL({ size: 128 }) ?? null;
      const embed = new EmbedBuilder()
        .setTitle('Bread Dashboard')
        .setColor(BRAND_COLORS.primary)
        .setDescription('Manage playback, queue, lyrics, history, uploads, economy, and server settings from the web dashboard.')
        .setFooter({ text: 'Dashboard link for this server.' });

      if (botAvatar) {
        embed.setThumbnail(botAvatar);
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('Open Web Dashboard')
          .setURL(dashboardUrl),
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play or queue a track/playlist.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('URL or search query.')
          .setAutocomplete(true)
          .setRequired(true),
      ),
    async execute(interaction) {
      const rawQuery = interaction.options.getString('query', true);
      const selectionMatch = /^auto:([a-f0-9]+):(\d+)$/i.exec(rawQuery);
      let resolvedTrack = null;

      let selectionExpired = false;
      if (selectionMatch) {
        const [_, selectionId, indexRaw] = selectionMatch;
        const selection = getSelection(selectionId);
        const index = Number(indexRaw);
        if (
          selection &&
          selection.userId === interaction.user.id &&
          selection.guildId === interaction.guildId &&
          selection.tracks[index]
        ) {
          resolvedTrack = selection.tracks[index];
          deleteSelection(selectionId);
        } else {
          selectionExpired = true;
        }
      }
      if (selectionExpired && !resolvedTrack) {
        await interaction.reply({
          content: 'That autocomplete result expired. Please try again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply();
      const { player, voiceChannelId, config } = await ensureVoice(interaction, {
        requireSameChannel: true,
        createPlayer: true,
      });

      const defaultSource = interaction.client.lavalink?.options?.playerOptions?.defaultSearchPlatform;
      let isPlaylist = false;
      let tracksToAdd;
      let playlistName;

      if (resolvedTrack) {
        tracksToAdd = [resolvedTrack];
      } else {
        const prefixedQuery = applyPreferredSource(rawQuery, config, defaultSource);
        let searchResult;
        try {
          searchResult = await player.search(prefixedQuery, interaction.user);
        } catch (error) {
          const failure = classifyPlaybackError(error);
          await interaction.deleteReply().catch(() => {});
          await interaction.followUp({
            content: `**${failure.title}**\n${failure.description}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        if (!searchResult || !searchResult.tracks.length) {
          const failure = describeSearchFailure(searchResult);
          await interaction.deleteReply().catch(() => {});
          await interaction.followUp({
            content: `**${failure.title}**\n${failure.description}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        isPlaylist = Boolean(searchResult.playlist);
        playlistName = searchResult.playlist?.name;
        tracksToAdd = isPlaylist ? searchResult.tracks : [searchResult.tracks[0]];
      }

      const seedTrack = tracksToAdd[0];
      if (seedTrack?.info) {
        resetSeed(player.guildId, {
          title: seedTrack.info.title,
          author: seedTrack.info.author,
          identifier: seedTrack.info.identifier,
          uri: seedTrack.info.uri,
          duration: seedTrack.info.duration ?? seedTrack.info.length,
          sourceName: seedTrack.info.sourceName,
        });
      }
      
      const autoplayIndex = player.queue.tracks.findIndex(t => t.isAutoplay);
      if (autoplayIndex !== -1) {
        const tracksArray = isPlaylist ? tracksToAdd : [tracksToAdd[0]];
        player.queue.tracks.splice(autoplayIndex, 0, ...tracksArray);
      } else {
        await player.queue.add(isPlaylist ? tracksToAdd : tracksToAdd[0]);
      }
      
      if (!player.playing && !player.paused) {
        await player.play();
      }

      await queuePersist(player);
      if (isPlaylist) {
        const playlistEmbed = new EmbedBuilder()
          .setTitle('Playlist queued')
          .setDescription(`**${playlistName ?? 'Playlist'}**`)
          .addFields(
            { name: 'Tracks', value: `${tracksToAdd.length}`, inline: true },
            { name: 'Voice channel', value: `<#${voiceChannelId}>`, inline: true },
          )
          .setColor(BRAND_COLORS.primary)
          .setTimestamp();
        await interaction.editReply({ embeds: [playlistEmbed] });
      } else {
        const embed = buildTrackEmbed(tracksToAdd[0], interaction.user, voiceChannelId);
        await interaction.editReply({ embeds: [embed] });
      }
    },
  },
  {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      const result = await handleSkipRequest(interaction, player, config, interaction.client);
      if (result.skipped) {
        if (result.needsAutoplay && result.lastTrack) {
          const { handleAutoplay } = require('../music/autoplay');
          await handleAutoplay(player, result.lastTrack, interaction.client);
        }
        await queuePersist(player);
        await deleteInteractionReply(interaction);
        return;
      }
      await interaction.editReply(result.message);
    },
  },
  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      if (player.paused) {
        await interaction.editReply('Playback is already paused.');
        return;
      }
      await player.pause();
      await interaction.client.musicUI.refresh(player);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      if (!player.paused) {
        await interaction.editReply('Nothing is paused right now.');
        return;
      }
      await player.resume();
      await interaction.client.musicUI.refresh(player);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop playback and clear the queue.')
      .setDMPermission(false),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      clearAutoplayState(player.guildId);
      markPlayerStopping(player);
      await player.stopPlaying(true);
      player.queue.tracks.splice(0, player.queue.tracks.length);
      await player.destroy('Stopped via command', true);
      await queuePersist(player);
      await interaction.client.musicUI.clear(player.guildId);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clearqueue')
      .setDescription('Clear upcoming tracks but keep the current song playing.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);

      if (!player.queue.tracks.length) {
        await interaction.editReply('The queue is already empty.');
        return;
      }

      const removed = player.queue.tracks.length;
      player.queue.tracks.splice(0, removed);
      await queuePersist(player);
      await interaction.client.musicUI.refresh(player);
      await interaction.editReply(`Cleared ${removed} upcoming track(s). Current song keeps playing.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Disconnect the bot from the voice channel.')
      .setDMPermission(false),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction);
      assertDJ(interaction, config);
      clearAutoplayState(player.guildId);
      await player.destroy('manual-leave', true);
      await interaction.client.musicUI.clear(interaction.guildId);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder().setName('queue').setDescription('Show the queue with pagination.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player } = await ensurePlayer(interaction);
      if (!player.queue.current) {
        await interaction.editReply('The queue is empty.');
        return;
      }

      const page = buildQueueEmbed(player, 0);
      await interaction.editReply({
        embeds: [page.embed],
        components: buildQueueComponents(
          interaction.guildId,
          page.page,
          page.totalPages,
          interaction.user.id,
        ),
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Aktualny utwor.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player } = await ensurePlayer(interaction);
      const embed = buildNowPlayingEmbed(player, player.queue.current);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove selected range from the queue.')
      .addIntegerOption((option) =>
        option.setName('start').setDescription('Start position (1-indexed)').setRequired(true),
      )
      .addIntegerOption((option) =>
        option.setName('end').setDescription('End position (inclusive)').setRequired(false),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);

      const start = interaction.options.getInteger('start', true) - 1;
      const end = (interaction.options.getInteger('end') ?? interaction.options.getInteger('start', true)) - 1;
      if (start < 0 || end < start || end >= player.queue.tracks.length) {
        throw new CommandError('Invalid range.');
      }

      const count = end - start + 1;
      player.queue.tracks.splice(start, count);
      await queuePersist(player);
      await interaction.editReply(`Removed ${count} item(s) from the queue.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('move')
      .setDescription('Move a track from one position to another.')
      .addIntegerOption((option) =>
        option.setName('from').setDescription('Position to move from.').setRequired(true),
      )
      .addIntegerOption((option) =>
        option.setName('to').setDescription('Destination position.').setRequired(true),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);

      const from = interaction.options.getInteger('from', true) - 1;
      const to = interaction.options.getInteger('to', true) - 1;

      if (
        from < 0 ||
        to < 0 ||
        from >= player.queue.tracks.length ||
        to >= player.queue.tracks.length
      ) {
        throw new CommandError('Invalid positions.');
      }

      const [track] = player.queue.tracks.splice(from, 1);
      player.queue.tracks.splice(to, 0, track);
      await queuePersist(player);
      await interaction.editReply(`Moved **${track.info.title}** to position ${to + 1}.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('seek')
      .setDescription('Seek to a specific position (mm:ss).')
      .addStringOption((option) =>
        option.setName('position').setDescription('Time mm:ss or hh:mm:ss.').setRequired(true),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      if (!player.queue.current) {
        throw new CommandError('Nothing is playing.');
      }
      if (!isTrackSeekable(player.queue.current)) {
        throw new CommandError('This track cannot be seeked because it is a live stream or has no seekable source.');
      }
      const targetPosition = parseTimecode(interaction.options.getString('position', true));
      try {
        await player.seek(targetPosition);
      } catch (error) {
        if (isUnseekableTrackError(error)) {
          throw new CommandError('This track cannot be seeked because it is a live stream or has no seekable source.');
        }
        throw error;
      }
      await interaction.editReply(`Set position to ${formatDuration(targetPosition)}.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('skipto')
      .setDescription('Jump to a specific position in the queue.')
      .addIntegerOption((option) =>
        option.setName('index').setDescription('Target position.').setRequired(true),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      const index = interaction.options.getInteger('index', true);

      if (index < 1 || index > player.queue.tracks.length) {
        throw new CommandError('Invalid index.');
      }

      await player.queue.splice(0, index - 1);
      await player.skip();
      await queuePersist(player);
      await interaction.editReply(`Skipped to position ${index}.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('back').setDescription('Go back to the previous track.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      const previous = await player.queue.shiftPrevious();
      if (!previous) {
        await interaction.editReply('No previous tracks.');
        return;
      }
      await player.play({ clientTrack: previous });
      await queuePersist(player);
      await interaction.client.musicUI.refresh(player);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder().setName('replay').setDescription('Replay from start.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      if (!player.queue.current) {
        await interaction.editReply('No active track.');
        return;
      }
      await player.play({ clientTrack: player.queue.current, startTime: 0 });
      await interaction.client.musicUI.refresh(player);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      if (player.queue.tracks.length === 0) {
        await interaction.editReply('No tracks to shuffle.');
        return;
      }
      await player.queue.shuffle();
      await queuePersist(player);
      await interaction.client.musicUI.refresh(player);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('lyrics')
      .setDescription('Show song lyrics.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Optional song in "artist - title" format.')
          .setRequired(false),
      ),
    async execute(interaction) {
      await interaction.deferReply();
      const rawQuery = interaction.options.getString('query')?.trim();
      let query;
      let sourceTrack = null;

      if (rawQuery) {
        const separator = rawQuery.indexOf(' - ');
        if (separator < 1 || separator >= rawQuery.length - 3) {
          throw new CommandError('Use the format `artist - title`, or omit the query for the current track.');
        }
        query = {
          artist: rawQuery.slice(0, separator),
          title: rawQuery.slice(separator + 3),
          duration: 0,
        };
      } else {
        const player = interaction.client.lavalink?.getPlayer(interaction.guildId);
        if (!player?.queue?.current) {
          throw new CommandError('Nothing is playing. Provide a query in `artist - title` format.');
        }
        sourceTrack = player.queue.current;
        query = trackToLyricsQuery(sourceTrack);
      }

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

      await interaction.client.lyricsUI.present(interaction, lyrics, {
        guildId: interaction.guildId,
        track: sourceTrack,
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('autoplay').setDescription('Toggle autoplay - automatically plays similar tracks.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      
      const enabled = toggleAutoplay(interaction.guildId);
      
      const embed = new EmbedBuilder()
        .setTitle(enabled ? 'Autoplay Enabled' : 'Autoplay Disabled')
        .setDescription(
          enabled
            ? 'When the queue ends, I\'ll automatically find and play similar tracks based on the last played song.'
            : 'Autoplay has been turned off. Playback will stop when the queue is empty.'
        )
        .setColor(enabled ? '#22c55e' : '#ef4444');
      
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Loop mode.')
      .addStringOption((option) =>
        option
          .setName('mode')
          .setDescription('off / track / queue')
          .setRequired(true)
          .addChoices(
            { name: 'Off', value: 'off' },
            { name: 'Track', value: 'track' },
            { name: 'Queue', value: 'queue' },
          ),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      const mode = interaction.options.getString('mode', true);
      await player.setRepeatMode(mode);
      await interaction.client.musicUI.refresh(player);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set volume (0-100) with per-guild limit.')
      .addIntegerOption((option) =>
        option.setName('value').setDescription('Volume in %').setRequired(true),
      ),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);

      const requested = interaction.options.getInteger('value', true);
      const clamped = Math.min(config.maxVolume, Math.max(0, requested));
      await player.setVolume(clamped);
      await queuePersist(player);
      await interaction.editReply(`Volume set to ${clamped}% (limit: ${config.maxVolume}%).`);
      await interaction.client.musicUI.refresh(player);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('filter')
      .setDescription('Manage audio filters.')
      .addSubcommand((sub) =>
        sub
          .setName('preset')
          .setDescription('Enable preset.')
          .addStringOption((option) =>
            option
              .setName('name')
              .setDescription('Preset name')
              .setRequired(true)
              .addChoices(
                ...FILTER_PRESET_CHOICES.map(({ label, value }) => ({
                  name: label,
                  value,
                })),
              ),
          ),
      )
      .addSubcommand((sub) => sub.setName('clear').setDescription('Reset filters.'))
      .addSubcommand((sub) => sub.setName('list').setDescription('Show active filters.')),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const activePreset = player.filterManager.activePreset || null;
        const description = FILTER_PRESET_CHOICES.map(({ label, value, description }) => {
          const status = activePreset === value ? 'ON' : 'OFF';
          const details = description ? ` - ${description}` : '';
          return `- [${status}] ${label}${details}`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('Filter presets')
          .setColor(BRAND_COLORS.secondary)
          .setDescription(description);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'clear') {
        await player.filterManager.resetFilters();
        await player.filterManager.clearEQ();
        await player.filterManager.applyPlayerFilters();
        player.filterManager.activePreset = null;
        await interaction.editReply('Filters cleared.');
        return;
      }

      const preset = interaction.options.getString('name', true);
      const handler = FILTER_PRESETS[preset];
      if (!handler) throw new CommandError('Unknown preset.');
      await handler(player.filterManager);
      await player.filterManager.applyPlayerFilters();
      player.filterManager.activePreset = preset;
      await interaction.editReply(`Applied preset **${preset}**.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('config')
      .setDescription('Manage guild settings (or use dashboard).')
      .addSubcommand((sub) =>
        sub.setName('get').setDescription('Show current configuration (dashboard available).'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('set')
          .setDescription('Set selected options (dashboard available).')
          .addRoleOption((option) => option.setName('dj_role').setDescription('Rola DJ.'))
          .addIntegerOption((option) =>
            option
              .setName('max_volume')
              .setDescription('Maximum volume (10-500).')
              .setMinValue(10)
              .setMaxValue(500),
          )
          .addNumberOption((option) =>
            option
              .setName('voteskip_percent')
              .setDescription('Vote skip threshold as a percentage (10-100).')
              .setMinValue(10)
              .setMaxValue(100),
          )
          .addBooleanOption((option) =>
            option.setName('stay_24_7').setDescription('Stay in channel?'),
          )
          .addChannelOption((option) =>
            option.setName('voice_channel').setDescription('24/7 voice channel').setRequired(false),
          )
          .addIntegerOption((option) =>
            option.setName('afk_timeout').setDescription('AFK timeout in minutes.'),
          )
          .addBooleanOption((option) =>
            option.setName('persistent_queue').setDescription('Persist queue?'),
          )
          .addBooleanOption((option) =>
            option.setName('voice_status').setDescription('Show the current track as voice channel status?'),
          )
          .addStringOption((option) =>
            option
              .setName('dashboard_access')
              .setDescription('Who can open the server dashboard?')
              .addChoices(
                { name: 'Administrators only', value: 'admin' },
                { name: 'Administrators and DJs', value: 'dj' },
                { name: 'All server members', value: 'members' },
              ),
          )
          .addStringOption((option) =>
            option
              .setName('preferred_source')
              .setDescription('Preferred provider')
              .addChoices(
                { name: 'YouTube', value: 'ytsearch' },
                { name: 'SoundCloud', value: 'scsearch' },
                { name: 'Spotify', value: 'spsearch' },
              ),
          ),
      )
      .addSubcommand((sub) => sub.setName('reset').setDescription('Restore default settings (dashboard available).'))
      .setDMPermission(false),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const sub = interaction.options.getSubcommand();
      if (sub === 'get') {
        const config = getConfig(interaction.guildId);
        const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
        const embed = new EmbedBuilder()
          .setTitle('Current configuration')
          .setColor(BRAND_COLORS.secondary)
          .setDescription(`Dashboard: ${dashboardUrl}\n\`\`\`\n${formatConfig(config)}\n\`\`\``);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new CommandError('Manage Guild permission is required.');
      }

      if (sub === 'reset') {
        deleteConfig(interaction.guildId);
        const fresh = getConfig(interaction.guildId);
        const player = interaction.client.lavalink?.getPlayer(interaction.guildId);
        if (fresh.voiceChannelStatus && player?.queue.current) {
          await setVoiceTrackStatus(interaction.client, player, player.queue.current);
        }
        const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
        const embed = new EmbedBuilder()
          .setTitle('Configuration reset')
          .setColor(BRAND_COLORS.secondary)
          .setDescription(`Dashboard: ${dashboardUrl}\n\`\`\`\n${formatConfig(fresh)}\n\`\`\``);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const updates = {};
      const djRole = interaction.options.getRole('dj_role');
      if (djRole) updates.djRoleId = djRole.id;
      const maxVolume = interaction.options.getInteger('max_volume');
      if (maxVolume !== null) updates.maxVolume = Math.max(10, Math.min(500, maxVolume));
      const voteSkip = interaction.options.getNumber('voteskip_percent');
      if (voteSkip !== null) updates.voteSkipPercent = Math.min(Math.max(voteSkip / 100, 0.1), 1);
      const stay = interaction.options.getBoolean('stay_24_7');
      if (stay !== null) updates.stayInChannel = stay;
      const voiceChannel = interaction.options.getChannel('voice_channel');
      if (voiceChannel) updates.twentyFourSevenChannelId = voiceChannel.id;
      const afk = interaction.options.getInteger('afk_timeout');
      if (afk !== null) updates.afkTimeout = Math.max(1, afk) * 60 * 1000;
      const persistent = interaction.options.getBoolean('persistent_queue');
      if (persistent !== null) updates.persistentQueue = persistent;
      const voiceStatus = interaction.options.getBoolean('voice_status');
      if (voiceStatus !== null) updates.voiceChannelStatus = voiceStatus;
      const dashboardAccess = interaction.options.getString('dashboard_access');
      if (dashboardAccess) updates.dashboardAccess = dashboardAccess;
      const prefSource = interaction.options.getString('preferred_source');
      if (prefSource) updates.preferredSource = prefSource;

      const updated = setConfig(interaction.guildId, updates);
      const player = interaction.client.lavalink?.getPlayer(interaction.guildId);
      if (voiceStatus === false && player) {
        await clearVoiceTrackStatus(interaction.client, player);
      } else if (voiceStatus === true && player?.queue.current) {
        await setVoiceTrackStatus(interaction.client, player, player.queue.current);
      }
      const dashboardUrl = buildDashboardUrl(interaction.guildId, 'settings');
      const embed = new EmbedBuilder()
        .setTitle('Configuration updated')
        .setColor(BRAND_COLORS.primary)
        .setDescription(`Dashboard: ${dashboardUrl}\n\`\`\`\n${formatConfig(updated)}\n\`\`\``);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('ping').setDescription('Check latency.'),
    async execute(interaction) {
      const { resource } = await interaction.reply({ content: 'Ping...', withResponse: true });
      const latency = resource.message.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`Pong! Websocket: ${interaction.client.ws.ping}ms | RTT: ${latency}ms`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Play blackjack versus the dealer.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet (optional)').setMinValue(1),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet') || 0;

      if (bet > 0 && !hasBalance(interaction.user.id, bet)) {
        await interaction.reply({ content: `You don't have enough 🍞! Your balance: ${getBalance(interaction.user.id)} 🍞`, flags: MessageFlags.Ephemeral });
        return;
      }

      if (getBlackjackGame(interaction.user.id)) {
        await interaction.reply({ content: 'You already have an active game! Finish it first.', flags: MessageFlags.Ephemeral });
        return;
      }

      const game = startBlackjack(interaction.user.id, bet);
      if (game.error) {
        await interaction.reply({ content: game.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildBlackjackEmbed(interaction.user, game);
      const canDouble = game.player.length === 2 && !game.finished && bet > 0 && hasBalance(interaction.user.id, bet);
      const components = buildBlackjackComponents(interaction.user.id, game.finished, canDouble);
      await interaction.reply({ embeds: [embed], components });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('hourly')
      .setDescription('Claim your hourly reward.'),
    async execute(interaction) {
      const result = claimHourly(interaction.user.id);

      if (!result.success) {
        const minutes = Math.floor(result.remaining / 60000);
        const seconds = Math.floor((result.remaining % 60000) / 1000);
        await interaction.reply({
          content: `⏰ You need to wait **${minutes}m ${seconds}s** for your next reward.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('💰 Hourly Reward')
        .setColor('#22c55e')
        .setDescription(`You received **${result.reward}** 🍞!`)
        .addFields({ name: 'New balance', value: `${result.newBalance} 🍞` });

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your balance.')
      .addUserOption((option) =>
        option.setName('user').setDescription('User to check (optional)'),
      ),
    async execute(interaction) {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const balance = getBalance(targetUser.id);

      const embed = new EmbedBuilder()
        .setTitle(`💰 Balance - ${targetUser.username}`)
        .setColor(BRAND_COLORS.primary)
        .setDescription(`**${balance}** 🍞`)
        .setThumbnail(targetUser.displayAvatarURL());

      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('See top earners on this server.'),
    async execute(interaction) {
      await interaction.deferReply();
      
      try {
        let memberIds;
        try {
          const guildMembers = await interaction.guild.members.fetch();
          memberIds = new Set(guildMembers.keys());
        } catch {
          memberIds = new Set(interaction.guild.members.cache.keys());
        }
        
        const allUsers = getLeaderboard(1000);
        const guildTop = allUsers
          .filter((entry) => memberIds.has(entry.userId))
          .slice(0, 10);

        if (guildTop.length === 0) {
          await interaction.editReply('Nobody on this server has any money yet!');
          return;
        }

        const medals = ['👑', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        
        const lines = await Promise.all(
          guildTop.map(async (entry, i) => {
            try {
              const user = await interaction.client.users.fetch(entry.userId);
              const medal = medals[i] || `${i + 1}.`;
              const balanceFormatted = entry.balance.toLocaleString();
              const isRequester = entry.userId === interaction.user.id;
              const name = isRequester ? `**${user.username}** ⬅️` : `**${user.username}**`;
              return `${medal} │ ${name} │ \`${balanceFormatted}\` 🍞`;
            } catch {
              const balanceFormatted = entry.balance.toLocaleString();
              return `${medals[i] || `${i + 1}.`} │ Unknown │ \`${balanceFormatted}\` 🍞`;
            }
          }),
        );

        const allGuildUsers = allUsers.filter((entry) => memberIds.has(entry.userId));
        const requesterIndex = allGuildUsers.findIndex((e) => e.userId === interaction.user.id);
        const requesterBalance = getBalance(interaction.user.id);
        
        let yourPositionText;
        if (requesterIndex === -1 || requesterBalance === 0) {
          yourPositionText = `You're not ranked yet! Use \`/hourly\` to start.`;
        } else if (requesterIndex < 10) {
          yourPositionText = `You're in the **top 10**! 🎉`;
        } else {
          yourPositionText = `#${requesterIndex + 1} │ \`${requesterBalance.toLocaleString()}\` 🍞`;
        }

        // Calculate total bread on server
        const totalBread = guildTop.reduce((sum, e) => sum + e.balance, 0).toLocaleString();

        const embed = new EmbedBuilder()
          .setTitle('🏆 Bread Leaderboard')
          .setColor('#fbbf24')
          .setDescription(`\`\`\`\n${interaction.guild.name}\n\`\`\`\n${lines.join('\n')}`)
          .addFields(
            { name: '📍 Your Position', value: yourPositionText, inline: true },
            { name: '💰 Total Server Bread', value: `\`${totalBread}\` 🍞`, inline: true },
          )
          .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Leaderboard error:', error);
        await interaction.editReply('Failed to load leaderboard.').catch(() => {});
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Spin the slot machine.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet', true);
      const result = playSlots(interaction.user.id, bet);

      if (!result.success) {
        await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildSlotsEmbed(result.result, bet, result.winnings, result.isWin, result.newBalance);
      try {
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        if (!result.isWin) {
          addBalance(interaction.user.id, bet);
        }
        console.error('Failed to send slots result:', error.message);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roulette')
      .setDescription('Spin the roulette wheel.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('Type of bet')
          .setRequired(true)
          .addChoices(
            { name: 'Red (2x)', value: 'red' },
            { name: 'Black (2x)', value: 'black' },
            { name: 'Green/0 (14x)', value: 'green' },
            { name: 'Odd (2x)', value: 'odd' },
            { name: 'Even (2x)', value: 'even' },
          ),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet', true);
      const betType = interaction.options.getString('type', true);

      const result = playRoulette(interaction.user.id, bet, betType);

      if (!result.success) {
        await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildRouletteEmbed(
        result.spinResult,
        result.color,
        betType,
        bet,
        result.isWin,
        result.winnings,
        result.newBalance,
      );
      try {
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        if (!result.isWin) {
          addBalance(interaction.user.id, bet);
        }
        console.error('Failed to send roulette result:', error.message);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin.')
      .addIntegerOption((option) =>
        option.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName('choice')
          .setDescription('Heads or tails')
          .setRequired(true)
          .addChoices(
            { name: 'Heads', value: 'heads' },
            { name: 'Tails', value: 'tails' },
          ),
      ),
    async execute(interaction) {
      const bet = interaction.options.getInteger('bet', true);
      const choice = interaction.options.getString('choice', true);

      const result = playCoinflip(interaction.user.id, bet, choice);

      if (!result.success) {
        await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildCoinflipEmbed(result.result, choice, bet, result.isWin, result.winnings, result.newBalance);
      try {
        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        if (!result.isWin) {
          addBalance(interaction.user.id, bet);
        }
        console.error('Failed to send coinflip result:', error.message);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rps')
      .setDescription('Play rock, paper, scissors (vs bot or challenge a user).')
      .addSubcommand((sub) =>
        sub
          .setName('solo')
          .setDescription('Play against the bot.')
          .addStringOption((option) =>
            option
              .setName('choice')
              .setDescription('Your choice')
              .setRequired(true)
              .addChoices(
                { name: '🪨 Rock', value: 'rock' },
                { name: '📄 Paper', value: 'paper' },
                { name: '✂️ Scissors', value: 'scissors' },
              ),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('duel')
          .setDescription('Challenge another user (hidden move).')
          .addUserOption((option) =>
            option
              .setName('opponent')
              .setDescription('User to challenge')
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName('bet')
              .setDescription('Amount to bet (optional)')
              .setMinValue(1),
          ),
      ),
    async execute(interaction) {
      let mode = 'solo';
      try {
        mode = interaction.options.getSubcommand();
      } catch {
        // Fallback for stale Discord clients still sending the previous /rps payload format.
        mode = interaction.options.getUser('opponent') ? 'duel' : 'solo';
      }

      if (mode === 'solo') {
        const choice = interaction.options.getString('choice');
        if (!choice) {
          await interaction.reply({
            content: 'Choose your move in `/rps solo` (rock, paper, or scissors).',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const result = playRPS(choice);
        const embed = buildRPSEmbed(result.playerChoice, result.botChoice, result.result, interaction.user.username);
        await interaction.reply({ embeds: [embed] });
        return;
      }

      const opponent = interaction.options.getUser('opponent');
      if (!opponent) {
        await interaction.reply({
          content: 'Pick an opponent in `/rps duel`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const bet = interaction.options.getInteger('bet') || 0;
      
      if (opponent.id === interaction.user.id) {
        await interaction.reply({ content: "You can't challenge yourself!", flags: MessageFlags.Ephemeral });
        return;
      }
      
      if (opponent.bot) {
        await interaction.reply({ content: "You can't challenge a bot! Use `/rps solo` to play against the bot.", flags: MessageFlags.Ephemeral });
        return;
      }
      
      if (bet > 0) {
        if (!hasBalance(interaction.user.id, bet)) {
          await interaction.reply({ 
            content: `You don't have enough 🍞! Your balance: ${getBalance(interaction.user.id)} 🍞`, 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        if (!hasBalance(opponent.id, bet)) {
          await interaction.reply({ 
            content: `**${opponent.username}** doesn't have enough 🍞 for this bet!`, 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('⚔️ Prepare RPS duel')
        .setColor('#f59e0b')
        .setDescription(`Choose your hidden move against **${opponent.username}**.`)
        .addFields(
          { name: '💰 Bet', value: bet > 0 ? `${bet} 🍞` : 'No bet', inline: true },
          { name: '🔒 Privacy', value: 'Your move is hidden until duel ends.', inline: true },
        );

      const components = buildRPSChoiceComponents(interaction.user.id, opponent.id, bet);
      await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the magic 8-ball a question.')
      .addStringOption((option) =>
        option.setName('question').setDescription('Your question').setRequired(true),
      ),
    async execute(interaction) {
      const question = interaction.options.getString('question', true);
      const answer = magic8Ball();
      const embed = build8BallEmbed(question, answer);
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('roll')
      .setDescription('Roll dice.')
      .addStringOption((option) =>
        option.setName('dice').setDescription('Dice notation (e.g., 2d20, default: 1d6)'),
      ),
    async execute(interaction) {
      const notation = interaction.options.getString('dice') || '1d6';
      const result = rollDice(notation);

      if (!result) {
        await interaction.reply({ content: 'Invalid format. Use e.g. `1d6`, `2d20`.', flags: MessageFlags.Ephemeral });
        return;
      }

      const embed = buildDiceEmbed(result);
      await interaction.reply({ embeds: [embed] });
    },
  },
];

module.exports = {
  commands,
  buildHelpEmbed,
  buildHelpComponents,
  HELP_CATEGORIES,
};
