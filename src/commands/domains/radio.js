const defaultRadio = require('../../music/radio');
const defaultLibrary = require('../../music/library');
const { playStation } = require('../../music/radioPlayback');

const AUTOCOMPLETE_LIMIT = 15;
const COMPONENT_PREFIX = 'radio:';
const SAVE_PREFIX = `${COMPONENT_PREFIX}save:`;

const createRadioCommands = (context) => {
  const {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    CommandError,
    ensureVoice,
    classifyPlaybackError,
    describeSearchFailure,
    queuePersist,
    BRAND_COLORS,
    radio = defaultRadio,
    library = defaultLibrary,
  } = context;

  async function failQuietly(interaction, title, description) {
    await interaction.deleteReply().catch(() => {});
    await interaction.followUp({ content: `**${title}**\n${description}`, flags: MessageFlags.Ephemeral });
  }

  function buildStationEmbed(station, user, voiceChannelId, replaced) {
    const details = [radio.describeStationLocation(station), station.tags.join(', '), station.bitrate ? `${station.bitrate} kbps ${station.codec}`.trim() : '']
      .filter(Boolean)
      .join(' · ');
    const embed = new EmbedBuilder()
      .setTitle(replaced ? '📻 Switched station' : '📻 Live radio')
      .setDescription(`**${station.name}**${details ? `\n${details}` : ''}`)
      .addFields({ name: 'Voice channel', value: voiceChannelId ? `<#${voiceChannelId}>` : 'Not connected', inline: true })
      .setColor(BRAND_COLORS.primary)
      .setFooter({ text: `Requested by ${user?.username ?? user?.id ?? 'someone'} · autoplay and lyrics pause on radio` })
      .setTimestamp();
    if (station.favicon) embed.setThumbnail(station.favicon);
    return embed;
  }

  // Custom ids are capped at 100 characters, so very long pasted stream links get no button.
  function buildSaveRow(station) {
    const customId = `${SAVE_PREFIX}${station.id}`;
    if (!ActionRowBuilder || customId.length > 100) return [];
    return [new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('Save station')
      .setEmoji('⭐')
      .setStyle(ButtonStyle.Secondary))];
  }

  function savedChoices(userId, term) {
    const needle = term.toLowerCase();
    return library.listStations(userId)
      .filter((station) => !needle || station.name.toLowerCase().includes(needle))
      .map((station) => {
        const choice = radio.formatStationChoice(station);
        return { ...choice, name: `⭐ ${choice.name}`.slice(0, 100) };
      });
  }

  return [
    {
      data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Play a live radio station.')
        .addStringOption((option) => option
          .setName('station')
          .setDescription('Station name, genre or country - or a stream / Radio Garden link.')
          .setAutocomplete(true)
          .setRequired(true)),
      componentPrefix: COMPONENT_PREFIX,
      // The save button toggles the station in the clicker's own list.
      async handleComponent(interaction) {
        if (!interaction.customId.startsWith(SAVE_PREFIX)) return;
        const stationId = interaction.customId.slice(SAVE_PREFIX.length);
        const userId = interaction.user.id;
        if (library.isStationSaved(userId, stationId)) {
          library.removeStation(userId, stationId);
          await interaction.reply({ content: 'Removed the station from your saved stations.', flags: MessageFlags.Ephemeral });
          return;
        }
        let station;
        try {
          station = await radio.resolveStation(stationId);
        } catch (error) {
          throw new CommandError(error instanceof radio.RadioError ? error.message : 'Could not look up that station.');
        }
        const result = library.saveStation(userId, station);
        if (!result.ok) {
          throw new CommandError(result.reason === 'limit'
            ? `You can save up to ${library.LIBRARY_LIMITS.stations} stations. Remove one in the Activity first.`
            : 'This station cannot be saved.');
        }
        await interaction.reply({
          content: `⭐ Saved **${station.name}**. Find it at the top of \`/radio\` and in the Activity radio tab.`,
          flags: MessageFlags.Ephemeral,
        });
      },
      async autocomplete(interaction) {
        const focused = String(interaction.options.getFocused() ?? '').trim();
        if (/^https?:\/\//i.test(focused)) {
          await interaction.respond([{ name: focused.slice(0, 100), value: focused.slice(0, 100) }]).catch(() => {});
          return;
        }
        // Your saved stations come first, then the directory.
        const saved = savedChoices(interaction.user?.id, focused);
        let found = [];
        try {
          found = (await radio.searchStations(focused, { limit: AUTOCOMPLETE_LIMIT })).map(radio.formatStationChoice);
        } catch {
          // The saved list still works when the directory is down.
        }
        const savedIds = new Set(saved.map((choice) => choice.value));
        const choices = [...saved, ...found.filter((choice) => !savedIds.has(choice.value))].slice(0, 25);
        await interaction.respond(choices).catch(() => {});
      },
      async execute(interaction) {
        await interaction.deferReply();
        const input = interaction.options.getString('station', true);
        let station;
        try {
          station = await radio.resolveStation(input);
        } catch (error) {
          await failQuietly(interaction, 'Station not found', error instanceof radio.RadioError ? error.message : 'Could not look up that station.');
          return;
        }

        const { player, voiceChannelId } = await ensureVoice(interaction, { requireSameChannel: true, createPlayer: true });

        let played;
        try {
          played = await playStation(player, station, interaction.user, { radio });
        } catch (error) {
          const failure = classifyPlaybackError(error);
          await failQuietly(interaction, failure.title, failure.description);
          return;
        }
        if (!played.track) {
          const failure = describeSearchFailure(played.result);
          await failQuietly(interaction, 'Station is not playing', failure.description);
          return;
        }

        await queuePersist(player);
        await interaction.editReply({
          embeds: [buildStationEmbed(station, interaction.user, voiceChannelId, played.replaced)],
          components: buildSaveRow(station),
        });
      },
    },
  ];
};

module.exports = { createRadioCommands, COMPONENT_PREFIX };
