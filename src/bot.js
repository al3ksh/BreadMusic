const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  ActivityType,
} = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const { loadConfig } = require('./config');
const { CommandError, ensurePlayer } = require('./music/utils');
const { commands } = require('./commands');
const { MusicUI, BUTTON_PREFIX, BUTTONS } = require('./music/ui');
const { handleSkipRequest } = require('./music/skipManager');
const { buildTrackEmbed } = require('./music/embeds');
const { savePlayerState, hydratePlayer, resetAllQueues } = require('./state/queueStore');
const { scheduleIdleLeave, clearIdle } = require('./music/idleTracker');
const { resetVotes } = require('./music/voteManager');
const { getConfig, listConfigs } = require('./state/guildConfig');
const { createSelection } = require('./state/searchCache');
const {
  buildQueueEmbed,
  buildQueueComponents,
  QUEUE_BUTTON_PREFIX,
} = require('./music/queueFormatter');
const { applyPreferredSource } = require('./music/searchUtils');
const { formatDuration } = require('./utils/time');
const {
  getGame: getBlackjackGame,
  hit: hitBlackjack,
  stand: standBlackjack,
  endGame: endBlackjack,
  buildEmbed: buildBlackjackEmbed,
  buildComponents: buildBlackjackComponents,
  BUTTON_PREFIX: BLACKJACK_BUTTON_PREFIX,
} = require('./games/blackjack');

const config = loadConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const activityRotation = [
  { type: ActivityType.Listening, name: 'your /play requests' },
  { type: ActivityType.Watching, name: 'Lavalink nodes' },
  { type: ActivityType.Playing, name: 'beats' },
  { type: ActivityType.Listening, name: 'listening to your excuses' },
  { type: ActivityType.Playing, name: 'pretending to be a DJ' },
  { type: ActivityType.Watching, name: 'the queue that never ends' },
  { type: ActivityType.Listening, name: 'memes being uploaded' },
  { type: ActivityType.Playing, name: 'teaching cats to DJ' },
  { type: ActivityType.Watching, name: 'debugging in production' },
  { type: ActivityType.Listening, name: 'buffering... forever' },
];
let activityIntervalId;

function startActivityRotation() {
  if (!activityRotation.length) return;
  let index = 0;
  const applyPresence = () => {
    const current = activityRotation[index % activityRotation.length];
    client.user.setPresence({
      status: 'online',
      activities: [
        {
          name: current.name,
          type: current.type,
          url: current.url,
        },
      ],
    });
    index += 1;
  };

  applyPresence();
  clearInterval(activityIntervalId);
  activityIntervalId = setInterval(applyPresence, 45_000);
}

client.commands = new Collection();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

client.musicUI = new MusicUI(client);
client.behavior = config.behavior;

client.lavalink = new LavalinkManager({
  nodes: config.lavalink.nodes,
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      guild.shard.send(payload);
      return;
    }

    const shardIterator = client.ws.shards.values();
    const firstShard = shardIterator.next().value;
    firstShard?.send(payload);
  },
  autoSkip: true,
  playerOptions: {
    defaultSearchPlatform: config.lavalink.defaultSource,
    volumeDecrementer: 0.75,
  },
});

client.on('raw', (data) => client.lavalink.sendRawData(data));

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  resetAllQueues();
  client.lavalink.init({
    id: readyClient.user.id,
    username: readyClient.user.username,
  });

  startActivityRotation();
  await restoreTwentyFourSevenPlayers();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      await handleAutocomplete(interaction);
    } catch (error) {
      console.error('Autocomplete error:', error);
    }
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith(BUTTON_PREFIX)) {
        await handleMusicButton(interaction);
        return;
      }

      if (interaction.customId.startsWith(QUEUE_BUTTON_PREFIX)) {
        await handleQueueButton(interaction);
        return;
      }

      if (interaction.customId.startsWith(BLACKJACK_BUTTON_PREFIX)) {
        await handleBlackjackButton(interaction);
        return;
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
});

client.lavalink.on('trackStart', async (player, track) => {
  resetVotes(player.guildId);
  clearIdle(player.guildId);
    await savePlayerState(player).catch((error) =>
    console.error('Failed to save queue:', error),
  );
  await client.musicUI.sendNowPlaying(player, track);
});

client.lavalink.on('trackEnd', async (player, track, payload) => {
  await savePlayerState(player).catch(() => {});
  const configForGuild = getConfig(player.guildId);
  await client.musicUI.refresh(player);
  if (!player.queue.current && player.queue.tracks.length === 0) {
    scheduleIdleLeave(player, configForGuild);
  }

  console.log(
    `[TrackEnd] Guild=${player.guildId} track=${track?.info?.title ?? 'unknown'} reason=${payload.reason}`,
  );
});

client.lavalink.on('trackException', (player, track, payload) => {
  console.error(
    `[TrackException] Guild=${player.guildId} track=${track?.info?.title ?? 'unknown'} reason=${payload.exception?.message}`,
  );
});

