const { registerVote, resetVotes } = require('./voteManager');
const { hasDJPermissions } = require('../state/guildConfig');
const { CommandError } = require('./utils');

async function resolveMember(interaction) {
  if (interaction.member) return interaction.member;
  if (interaction.guild) {
    try {
      return await interaction.guild.members.fetch(interaction.user.id);
    } catch {
      return null;
    }
  }
  return null;
}

async function handleSkipRequest(interaction, player, config) {
  if (!player.queue.current && player.queue.tracks.length === 0) {
    return { skipped: false, message: 'There is nothing to skip.' };
  }

  const member = await resolveMember(interaction);
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    throw new CommandError('You must join a voice channel to use skip.');
  }

  const requiresDjRole = Boolean(config.djRoleId);
  if (!requiresDjRole || hasDJPermissions(member, config)) {
    await player.skip();
    resetVotes(player.guildId);
    return { skipped: true, message: 'Skipped the track.' };
  }

  const listeners = voiceChannel.members.filter((m) => !m.user.bot).size;
  const requiredVotes = Math.max(1, Math.ceil(listeners * config.voteSkipPercent));
  const votes = registerVote(player.guildId, interaction.user.id);
  if (votes >= requiredVotes) {
    await player.skip();
    resetVotes(player.guildId);
    return { skipped: true, message: 'Vote threshold reached. Skipped the track.' };
  }

  const remaining = Math.max(0, requiredVotes - votes);
  return {
    skipped: false,
    message: `Vote registered (${votes}/${requiredVotes}). Need ${remaining} more.`,
  };
}

module.exports = {
  handleSkipRequest,
};
