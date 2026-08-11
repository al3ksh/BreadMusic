const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { registerVote, resetVotes, getVoteState } = require('./voteManager');
const { hasDJPermissions } = require('../state/guildConfig');
const { CommandError } = require('./utils');
const { isAutoplayEnabled, recordAutoplaySkip } = require('./autoplay');
const { BRAND_COLORS } = require('../theme');

const VOTE_SKIP_BUTTON_PREFIX = 'voteskip';
const voteMessages = new Map();

function getTrackKey(track) {
  return track?.info?.identifier || track?.info?.uri || track?.info?.title || 'unknown-track';
}

function getTrackToken(trackKey) {
  return crypto.createHash('sha256').update(String(trackKey)).digest('hex').slice(0, 12);
}

function getEligibleUserIds(voiceChannel) {
  return new Set(voiceChannel.members.filter((member) => !member.user.bot).map((member) => member.id));
}

function getRequiredVotes(eligibleUserIds, config) {
  return Math.max(1, Math.ceil(eligibleUserIds.size * config.voteSkipPercent));
}

function isRequester(userId, track) {
  return Boolean(userId && track?.requester?.id && userId === track.requester.id);
}

function emitSkipNotice(client, player, title, voted = false) {
  client.emit?.('breadPlayerNotice', {
    guildId: player.guildId,
    message: `${voted ? 'Vote passed. ' : ''}Skipped ${title || 'the track'}.`,
    tone: 'success',
  });
}