client.lavalink.on('trackStuck', (player, track, payload) => {
  console.warn(
    `[TrackStuck] Guild=${player.guildId} track=${track?.info?.title ?? 'unknown'} threshold=${payload.thresholdMs}`,
  );
});

client.lavalink.on('playerDestroy', async (player) => {
  clearIdle(player.guildId);
  await client.musicUI.clear(player.guildId);
});

client.lavalink.nodeManager.on('disconnect', (node, reason) => {
  console.warn(`Node ${node.id} disconnected:`, reason?.message ?? reason);
  setTimeout(() => node.connect().catch(() => {}), 5_000);
});

client.lavalink.nodeManager.on('connect', (node) => {
  console.log(`Node ${node.id} connected.`);
});

client
  .login(config.token)
  .catch((error) => {
    console.error('Failed to start Discord client:', error);
    process.exit(1);
  });

async function handleMusicButton(interaction) {
  const [, action, guildId] = interaction.customId.split(':');
    if (!guildId || guildId !== interaction.guildId) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true });
    return;
  }

  const handlers = {
    [BUTTONS.PLAY_PAUSE]: togglePlayPause,
    [BUTTONS.SKIP]: skipTrack,
    [BUTTONS.STOP]: stopPlayback,
    [BUTTONS.BACK]: playPrevious,
    [BUTTONS.LOOP]: toggleLoop,
    [BUTTONS.SHUFFLE]: shuffleQueue,
  };

  const handler = handlers[action];
  if (!handler) return;
  await handler(interaction);
}

async function handleQueueButton(interaction) {
  const [, action, guildId, pageString, ownerId] = interaction.customId.split(':');
  if (ownerId && ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the author can use this pagination.', ephemeral: true });
    return;
  }

  if (action === 'close') {
    try {
      await interaction.message.delete();
    } catch (error) {
      await interaction.update({ components: [] }).catch(() => {});
    }
    return;
  }

  const page = Number(pageString ?? '0');
  const direction = action === 'next' ? 1 : -1;

  const { player } = await ensurePlayer(interaction, { allowCreate: false });
  const nextPage = Math.max(0, page + direction);
  const pageData = buildQueueEmbed(player, nextPage);

  await interaction.update({
    embeds: [pageData.embed],
    components: buildQueueComponents(guildId, nextPage, pageData.totalPages, ownerId ?? interaction.user.id),
  });
}

async function handleBlackjackButton(interaction) {
  const [, action, userId] = interaction.customId.split(':');
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'Only the player can use these controls.', ephemeral: true });
    return;
  }

  const game = getBlackjackGame(userId);
  if (!game) {
    await interaction.reply({ content: 'This blackjack game has ended.', ephemeral: true });
    return;
  }

  let updatedGame;
  if (action === 'hit') {
    updatedGame = hitBlackjack(userId);
  } else if (action === 'stand') {
    updatedGame = standBlackjack(userId);
  } else {
    return;
  }

  if (!updatedGame) {
    await interaction.reply({ content: 'This blackjack game has ended.', ephemeral: true });
    return;
  }

  const embed = buildBlackjackEmbed(interaction.user, updatedGame);
  const components = buildBlackjackComponents(userId, updatedGame.finished);

  if (updatedGame.finished) {
    endBlackjack(userId);
  }

  await interaction.update({ embeds: [embed], components });
}

async function togglePlayPause(interaction) {
  await interaction.deferUpdate();
  const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
  if (player.paused) await player.resume();
  else await player.pause();
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function skipTrack(interaction) {
  await interaction.deferUpdate();
  const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
  if (player.repeatMode === 'track') {
    const restarted = await restartCurrent(player);
    if (!restarted) {
      await interaction
        .followUp({ content: 'Nothing is playing to restart.', ephemeral: true })
        .catch(() => {});
    }
    return;
  }
  const result = await handleSkipRequest(interaction, player, config);
  if (result.skipped) {
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);
  } else {
    await interaction.followUp({ content: result.message, ephemeral: true }).catch(() => {});
  }
}

async function stopPlayback(interaction) {
  await interaction.deferUpdate();
  const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
  await player.stopPlaying(true);
  player.queue.tracks.splice(0, player.queue.tracks.length);
  await player.destroy('Stopped via UI', true);
  await savePlayerState(player).catch(() => {});
  await client.musicUI.clear(player.guildId);
}

