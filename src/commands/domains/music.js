const createMusicCommands = (context) => {
  const {
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
  } = context;
  return [
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

      tracksToAdd.forEach((track) => addManualSeed(player.guildId, track));

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
      const result = await withGuildMutex(interaction.guildId, () =>
        handleSkipRequest(interaction, player, config, interaction.client),
      );
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
        await seekTrack(player, targetPosition);
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
  ];
};

module.exports = { createMusicCommands };
