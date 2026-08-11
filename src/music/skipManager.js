const { registerVote, resetVotes } = require('./voteManager');
const { hasDJPermissions } = require('../state/guildConfig');
const { CommandError } = require('./utils');
const { isAutoplayEnabled, handleAutoplay, addToRecentTracks, recordAutoplaySkip } = require('./autoplay');

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

async function handleSkipRequest(interaction, player, config, client) {
  if (!player.queue.current && player.queue.tracks.length === 0) {
    return { skipped: false, message: 'There is nothing to skip.', needsAutoplay: false };
  }
  
  const isLastTrack = player.queue.tracks.length === 0 && player.queue.current;

  const member = await resolveMember(interaction);
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    throw new CommandError('You must join a voice channel to use skip.');
  }

  const playerChannel = player.voiceChannelId
    ? interaction.guild?.channels?.cache?.get(player.voiceChannelId)
    : null;
  if (playerChannel && playerChannel.id !== voiceChannel.id) {
    throw new CommandError('You must be in the same voice channel as the bot to use skip.');
  }

  const requiresDjRole = Boolean(config.djRoleId);
  if (!requiresDjRole || hasDJPermissions(member, config)) {
    if (isLastTrack) {
      const currentTrack = player.queue.current;
      recordAutoplaySkip(player.guildId, currentTrack, { position: player.position });
      await player.stopPlaying(false, false);
      resetVotes(player.guildId);
      
      if (isAutoplayEnabled(player.guildId)) {
        return { skipped: true, message: 'Skipped the track.', needsAutoplay: true, lastTrack: currentTrack };
      }
      return { skipped: true, message: 'Skipped the track.', needsAutoplay: false };
    }
    
    recordAutoplaySkip(player.guildId, player.queue.current, { position: player.position });
    await player.skip();
    resetVotes(player.guildId);
    return { skipped: true, message: 'Skipped the track.', needsAutoplay: false };
  }

  const eligibleUserIds = new Set(
    voiceChannel.members
      .filter((m) => !m.user.bot)
      .map((m) => m.id),
  );
  const listeners = eligibleUserIds.size;
  const requiredVotes = Math.max(1, Math.ceil(listeners * config.voteSkipPercent));
  const currentTrackKey = player.queue.current?.info?.identifier
    || player.queue.current?.info?.uri
    || player.queue.current?.info?.title
    || 'unknown-track';
  const votes = registerVote(player.guildId, interaction.user.id, eligibleUserIds, currentTrackKey);
  if (votes >= requiredVotes) {
    if (isLastTrack) {
      const currentTrack = player.queue.current;
      recordAutoplaySkip(player.guildId, currentTrack, { position: player.position });
      await player.stopPlaying(false, false);
      resetVotes(player.guildId);
      
      if (isAutoplayEnabled(player.guildId)) {
        return { skipped: true, message: 'Vote threshold reached. Skipped the track.', needsAutoplay: true, lastTrack: currentTrack };
      }
      return { skipped: true, message: 'Vote threshold reached. Skipped the track.', needsAutoplay: false };
    }
    
    recordAutoplaySkip(player.guildId, player.queue.current, { position: player.position });
    await player.skip();
    resetVotes(player.guildId);
    return { skipped: true, message: 'Vote threshold reached. Skipped the track.', needsAutoplay: false };
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
