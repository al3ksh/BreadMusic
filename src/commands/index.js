const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const path = require('path');
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
  RPS_CHOICES,
  createChallenge,
  setMessageInfo,
  buildRPSChallengeEmbed,
  buildRPSChallengeComponents,
} = require('../games/fun');
const { applyPreferredSource } = require('../music/searchUtils');
const { handleSkipRequest } = require('../music/skipManager');
const { deleteInteractionReply } = require('../utils/interactions');
const { isAutoplayEnabled, toggleAutoplay, resetSeed } = require('../music/autoplay');

const BREAD_IMAGE_PATH = path.resolve(__dirname, '..', 'assets', 'images', 'bread.png');
const MONSTER_BREAD_IMAGE_PATH = path.resolve(
  __dirname,
  '..',
  'assets',
  'images',
  'monsterbread.png',
);

const FILTER_PRESET_CHOICES = [
  { value: 'bassboost', label: 'Bassboost', description: 'Boosted bass EQ curve.' },
  { value: 'nightcore', label: 'Nightcore', description: 'Faster tempo + higher pitch.' },
  { value: 'vaporwave', label: 'Vaporwave', description: 'Slower tempo + detuned vibe.' },
  { value: 'soft', label: 'Soft', description: 'Gentle EQ tuned for vocals.' },
  { value: 'karaoke', label: 'Karaoke', description: 'Reduces lead vocals.' },
];

