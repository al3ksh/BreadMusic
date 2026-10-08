const { tagOrigin } = require('../../music/trackOrigin');
const { queueRequestedTracks, fitQueueLimit } = require('../../music/queueInsert');
const library = require('../../music/library');

const CREATE_FAILURES = {
  name: 'Give the playlist a name.',
  exists: 'You already have a playlist with that name.',
  limit: `You can keep up to ${library.LIBRARY_LIMITS.playlists} playlists.`,
};

const SHARE_FAILURES = {
  unknown: 'No shared playlist has that code.',
  own: 'That is your own playlist.',
};

function findUsableNode(client) {
  const nodes = client.lavalink?.nodeManager?.nodes;
  if (!nodes) return null;
  for (const node of nodes.values()) {
    if (node.connected) return node;
  }
  return nodes.values().next().value ?? null;
}

const createLibraryCommands = (context) => {
  const {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    ensureVoice,
    CommandError,
    addManualSeed,
    queuePersist,
    formatDuration,
    BRAND_COLORS,
  } = context;

  // Queues saved entries before any autoplay suggestions, like /play does.
  async function queueEntries(interaction, name, entries, shuffle) {
    if (entries.length === 0) throw new CommandError(`**${name}** is empty.`);
    const { player, voiceChannelId, config } = await ensureVoice(interaction, { requireSameChannel: true, createPlayer: true });
    const ordered = shuffle ? library.shuffled(entries) : entries;
    const { tracks, skipped } = fitQueueLimit(
      player,
      tagOrigin(ordered.map((entry) => library.entryToTrack(entry, interaction.user)), 'library'),
      { userId: interaction.user.id, member: interaction.member, config },
    );
    tracks.forEach((track) => addManualSeed(player.guildId, track, { invalidatePrefetch: false }));
    await queueRequestedTracks(player, tracks);
    if (!player.playing && !player.paused) await player.play();
    await queuePersist(player);

    const embed = new EmbedBuilder()
      .setTitle(shuffle ? 'Playlist shuffled in' : 'Playlist queued')
      .setDescription(`**${name}**`)
      .addFields(
        { name: 'Tracks', value: `${tracks.length}`, inline: true },
        { name: 'Voice channel', value: `<#${voiceChannelId}>`, inline: true },
      )
      .setColor(BRAND_COLORS.primary)
      .setTimestamp();
    if (skipped > 0) embed.setFooter({ text: `${skipped} more left out: the limit is ${config.maxQueuedPerUser} waiting tracks per person.` });
    await interaction.editReply({ embeds: [embed] });
  }

  function currentTracks(interaction, withQueue) {
    const player = interaction.client.lavalink?.getPlayer?.(interaction.guildId);
    const current = player?.queue?.current ? [player.queue.current] : [];
    return withQueue ? [...current, ...(player?.queue?.tracks ?? [])] : current;
  }

  function describeSave(result, verb) {
    const skipped = result.skipped > 0 ? ` (${result.skipped} skipped: duplicates, uploads or streams)` : '';
    return `${verb} **${result.added}** track${result.added === 1 ? '' : 's'} to **${result.playlist.name}**${skipped}.`;
  }

  async function play(interaction) {
    const name = interaction.options.getString('name', true);
    const shuffle = interaction.options.getBoolean('shuffle') ?? false;
    await interaction.deferReply();
    const playable = library.resolvePlayable(interaction.user.id, name);
    if (!playable) throw new CommandError(`You have no playlist called **${name}**. See \`/playlist list\`.`);
    await queueEntries(interaction, playable.name, playable.tracks, shuffle);
  }

  async function save(interaction) {
    const name = interaction.options.getString('name', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const tracks = currentTracks(interaction, true);
    if (tracks.length === 0) throw new CommandError('Nothing is playing right now.');
    const result = library.createPlaylist(interaction.user.id, name, tracks);
    if (!result.ok) throw new CommandError(CREATE_FAILURES[result.reason]);
    await interaction.editReply(describeSave(result, 'Saved'));
  }

  async function add(interaction) {
    const name = interaction.options.getString('name', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const tracks = currentTracks(interaction, false);
    if (tracks.length === 0) throw new CommandError('Nothing is playing right now.');
    if (!library.canSaveTrack(tracks[0])) throw new CommandError('Uploads and live streams cannot be saved to playlists.');
    const userId = interaction.user.id;
    if (!library.getPlaylist(userId, name)) {
      const created = library.createPlaylist(userId, name, tracks);
      if (!created.ok) throw new CommandError(CREATE_FAILURES[created.reason]);
      await interaction.editReply(`Created **${created.playlist.name}** with **${tracks[0].info.title}**.`);
      return;
    }
    const result = library.addToPlaylist(userId, name, tracks);
    if (!result.ok) throw new CommandError(result.reason === 'full' ? 'This playlist is full.' : 'Playlist not found.');
    if (result.added === 0) {
      await interaction.editReply(`**${tracks[0].info.title}** is already in **${result.playlist.name}**.`);
      return;
    }
    await interaction.editReply(`Added **${tracks[0].info.title}** to **${result.playlist.name}**.`);
  }

  async function list(interaction) {
    const userId = interaction.user.id;
    const playlists = library.listPlaylists(userId);
    const likedCount = library.listLiked(userId).length;
    const lines = playlists.map((playlist) =>
      `**${playlist.name}** - ${playlist.trackCount} track${playlist.trackCount === 1 ? '' : 's'}, ${formatDuration(playlist.duration)}${playlist.shareCode ? ` - shared as \`${playlist.shareCode}\`` : ''}`);
    const embed = new EmbedBuilder()
      .setTitle('Your library')
      .setDescription([
        `❤️ **Liked** - ${likedCount} track${likedCount === 1 ? '' : 's'}`,
        ...(lines.length ? lines : ['No playlists yet. Use `/playlist save` or `/playlist import`.']),
      ].join('\n').slice(0, 4000))
      .setColor(BRAND_COLORS.primary);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  async function remove(interaction) {
    const name = interaction.options.getString('name', true);
    const playlist = library.getPlaylist(interaction.user.id, name);
    if (!playlist || !library.deletePlaylist(interaction.user.id, playlist.id)) {
      throw new CommandError(`You have no playlist called **${name}**.`);
    }
    await interaction.reply({ content: `Deleted **${playlist.name}**.`, flags: MessageFlags.Ephemeral });
  }

  async function share(interaction) {
    const name = interaction.options.getString('name', true);
    const stop = interaction.options.getBoolean('stop') ?? false;
    const result = library.setPlaylistShared(interaction.user.id, name, !stop);
    if (!result.ok) throw new CommandError(`You have no playlist called **${name}**.`);
    const content = stop
      ? `**${result.playlist.name}** is no longer shared. Copies others already made stay theirs.`
      : `Share code for **${result.playlist.name}**: \`${result.code}\`
Others can copy it with \`/playlist import url:${result.code}\` or the Library tab in Activity.`;
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  async function importLink(interaction) {
    const url = interaction.options.getString('url', true).trim();
    const name = interaction.options.getString('name');
    const shareCode = library.parseShareCode(url);
    if (shareCode) {
      const copied = library.importShared(interaction.user.id, shareCode, name);
      if (!copied.ok) throw new CommandError(SHARE_FAILURES[copied.reason] ?? CREATE_FAILURES[copied.reason]);
      await interaction.reply({ content: `${describeSave(copied, 'Copied')} Play it with \`/playlist play\`.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!/^https?:\/\//i.test(url)) throw new CommandError('Paste a Spotify, YouTube or SoundCloud playlist link, or a share code.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const node = findUsableNode(interaction.client);
    if (!node) throw new CommandError('No available Lavalink connection.');
    let result;
    try {
      result = await node.search({ query: url }, interaction.user);
    } catch (error) {
      throw new CommandError(`Could not load that link: ${error.message}`);
    }
    const tracks = result?.tracks ?? [];
    if (tracks.length === 0) throw new CommandError('No tracks found at that link.');
    const created = library.createPlaylistWithFreeName(interaction.user.id, name || result?.playlist?.name || 'Imported', tracks);
    if (!created.ok) throw new CommandError(CREATE_FAILURES[created.reason]);
    await interaction.editReply(`${describeSave(created, 'Imported')} Play it with \`/playlist play\`.`);
  }

  const handlers = { play, save, add, list, delete: remove, import: importLink, share };
  const nameOption = (description, autocomplete = true) => (option) =>
    option.setName('name').setDescription(description).setRequired(true).setMaxLength(library.LIBRARY_LIMITS.name).setAutocomplete(autocomplete);

  return [
    {
      data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('Your own playlists.')
        .addSubcommand((sub) => sub.setName('play').setDescription('Queue one of your playlists.')
          .addStringOption(nameOption('Playlist name.'))
          .addBooleanOption((option) => option.setName('shuffle').setDescription('Shuffle it first.')))
        .addSubcommand((sub) => sub.setName('save').setDescription('Save the current track and queue as a new playlist.')
          .addStringOption(nameOption('Name for the new playlist.', false)))
        .addSubcommand((sub) => sub.setName('add').setDescription('Add the current track to a playlist (creates it if needed).')
          .addStringOption(nameOption('Playlist name.')))
        .addSubcommand((sub) => sub.setName('list').setDescription('Show your playlists.'))
        .addSubcommand((sub) => sub.setName('delete').setDescription('Delete one of your playlists.')
          .addStringOption(nameOption('Playlist name.')))
        .addSubcommand((sub) => sub.setName('share').setDescription('Get a code others can use to copy one of your playlists.')
          .addStringOption(nameOption('Playlist name.'))
          .addBooleanOption((option) => option.setName('stop').setDescription('Stop sharing it instead.')))
        .addSubcommand((sub) => sub.setName('import').setDescription('Import a playlist link, or copy a playlist from a share code.')
          .addStringOption((option) => option.setName('url').setDescription('Spotify, YouTube or SoundCloud link, or a share code.').setRequired(true).setMaxLength(500))
          .addStringOption((option) => option.setName('name').setDescription('Name for the playlist (defaults to the original).').setMaxLength(library.LIBRARY_LIMITS.name))),
      async execute(interaction) {
        await handlers[interaction.options.getSubcommand()](interaction);
      },
      async autocomplete(interaction) {
        const focused = String(interaction.options.getFocused() ?? '').trim().toLowerCase();
        const choices = library.listPlaylists(interaction.user.id)
          .filter((playlist) => playlist.name.toLowerCase().includes(focused))
          .slice(0, 25)
          .map((playlist) => ({ name: `${playlist.name} (${playlist.trackCount})`.slice(0, 100), value: playlist.name }));
        await interaction.respond(choices).catch(() => {});
      },
    },
    {
      data: new SlashCommandBuilder()
        .setName('liked')
        .setDescription('Queue the tracks you liked.')
        .addBooleanOption((option) => option.setName('shuffle').setDescription('Shuffle them first.')),
      async execute(interaction) {
        await interaction.deferReply();
        const shuffle = interaction.options.getBoolean('shuffle') ?? false;
        const liked = library.listLiked(interaction.user.id);
        if (liked.length === 0) throw new CommandError('You have not liked anything yet. Use the like button or `/autoplay like`.');
        await queueEntries(interaction, 'Liked', liked, shuffle);
      },
    },
  ];
};

module.exports = { createLibraryCommands };
