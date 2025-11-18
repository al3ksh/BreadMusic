const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  ChannelType,
} = require('discord.js');
const path = require('path');
const { ensureVoice, ensurePlayer, CommandError } = require('../music/utils');
const { buildTrackEmbed, buildNowPlayingEmbed } = require('../music/embeds');
const { savePlayerState } = require('../state/queueStore');
const {
  getConfig,
  setConfig,
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
} = require('../games/blackjack');
const { applyPreferredSource, getYouTubeOnlyQueryError } = require('../music/searchUtils');
const { handleSkipRequest } = require('../music/skipManager');
const { deleteInteractionReply } = require('../utils/interactions');

const BREAD_IMAGE_PATH = path.resolve(__dirname, '..', 'assets', 'images', 'bread.png');
const MONSTER_BREAD_IMAGE_PATH = path.resolve(
  __dirname,
  '..',
  'assets',
  'images',
  'monsterbread.png',
);

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

const commands = [
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Command list and quick tips.'),
    async execute(interaction) {
      const embed = new EmbedBuilder()
        .setTitle('NeoBeat Buddy - help')
        .setDescription(
          'All controls use slash commands + buttons. Most popular: `/play`, `/queue`, `/filter preset bassboost`.\nRemember that DJ role (or Manage Guild) is required for administrative commands.',
        )
        .addFields(
          { name: '/play <link/query>', value: 'Adds a track or playlist. Shows a select menu with top 5 matches.' },
          { name: '/queue', value: 'Displays the queue with pagination + ETA.' },
          { name: '/loop off|track|queue', value: 'Sets repeat mode for the current track or entire queue.' },
          { name: '/filter preset <name>', value: 'Quick presets: bassboost, nightcore, vaporwave, soft, karaoke.' },
          { name: '/config set', value: 'Adjust provider, maxVolume, 24/7 settings, vote skip threshold and more.' },
          { name: '/clearqueue', value: 'DJ-only: clear upcoming tracks while current song keeps playing.' },
          { name: '/ping', value: 'Check bot latency + heartbeat.' },
        )
        .setColor('#10b981');

      await interaction.reply({ embeds: [embed], ephemeral: true });
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
          ephemeral: true,
        });
        return;
      }

      if (!resolvedTrack) {
        const restrictionMessage = getYouTubeOnlyQueryError(rawQuery);
        if (restrictionMessage) {
          await interaction.reply({ content: restrictionMessage, ephemeral: true });
          return;
        }
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
          await interaction.editReply('No results found for that query.');
          return;
        }
        isPlaylist = Boolean(searchResult.playlist);
        playlistName = searchResult.playlist?.name;
        tracksToAdd = isPlaylist ? searchResult.tracks : [searchResult.tracks[0]];
      }

      await player.queue.add(isPlaylist ? tracksToAdd : tracksToAdd[0]);
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
      await interaction.deferReply({ ephemeral: true });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      const result = await handleSkipRequest(interaction, player, config);
      if (result.skipped) {
        await queuePersist(player);
        await interaction.client.musicUI.refresh(player);
        await deleteInteractionReply(interaction);
        return;
      }
      await interaction.editReply(result.message);
    },
  },
  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback.'),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
      const { player } = await ensurePlayer(interaction);
      await player.destroy('manual-leave', true);
      await interaction.client.musicUI.clear(interaction.guildId);
      await deleteInteractionReply(interaction);
    },
  },
  {
    data: new SlashCommandBuilder().setName('queue').setDescription('Show the queue with pagination.'),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
      const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
      const index = interaction.options.getInteger('index', true);

      if (index < 1 || index > player.queue.tracks.length) {
        throw new CommandError('Invalid index.');
      }

      await player.queue.splice(0, index - 1);
      await player.skip();
      await queuePersist(player);
      await interaction.editReply(`Skoczono do pozycji ${index}.`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('back').setDescription('Go back to the previous track.'),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
      await interaction.deferReply({ ephemeral: true });
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
                { name: 'Bassboost', value: 'bassboost' },
                { name: 'Nightcore', value: 'nightcore' },
                { name: 'Vaporwave', value: 'vaporwave' },
                { name: 'Soft', value: 'soft' },
                { name: 'Karaoke', value: 'karaoke' },
              ),
          ),
      )
      .addSubcommand((sub) => sub.setName('clear').setDescription('Reset filters.'))
      .addSubcommand((sub) => sub.setName('list').setDescription('Show active filters.')),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      assertDJ(interaction, config);
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const filters = player.filterManager.filters;
        const entries = Object.entries(filters)
          .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
          .join('\n');
        await interaction.editReply(`Current filters:\n${entries || 'none'}`);
        return;
      }

      if (sub === 'clear') {
        await player.filterManager.resetFilters();
        await interaction.editReply('Filters cleared.');
        return;
      }

      const preset = interaction.options.getString('name', true);
      const handler = FILTER_PRESETS[preset];
      if (!handler) throw new CommandError('Unknown preset.');
      await handler(player.filterManager);
      await player.filterManager.applyPlayerFilters();
      await interaction.editReply(`Applied preset **${preset}**.`);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('crossfade')
      .setDescription('Set crossfade (seconds).')
      .addIntegerOption((option) =>
        option.setName('seconds').setDescription('Time in seconds').setRequired(true),
      ),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const seconds = Math.max(0, interaction.options.getInteger('seconds', true));
      const updated = setConfig(interaction.guildId, { crossfadeSeconds: seconds });
      await interaction.editReply(`Crossfade set to ${updated.crossfadeSeconds}s.`);
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
          .addChannelOption((option) =>
            option.setName('announce_channel').setDescription('Announcement text channel.'),
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
      ),
    async execute(interaction) {
      await interaction.deferReply({ ephemeral: true });
      const sub = interaction.options.getSubcommand();
      if (sub === 'get') {
        const config = getConfig(interaction.guildId);
        await interaction.editReply(`\`\`\`\n${formatConfig(config)}\n\`\`\``);
        return;
      }

      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        throw new CommandError('Manage Guild permission is required.');
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
      const announceChannel = interaction.options.getChannel('announce_channel');
      if (announceChannel) updates.announceChannelId = announceChannel.id;
      const afk = interaction.options.getInteger('afk_timeout');
      if (afk !== null) updates.afkTimeout = Math.max(1, afk) * 60 * 1000;
      const persistent = interaction.options.getBoolean('persistent_queue');
      if (persistent !== null) updates.persistentQueue = persistent;
      const prefSource = interaction.options.getString('preferred_source');
      if (prefSource) updates.preferredSource = prefSource;

      const updated = setConfig(interaction.guildId, updates);
      await interaction.editReply(`Saved settings:\n\`\`\`\n${formatConfig(updated)}\n\`\`\``);
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
      const sent = await interaction.reply({ content: 'Ping...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`Pong! Websocket: ${interaction.client.ws.ping}ms | RTT: ${latency}ms`);
    },
  },
  {
    data: new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack versus the dealer.'),
    async execute(interaction) {
      endBlackjack(interaction.user.id);
      const game = startBlackjack(interaction.user.id);
      const embed = buildBlackjackEmbed(interaction.user, game);
      const components = buildBlackjackComponents(interaction.user.id, false);
      await interaction.reply({ embeds: [embed], components });
    },
  },
];

module.exports = {
  commands,
};