const FILTER_PRESETS = {
  bassboost: async (manager) => manager.setEQPreset('BassboostMedium'),
  nightcore: async (manager) => manager.toggleNightcore(1.25, 1.2, 1),
  vaporwave: async (manager) => manager.toggleVaporwave(0.85, 0.8, 1),
  soft: async (manager) => manager.setEQPreset('FullSound'),
  karaoke: async (manager) => manager.toggleKaraoke(),
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
    ],
  },
  {
    name: 'Misc',
    description: 'Configuration and system commands.',
    commands: [
      { name: '/help', value: 'Show this help menu.' },
      { name: '/ping', value: 'Check latency.' },
      { name: '/config', value: 'Manage guild settings (DJ role, etc).' },
    ],
  },
  {
    name: 'Fun',
    description: 'Games and memes.',
    commands: [
      { name: '/bread', value: 'Get some bread.' },
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
    .setTitle(`NeoBeat Buddy - Help (${category.name})`)
    .setDescription(category.description)
    .setColor('#10b981')
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
        const searchResult = await player.search(prefixedQuery, interaction.user);
        if (!searchResult || !searchResult.tracks.length) {
          await interaction.deleteReply().catch(() => {});
          await interaction.followUp({ content: 'No results found for that query.', flags: MessageFlags.Ephemeral });
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
          .setColor('#f97316')
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
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
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      await player.stopPlaying(true);
      player.queue.tracks.splice(0, player.queue.tracks.length);
      await queuePersist(player);
      await interaction.client.musicUI.refresh(player);
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
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { player } = await ensurePlayer(interaction);
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

      const removed = await player.queue.splice(start, end - start + 1);
      await queuePersist(player);
      await interaction.editReply(`Removed ${removed.length} item(s) from the queue.`);
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

      const [track] = await player.queue.splice(from, 1);
      await player.queue.splice(to, 0, track);
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
      if (!player.queue.current) {
        throw new CommandError('Nothing is playing.');
      }
      const targetPosition = parseTimecode(interaction.options.getString('position', true));
      await player.seek(targetPosition);
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
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
    data: new SlashCommandBuilder().setName('autoplay').setDescription('Toggle autoplay - automatically plays similar tracks.'),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await ensurePlayer(interaction, { requireSameChannel: true });
      
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
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
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
          .setColor('#0ea5e9')
          .setDescription(description);

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (sub === 'clear') {
        await player.filterManager.resetFilters();
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
      .setDescription('Manage guild settings.')
      .addSubcommand((sub) =>
        sub.setName('get').setDescription('Show current configuration.'),
      )
      .addSubcommand((sub) =>
        sub
          .setName('set')
          .setDescription('Set selected options.')
          .addRoleOption((option) => option.setName('dj_role').setDescription('Rola DJ.'))
          .addIntegerOption((option) =>
            option.setName('max_volume').setDescription('Maximum volume (0-150).'),
          )
          .addNumberOption((option) =>
            option.setName('voteskip_percent').setDescription('Vote skip threshold (0-1).'),
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
      .addSubcommand((sub) => sub.setName('reset').setDescription('Restore default settings.')),
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const sub = interaction.options.getSubcommand();
      if (sub === 'get') {
        const config = getConfig(interaction.guildId);
        const embed = new EmbedBuilder()
          .setTitle('Current configuration')
          .setColor('#14b8a6')
          .setDescription(`\`\`\`\n${formatConfig(config)}\n\`\`\``);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new CommandError('Manage Guild permission is required.');
      }

      if (sub === 'reset') {
        deleteConfig(interaction.guildId);
        const fresh = getConfig(interaction.guildId);
        const embed = new EmbedBuilder()
          .setTitle('Configuration reset')
          .setColor('#f97316')
          .setDescription(`\`\`\`\n${formatConfig(fresh)}\n\`\`\``);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const updates = {};
      const djRole = interaction.options.getRole('dj_role');
      if (djRole) updates.djRoleId = djRole.id;
      const maxVolume = interaction.options.getInteger('max_volume');
      if (maxVolume !== null) updates.maxVolume = Math.max(10, Math.min(200, maxVolume));
      const voteSkip = interaction.options.getNumber('voteskip_percent');
      if (voteSkip !== null) updates.voteSkipPercent = Math.min(Math.max(voteSkip, 0.1), 1);
      const stay = interaction.options.getBoolean('stay_24_7');
      if (stay !== null) updates.stayInChannel = stay;
      const voiceChannel = interaction.options.getChannel('voice_channel');
      if (voiceChannel) updates.twentyFourSevenChannelId = voiceChannel.id;
      const afk = interaction.options.getInteger('afk_timeout');
      if (afk !== null) updates.afkTimeout = Math.max(1, afk) * 60 * 1000;
      const persistent = interaction.options.getBoolean('persistent_queue');
      if (persistent !== null) updates.persistentQueue = persistent;
      const prefSource = interaction.options.getString('preferred_source');
      if (prefSource) updates.preferredSource = prefSource;

      const updated = setConfig(interaction.guildId, updates);
      const embed = new EmbedBuilder()
        .setTitle('Configuration updated')
        .setColor('#6366f1')
        .setDescription(`\`\`\`\n${formatConfig(updated)}\n\`\`\``);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('bread').setDescription('Send some fresh bread.'),
    async execute(interaction) {
      const breadAttachment = new AttachmentBuilder(BREAD_IMAGE_PATH).setName('bread.png');
      const breadEmbed = new EmbedBuilder()
        .setTitle('Fresh bread delivery')
        .setDescription('Because bread makes everything better.')
        .setImage('attachment://bread.png')
        .setColor('#f59e0b');
      await interaction.reply({ embeds: [breadEmbed], files: [breadAttachment] });

      const sendableChannels = interaction.guild?.channels?.cache.filter((channel) => {
        if (channel.type !== ChannelType.GuildText) return false;
        const permissions = channel.permissionsFor(interaction.client.user);
        return (
          permissions?.has(PermissionFlagsBits.ViewChannel) &&
          permissions?.has(PermissionFlagsBits.SendMessages)
        );
      });

      if (!sendableChannels?.size) return;

      const alternativeChannels = sendableChannels.filter(
        (channel) => channel.id !== interaction.channelId,
      );
      const pool = alternativeChannels.size ? alternativeChannels : sendableChannels;
      const poolArray = [...pool.values()];
      const randomChannel = poolArray[Math.floor(Math.random() * poolArray.length)];
      if (!randomChannel) return;

      const monsterAttachment = new AttachmentBuilder(
        MONSTER_BREAD_IMAGE_PATH,
      ).setName('monsterbread.png');
      const monsterEmbed = new EmbedBuilder()
        .setTitle('Monster Bread is coming')
        .setDescription('Who dares to take a slice?')
        .setImage('attachment://monsterbread.png')
        .setColor('#8b5cf6');

      try {
        await randomChannel.send({ embeds: [monsterEmbed], files: [monsterAttachment] });
      } catch {
        // Sending to a random channel is best-effort.
      }
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
        .setColor('#6366f1')
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
      )
      .addUserOption((option) =>
        option
          .setName('opponent')
          .setDescription('Challenge another user to a duel'),
      )
      .addIntegerOption((option) =>
        option
          .setName('bet')
          .setDescription('Amount to bet (for duels)')
          .setMinValue(1),
      ),
    async execute(interaction) {
      const choice = interaction.options.getString('choice', true);
      const opponent = interaction.options.getUser('opponent');
      const bet = interaction.options.getInteger('bet') || 0;
      
      if (!opponent) {
        const result = playRPS(choice);
        const embed = buildRPSEmbed(result.playerChoice, result.botChoice, result.result, interaction.user.username);
        await interaction.reply({ embeds: [embed] });
        return;
      }
      
      if (opponent.id === interaction.user.id) {
        await interaction.reply({ content: "You can't challenge yourself!", flags: MessageFlags.Ephemeral });
        return;
      }
      
      if (opponent.bot) {
        await interaction.reply({ content: "You can't challenge a bot! Use `/rps choice:rock` without opponent to play against the bot.", flags: MessageFlags.Ephemeral });
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
      
      const challenge = createChallenge(
        interaction.user.id,
        interaction.user.username,
        opponent.id,
        opponent.username,
        bet,
        choice
      );
      
      const embed = buildRPSChallengeEmbed(challenge);
      const components = buildRPSChallengeComponents(challenge.id, opponent.id);
      
      const { resource } = await interaction.reply({ 
        content: `<@${opponent.id}>`, 
        embeds: [embed], 
        components,
        withResponse: true,
      });
      
      setMessageInfo(challenge.id, resource.message.channelId, resource.message.id);
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
