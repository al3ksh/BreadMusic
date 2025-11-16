const { hydratePlayer } = require('../state/queueStore');
const { getConfig } = require('../state/guildConfig');

class CommandError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CommandError';
    this.ephemeral = options.ephemeral ?? true;
  }
}

async function resolveVoiceState(interaction) {
  if (!interaction.guild) {
    throw new CommandError('This command only works in a server.');
  }

  if (interaction.member && interaction.member.voice) {
    return interaction.member.voice.channelId ?? null;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.voice?.channelId ?? null;
}

async function ensurePlayer(interaction, options = {}) {
  const {
    requireSameChannel = false,
    allowCreate = false,
    voiceChannelId: providedChannelId,
  } = options;

  const lavalink = interaction.client.lavalink;
  if (!lavalink || !lavalink.useable) {
    throw new CommandError('No available Lavalink connection.');
  }

  const guildId = interaction.guildId;
  const guildConfig = getConfig(guildId);
  let player = lavalink.getPlayer(guildId);
  const userChannelId = providedChannelId ?? (await resolveVoiceState(interaction));

  if (requireSameChannel && !userChannelId) {
    throw new CommandError('You must be in a voice channel to use this command.');
  }

  if (!player) {
      if (!allowCreate) {
      throw new CommandError('I am not connected to any voice channel.');
    }

    if (!userChannelId) {
      throw new CommandError('Please join a voice channel first.');
    }

    player = lavalink.createPlayer({
      guildId,
      voiceChannelId: userChannelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
    });

    await player.connect();
    await hydratePlayer(player, interaction.client).catch((error) => {
      console.error('Failed to restore queue from file:', error);
    });
  } else if (
    requireSameChannel &&
    player.voiceChannelId &&
    userChannelId &&
    player.voiceChannelId !== userChannelId
  ) {
    throw new CommandError('Musisz byc na tym samym kanale glosowym co bot.');
  } else if (interaction.channelId && player.textChannelId !== interaction.channelId) {
    player.textChannelId = interaction.channelId;
  }

  return {
    player,
    voiceChannelId: player.voiceChannelId ?? userChannelId ?? null,
    config: guildConfig,
  };
}

async function ensureVoice(interaction, options = {}) {
  const channelId = await resolveVoiceState(interaction);

  if (!channelId) {
    throw new CommandError('You must be in a voice channel to use this command.');
  }

  const details = await ensurePlayer(interaction, {
    ...options,
    allowCreate: options.createPlayer ?? false,
    voiceChannelId: channelId,
  });

  return {
    voiceChannelId: channelId,
    player: details.player,
    config: details.config,
  };
}

module.exports = {
  CommandError,
  ensurePlayer,
  ensureVoice,
};
