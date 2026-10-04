const {
  COMPONENT_PREFIX,
  RANGES,
  VIEW_KEYS,
  buildStatsReply,
  normalizeRange,
  normalizeView,
  parseCustomId,
} = require('../../stats/panel');
const { VIEWS } = require('../../stats/views');

const createStatsCommands = (context) => {
  const { SlashCommandBuilder, MessageFlags, CommandError, getBalance } = context;

  async function resolveTarget(guild, userId) {
    if (!userId) return null;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    const user = member?.user || await guild.client.users.fetch(userId).catch(() => null);
    if (!user) throw new CommandError('That member could not be found.');
    return { user, member };
  }

  return [
    {
      componentPrefix: COMPONENT_PREFIX,
      data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Bread statistics as an image: overview, top, sources, rhythm and Arcade.')
        .addUserOption((option) => option.setName('member').setDescription('Only this member (defaults to the whole server)'))
        .addStringOption((option) =>
          option
            .setName('range')
            .setDescription('Time range')
            .addChoices(...Object.entries(RANGES).map(([value, name]) => ({ name, value }))),
        )
        .addStringOption((option) =>
          option
            .setName('view')
            .setDescription('Which view to open first')
            .addChoices(...VIEW_KEYS.map((value) => ({ name: VIEWS[value].label, value }))),
        ),
      async execute(interaction) {
        if (!interaction.guildId) throw new CommandError('Stats are only available in a server.');
        await interaction.deferReply();
        const user = interaction.options.getUser('member');
        const state = {
          guildId: interaction.guildId,
          ownerId: interaction.user.id,
          targetId: user?.id || null,
          view: normalizeView(interaction.options.getString('view')),
          range: normalizeRange(interaction.options.getString('range')),
        };
        const target = user
          ? { user, member: interaction.options.getMember('member') || null }
          : null;
        await interaction.editReply(await buildStatsReply(context, state, { guild: interaction.guild, target, getBalance }));
      },
      async handleComponent(interaction) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        if (parsed.ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'Run `/stats` yourself to browse your own copy.', flags: MessageFlags.Ephemeral });
          return;
        }
        const view = parsed.action === 'view' ? normalizeView(interaction.values?.[0]) : parsed.view;
        await interaction.deferUpdate();
        const target = await resolveTarget(interaction.guild, parsed.targetId);
        const state = { guildId: interaction.guildId, ownerId: parsed.ownerId, targetId: parsed.targetId, view, range: parsed.range };
        await interaction.editReply(await buildStatsReply(context, state, { guild: interaction.guild, target, getBalance }));
      },
    },
  ];
};

module.exports = { createStatsCommands };
