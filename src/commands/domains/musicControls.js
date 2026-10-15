// @ts-check
const { likeTrack, dislikeTrack, rerollNext, REROLL_FAILURES } = require('../../music/autoplay');
const { buildDislikedPanel, handleDislikedComponent } = require('./autoplayDisliked');

const createMusicControlCommands = (context) => {
  const {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags,
    ensurePlayer,
    assertDJ,
    deleteInteractionReply,
    toggleAutoplay,
    queuePersist,
  } = context;
  return [
  {
    data: new SlashCommandBuilder()
      .setName('autoplay')
      .setDescription('Autoplay - automatically plays similar tracks.')
      .addSubcommand((sub) => sub.setName('toggle').setDescription('Turn autoplay on or off.'))
      .addSubcommand((sub) => sub.setName('like').setDescription('Like the current track so autoplay picks more like it.'))
      .addSubcommand((sub) => sub
        .setName('dislike')
        .setDescription('Dislike the current track; autoplay will avoid it.')
        .addBooleanOption((option) => option
          .setName('artist')
          .setDescription('Block the whole artist for your autoplay, not just this track.')))
      .addSubcommand((sub) => sub.setName('next').setDescription('Pick a different autoplay track to play next.'))
      .addSubcommand((sub) => sub.setName('disliked').setDescription('See and undo what you disliked or blocked for autoplay.')),
    componentPrefix: 'autoplay:',
    async handleComponent(interaction) {
      await handleDislikedComponent(context, interaction);
    },
    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.options.getSubcommand(false) === 'disliked') {
        await interaction.editReply(buildDislikedPanel(context, interaction.user.id));
        return;
      }
      const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
      const subcommand = interaction.options.getSubcommand(false) ?? 'toggle';

      if (subcommand === 'like') {
        const track = player.queue.current;
        const result = likeTrack(interaction.user.id, track);
        if (!result) {
          await interaction.editReply('This track cannot be liked.');
          return;
        }
        await interaction.client.musicUI.refresh(player);
        await interaction.editReply(
          result.liked
            ? `\uD83D\uDC4D Liked **${track.info.title}**. Autoplay will pick more like it.`
            : `Removed your like from **${track.info.title}**.`,
        );
        return;
      }

      // A dislike only steers autoplay; skipping stays with /skip.
      if (subcommand === 'dislike') {
        const track = player.queue.current;
        const blockArtist = interaction.options.getBoolean('artist') === true;
        const disliked = dislikeTrack(interaction.guildId, interaction.user.id, track, { artist: blockArtist });
        if (!disliked) {
          await interaction.editReply('This track cannot be disliked.');
          return;
        }
        const what = disliked.blockedArtist
          ? `Blocked **${track.info.author || 'this artist'}** for your autoplay`
          : `Disliked **${track.info.title}**. Autoplay will steer clear of it`;
        await interaction.editReply(`👎 ${what}. Undo it with \`/autoplay disliked\`.`);
        return;
      }

      if (subcommand === 'next') {
        const result = await rerollNext(player, interaction.client);
        if (!result.ok) {
          await interaction.editReply(REROLL_FAILURES[result.reason] ?? 'Could not reroll.');
          return;
        }
        await interaction.client.musicUI.refresh(player);
        await interaction.editReply(
          result.next
            ? `\uD83C\uDFB2 Up next: **${result.next.title}** by ${result.next.author || 'Unknown'}.`
            : '\uD83C\uDFB2 Picked a different next track.',
        );
        return;
      }

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
  ];
};

module.exports = { createMusicControlCommands };
