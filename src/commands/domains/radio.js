const defaultRadio = require('../../music/radio');
const { isStreamTrack } = require('../../music/autoplay/normalize');

const AUTOCOMPLETE_LIMIT = 15;

const createRadioCommands = (context) => {
  const {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    ensureVoice,
    classifyPlaybackError,
    describeSearchFailure,
    queuePersist,
    BRAND_COLORS,
    radio = defaultRadio,
  } = context;

  async function failQuietly(interaction, title, description) {
    await interaction.deleteReply().catch(() => {});
    await interaction.followUp({ content: `**${title}**\n${description}`, flags: MessageFlags.Ephemeral });
  }

  // The stream itself carries no useful metadata, so the station details become the track info.
  function dressTrack(track, station) {
    const location = radio.describeStationLocation(station);
    track.info.title = station.name;
    track.info.author = location || station.tags.join(', ') || 'Live radio';
    track.info.isStream = true;
    if (station.favicon) track.info.artworkUrl = station.favicon;
    if (station.homepage) track.info.uri = station.homepage;
    track.radioStation = { id: station.id, source: station.source };
    return track;
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
      async autocomplete(interaction) {
        const focused = String(interaction.options.getFocused() ?? '').trim();
        if (/^https?:\/\//i.test(focused)) {
          await interaction.respond([{ name: focused.slice(0, 100), value: focused.slice(0, 100) }]).catch(() => {});
          return;
        }
        try {
          const stations = await radio.searchStations(focused, { limit: AUTOCOMPLETE_LIMIT });
          await interaction.respond(stations.map(radio.formatStationChoice)).catch(() => {});
        } catch {
          await interaction.respond([]).catch(() => {});
        }
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

        let result;
        try {
          result = await player.search(station.url, interaction.user);
        } catch (error) {
          const failure = classifyPlaybackError(error);
          await failQuietly(interaction, failure.title, failure.description);
          return;
        }
        const track = result?.tracks?.[0];
        if (!track) {
          const failure = describeSearchFailure(result);
          await failQuietly(interaction, 'Station is not playing', failure.description);
          return;
        }
        dressTrack(track, station);

        // A station never ends, so picking another one while radio plays switches right away.
        const replacing = Boolean(player.queue.current && isStreamTrack(player.queue.current) && (player.playing || player.paused));
        if (replacing) {
          await player.queue.add(track, 0);
          await player.skip();
          if (player.paused) await player.resume();
        } else {
          const autoplayIndex = player.queue.tracks.findIndex((queued) => queued.isAutoplay);
          if (autoplayIndex !== -1) player.queue.tracks.splice(autoplayIndex, 0, track);
          else await player.queue.add(track);
          if (!player.playing && !player.paused) await player.play();
        }

        radio.reportPlay(station);
        await queuePersist(player);
        await interaction.editReply({ embeds: [buildStationEmbed(station, interaction.user, voiceChannelId, replacing)] });
      },
    },
  ];
};

module.exports = { createRadioCommands };