async function playPrevious(interaction) {
  await interaction.deferUpdate();
  const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
  if (player.repeatMode === 'track') {
    const restarted = await restartCurrent(player);
    if (!restarted) {
      await interaction
        .followUp({ content: 'Nothing is playing to restart.', ephemeral: true })
        .catch(() => {});
    }
    return;
  }
  const current = player.queue.current;
  const previous = await player.queue.shiftPrevious();
  if (!previous) {
    await interaction.followUp({ content: 'No previous track.', ephemeral: true }).catch(() => {});
    return;
  }
  if (current) {
    await player.queue.add(current, 0);
  }
  await player.play({ clientTrack: previous });
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function replayTrack(interaction) {
  await interaction.deferUpdate();
  const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
  const current = player.queue.current;
  if (!current) {
    await interaction.followUp({ content: 'Nothing is playing.', ephemeral: true }).catch(() => {});
    return;
  }
  await player.play({ clientTrack: current, startTime: 0 });
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function toggleLoop(interaction) {
  await interaction.deferUpdate();
  const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
  const order = ['off', 'track', 'queue'];
  const currentIndex = order.indexOf(player.repeatMode ?? 'off');
  const nextMode = order[(currentIndex + 1) % order.length];
  await player.setRepeatMode(nextMode);
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function shuffleQueue(interaction) {
  await interaction.deferUpdate();
  const { player } = await ensurePlayer(interaction, { requireSameChannel: true });
  if (player.queue.tracks.length === 0) {
    await interaction.followUp({ content: 'No tracks to shuffle.', ephemeral: true }).catch(() => {});
    return;
  }
  await player.queue.shuffle();
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function restartCurrent(player) {
  const current = player.queue.current;
  if (!current) return false;
  await player.play({ clientTrack: current, startTime: 0 });
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
  return true;
}

async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'play') {
    await interaction.respond([]).catch(() => {});
    return;
  }

  const focused = interaction.options.getFocused() ?? '';
  const trimmed = focused.trim();

  if (!trimmed.length) {
    await interaction.respond([]).catch(() => {});
    return;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    await interaction
      .respond([{ name: truncateLabel(trimmed, 100), value: trimmed.slice(0, 100) }])
      .catch(() => {});
    return;
  }

  const node = getUsableNode(client);
  if (!node) {
    await interaction
      .respond([{ name: truncateLabel(trimmed, 100), value: trimmed.slice(0, 100) }])
      .catch(() => {});
    return;
  }

  const config = getConfig(interaction.guildId);
  const defaultSource = client.lavalink?.options?.playerOptions?.defaultSearchPlatform;
  const query = applyPreferredSource(trimmed, config, defaultSource);

  let result;
  try {
    result = await node.search({ query }, interaction.user);
  } catch (error) {
    console.error('Autocomplete search failed:', error);
    await interaction
      .respond([{ name: `Search failed for "${truncateLabel(trimmed, 60)}"`, value: trimmed }])
      .catch(() => {});
    return;
  }

  const tracks = result?.tracks?.slice(0, 5) ?? [];
  if (!tracks.length) {
    await interaction
      .respond([{ name: `No matches for "${truncateLabel(trimmed, 60)}"`, value: trimmed }])
      .catch(() => {});
    return;
  }

  const selectionId = createSelection(tracks, interaction.user.id, interaction.guildId, 120_000);
  const choices = tracks.map((track, index) => ({
    name: truncateLabel(
      `${track.info.title ?? 'Unknown'} — ${track.info.author ?? 'Unknown'} (${formatDuration(
        track.info.duration ?? track.info.length ?? 0,
      )})`,
      100,
    ),
    value: `auto:${selectionId}:${index}`,
  }));

  await interaction.respond(choices).catch(() => {});
}

function getUsableNode(clientInstance) {
  const nodes = clientInstance.lavalink?.nodeManager?.nodes;
  if (!nodes) return null;
  for (const node of nodes.values()) {
    if (node.connected) return node;
  }
  const iterator = nodes.values();
  return iterator.next().value ?? null;
}

function truncateLabel(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

async function restoreTwentyFourSevenPlayers() {
  const configs = listConfigs();
  for (const [guildId, guildConfig] of configs) {
    if (!guildConfig.stayInChannel || !guildConfig.twentyFourSevenChannelId) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const textChannelId =
      guildConfig.announceChannelId ??
      guild.systemChannelId ??
      guild.publicUpdatesChannelId ??
      guild.channels.cache.find((channel) => channel.isTextBased() && channel.viewable)?.id;

    try {
      const player = client.lavalink.createPlayer({
        guildId,
        voiceChannelId: guildConfig.twentyFourSevenChannelId,
        textChannelId,
        selfDeaf: true,
      });
      await player.connect();
      await hydratePlayer(player, client);
    } catch (error) {
      console.error(`Failed to restore 24/7 player for ${guildId}:`, error.message);
    }
  }
}

async function handleInteractionError(interaction, error) {
  const isUnknownInteraction =
    error?.code === 10062 ||
    error?.message === 'Unknown interaction' ||
    error?.rawError?.message === 'Unknown interaction';

  if (isUnknownInteraction) {
    console.warn('Ignoring Unknown Interaction (probably client timeout).');
    return;
  }

  console.error('Command execution error:', error);
  const isCommandError = error instanceof CommandError;
  const content = isCommandError
    ? error.message
    : 'Something went wrong. Please try again.';
  const ephemeral = isCommandError ? error.ephemeral : true;

  if (interaction.isRepliable()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral });
    }
  }
}