function buildVotePayload(player, vote, options = {}) {
  const title = vote.title || player.queue.current?.info?.title || 'Current track';
  const complete = Boolean(options.complete);
  const voterMentions = (vote.userIds || []).slice(0, 20).map((userId) => `<@${userId}>`).join(', ');
  const hiddenVoterCount = Math.max(0, (vote.userIds?.length || 0) - 20);
  const voterList = voterMentions
    ? `${voterMentions}${hiddenVoterCount ? ` and ${hiddenVoterCount} more` : ''}`
    : 'No votes yet.';
  const embed = new EmbedBuilder()
    .setTitle(complete ? 'Vote skip passed' : 'Vote to skip')
    .setDescription(`**${title}**`)
    .addFields(
      {
        name: complete ? 'Result' : 'Votes',
        value: complete ? `${vote.votes}/${vote.requiredVotes} - track skipped` : `${vote.votes}/${vote.requiredVotes}`,
        inline: true,
      },
      { name: 'Voters', value: voterList.slice(0, 1024) },
    )
    .setColor(complete ? BRAND_COLORS.primary : BRAND_COLORS.secondary)
    .setFooter({ text: 'Only listeners in the bot voice channel can vote.' });

  if (typeof vote.latestVoter?.displayAvatarURL === 'function') {
    embed.setThumbnail(vote.latestVoter.displayAvatarURL({ size: 128 }));
  }

  const button = new ButtonBuilder()
    .setCustomId(`${VOTE_SKIP_BUTTON_PREFIX}:${player.guildId}:${getTrackToken(vote.trackKey)}`)
    .setLabel(complete ? 'Vote completed' : `Skip (${vote.votes}/${vote.requiredVotes})`)
    .setStyle(complete ? ButtonStyle.Success : ButtonStyle.Primary)
    .setDisabled(complete);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function resolveVoteChannel(interaction, player, client) {
  const channelId = player.textChannelId;
  if (channelId) {
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }
  return interaction.channel?.isTextBased?.() ? interaction.channel : null;
}

async function publishVote(interaction, player, client, vote) {
  const existing = voteMessages.get(player.guildId);
  const payload = buildVotePayload(player, vote);
  if (existing?.trackKey === vote.trackKey) {
    try {
      await existing.message.edit(payload);
      return;
    } catch {
      voteMessages.delete(player.guildId);
    }
  }

  const channel = await resolveVoteChannel(interaction, player, client);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.send(payload).catch(() => null);
  if (message) voteMessages.set(player.guildId, { trackKey: vote.trackKey, message });
}

async function clearVoteSkip(guildId, options = {}) {
  resetVotes(guildId);
  const existing = voteMessages.get(guildId);
  voteMessages.delete(guildId);
  if (!existing?.message) return;
  try {
    if (options.complete && options.player && options.vote) {
      await existing.message.edit(buildVotePayload(options.player, options.vote, { complete: true }));
      const timeout = setTimeout(() => existing.message.delete().catch(() => {}), 15_000);
      timeout.unref?.();
    } else {
      await existing.message.delete();
    }
  } catch (error) {
    if (error?.code !== 10008) console.warn('Failed to clear vote skip message:', error.message);
  }
}

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

  const currentTrack = player.queue.current;
  const currentTitle = currentTrack?.info?.title || 'the track';
  const requiresDjRole = Boolean(config.djRoleId);
  if (!requiresDjRole || hasDJPermissions(member, config) || isRequester(interaction.user.id, currentTrack)) {
    if (isLastTrack) {
      const currentTrack = player.queue.current;
      recordAutoplaySkip(player.guildId, currentTrack, { position: player.position });
      await player.stopPlaying(false, false);
      await clearVoteSkip(player.guildId);
      emitSkipNotice(client, player, currentTitle);
      
      if (isAutoplayEnabled(player.guildId)) {
        return { skipped: true, message: 'Skipped the track.', needsAutoplay: true, lastTrack: currentTrack };
      }
      return { skipped: true, message: 'Skipped the track.', needsAutoplay: false };
    }
    
    recordAutoplaySkip(player.guildId, player.queue.current, { position: player.position });
    await player.skip();
    await clearVoteSkip(player.guildId);
    emitSkipNotice(client, player, currentTitle);
    return { skipped: true, message: 'Skipped the track.', needsAutoplay: false };
  }

  const eligibleUserIds = getEligibleUserIds(voiceChannel);
  const requiredVotes = getRequiredVotes(eligibleUserIds, config);
  const currentTrackKey = getTrackKey(player.queue.current);
  const previousVote = getVoteState(player.guildId, eligibleUserIds, currentTrackKey);
  const alreadyVoted = previousVote?.userIds.has(interaction.user.id) || false;
  const votes = registerVote(player.guildId, interaction.user.id, eligibleUserIds, currentTrackKey);
  const currentVote = getVoteState(player.guildId, eligibleUserIds, currentTrackKey);
  const vote = {
    votes,
    requiredVotes,
    trackKey: currentTrackKey,
    title: player.queue.current?.info?.title || 'Current track',
    userIds: currentVote ? [...currentVote.userIds] : [],
    latestVoter: interaction.user,
  };
  if (votes >= requiredVotes) {
    await publishVote(interaction, player, client, vote);
    if (isLastTrack) {
      const currentTrack = player.queue.current;
      recordAutoplaySkip(player.guildId, currentTrack, { position: player.position });
      await clearVoteSkip(player.guildId, { complete: true, player, vote });
      await player.stopPlaying(false, false);
      emitSkipNotice(client, player, vote.title, true);
      
      if (isAutoplayEnabled(player.guildId)) {
        return { skipped: true, message: 'Vote threshold reached. Skipped the track.', needsAutoplay: true, lastTrack: currentTrack };
      }
      return { skipped: true, message: 'Vote threshold reached. Skipped the track.', needsAutoplay: false };
    }
    
    recordAutoplaySkip(player.guildId, player.queue.current, { position: player.position });
    await clearVoteSkip(player.guildId, { complete: true, player, vote });
    await player.skip();
    emitSkipNotice(client, player, vote.title, true);
    return { skipped: true, message: 'Vote threshold reached. Skipped the track.', needsAutoplay: false };
  }

  const remaining = Math.max(0, requiredVotes - votes);
  await publishVote(interaction, player, client, vote);
  return {
    skipped: false,
    message: `${alreadyVoted ? 'Your vote was already counted' : 'Vote registered'} (${votes}/${requiredVotes}). Need ${remaining} more.`,
    vote,
  };
}

function getVoteSkipSnapshot(player, config, guild = null) {
  const voiceChannel = player?.voiceChannelId
    ? guild?.channels?.cache?.get(player.voiceChannelId)
    : null;
  const trackKey = getTrackKey(player?.queue?.current);
  const state = getVoteState(player?.guildId, voiceChannel ? getEligibleUserIds(voiceChannel) : null, trackKey);
  if (!state) return null;
  const eligible = voiceChannel ? getEligibleUserIds(voiceChannel) : state.userIds;
  return {
    votes: state.userIds.size,
    requiredVotes: getRequiredVotes(eligible, config),
  };
}

module.exports = {
  handleSkipRequest,
  clearVoteSkip,
  getVoteSkipSnapshot,
  getTrackKey,
  getTrackToken,
  VOTE_SKIP_BUTTON_PREFIX,
};
