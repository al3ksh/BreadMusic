const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  ActivityType,
  MessageFlags,
} = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
const { loadConfig } = require('./config');
const { CommandError, ensurePlayer } = require('./music/utils');
const {
  commands,
  buildHelpEmbed,
  buildHelpComponents,
} = require('./commands');
const { MusicUI, BUTTON_PREFIX, BUTTONS } = require('./music/ui');
const { handleSkipRequest } = require('./music/skipManager');
const { buildTrackEmbed } = require('./music/embeds');
const { savePlayerState, hydratePlayer, resetAllQueues } = require('./state/queueStore');
const { scheduleIdleLeave, handleVoiceStateUpdate, clearEmptyChannelTimer, clearIdleTimer } = require('./music/idleTracker');
const { resetVotes } = require('./music/voteManager');
const { getConfig, listConfigs, assertDJ } = require('./state/guildConfig');
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

const HELP_BUTTON_PREFIX = 'help:';

const ACTIVITY_ROTATION_INTERVAL = 45_000;
const NODE_RECONNECT_DELAY = 5_000;
const AUTOCOMPLETE_TIMEOUT = 2_500;
const MAX_AUTOCOMPLETE_RESULTS = 5;

const config = loadConfig();
let isShuttingDown = false;

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
  let index = Math.floor(Math.random() * activityRotation.length);
  
  const applyPresence = () => {
    if (isShuttingDown) return;
    try {
      const current = activityRotation[index % activityRotation.length];
      client.user.setPresence({
        status: 'online',
        activities: [{
          name: current.name,
          type: current.type,
          url: current.url,
        }],
      });
      index += 1;
    } catch (error) {
      console.error('Failed to update presence:', error.message);
    }
  };

  applyPresence();
  clearInterval(activityIntervalId);
  activityIntervalId = setInterval(applyPresence, ACTIVITY_ROTATION_INTERVAL);
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
  if (isShuttingDown) return;

  if (interaction.isAutocomplete()) {
    try {
      await handleAutocomplete(interaction);
    } catch {}
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

      if (interaction.customId.startsWith(HELP_BUTTON_PREFIX)) {
        await handleHelpButton(interaction);
        return;
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!guildId) return;
  const player = client.lavalink.getPlayer(guildId);
  if (!player || !player.voiceChannelId) return;

  const affectedChannels = [oldState.channelId, newState.channelId];
  if (!affectedChannels.includes(player.voiceChannelId)) return;

  handleVoiceStateUpdate(player, client);
});

client.lavalink.on('trackStart', async (player, track) => {
  resetVotes(player.guildId);
  clearIdleTimer(player.guildId);
  await savePlayerState(player).catch((error) =>
    console.error('Failed to save queue:', error),
  );
  await client.musicUI.sendNowPlaying(player, track);
});

client.lavalink.on('trackEnd', async (player, track, payload) => {
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
  if (!player.queue.current && player.queue.tracks.length === 0) {
    scheduleIdleLeave(player, client);
    handleVoiceStateUpdate(player, client);
  }

  if (payload.reason !== 'finished') {
    console.log(
      `[TrackEnd] Guild=${player.guildId} track=${track?.info?.title ?? 'unknown'} reason=${payload.reason}`,
    );
  }
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
  clearEmptyChannelTimer(player.guildId);
  await client.musicUI.clear(player.guildId);
});

const nodeReconnectAttempts = new Map();

client.lavalink.nodeManager.on('disconnect', (node, reason) => {
  console.warn(`Node ${node.id} disconnected:`, reason?.message ?? reason);
  
  const attempts = nodeReconnectAttempts.get(node.id) ?? 0;
  const delay = Math.min(NODE_RECONNECT_DELAY * Math.pow(2, attempts), 60_000);
  
  nodeReconnectAttempts.set(node.id, attempts + 1);
  
  setTimeout(() => {
    if (isShuttingDown) return;
    node.connect().catch(() => {});
  }, delay);
});

client.lavalink.nodeManager.on('connect', (node) => {
  console.log(`Node ${node.id} connected.`);
  nodeReconnectAttempts.set(node.id, 0);
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
    await interaction.reply({ content: 'Invalid button.', flags: MessageFlags.Ephemeral }).catch(() => {});
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
    await interaction.reply({ content: 'Only the author can use this pagination.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (action === 'close') {
    try {
      await interaction.message.delete();
    } catch {
      await interaction.update({ content: '\u200b', embeds: [], components: [] }).catch(() => {});
    }
    return;
  }

  if (action === 'clear') {
    await interaction.deferUpdate();
    const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
    assertDJ(interaction, config);

    player.queue.tracks.splice(0, player.queue.tracks.length);
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);

    const pageData = buildQueueEmbed(player, 0);
    await interaction.editReply({
      embeds: [pageData.embed],
      components: buildQueueComponents(guildId, 0, pageData.totalPages, ownerId ?? interaction.user.id),
    });
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
  }).catch(() => {});
}

async function handleBlackjackButton(interaction) {
  const [, action, userId] = interaction.customId.split(':');
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'Only the player can use these controls.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const game = getBlackjackGame(userId);
  if (!game) {
    await interaction.reply({ content: 'This blackjack game has ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  await interaction.deferUpdate();

  let updatedGame;
  if (action === 'hit') {
    updatedGame = hitBlackjack(userId);
  } else if (action === 'stand') {
    updatedGame = standBlackjack(userId);
  } else {
    return;
  }

  if (!updatedGame) {
    await interaction.followUp({ content: 'This blackjack game has ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const embed = buildBlackjackEmbed(interaction.user, updatedGame);
  const components = buildBlackjackComponents(userId, updatedGame.finished);

  if (updatedGame.finished) {
    endBlackjack(userId);
  }

  await interaction.editReply({ embeds: [embed], components }).catch(() => {});
}

async function handleHelpButton(interaction) {
  const [, action, userId, pageString] = interaction.customId.split(':');

  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'This help menu is not for you.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  let pageIndex = parseInt(pageString, 10);
  if (action === 'prev') {
    pageIndex--;
  } else if (action === 'next') {
    pageIndex++;
  }

  pageIndex = Math.max(0, Math.min(2, pageIndex));

  const embed = buildHelpEmbed(pageIndex);
  const components = buildHelpComponents(pageIndex, userId);

  await interaction.update({ embeds: [embed], components }).catch(() => {});
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
        .followUp({ content: 'Nothing is playing to restart.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    return;
  }
  const result = await handleSkipRequest(interaction, player, config);
  if (result.skipped) {
    await savePlayerState(player).catch(() => {});
    await client.musicUI.refresh(player);
  } else {
    await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral }).catch(() => {});
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
        .followUp({ content: 'Nothing is playing to restart.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    return;
  }
  const current = player.queue.current;
  const previous = await player.queue.shiftPrevious();
  if (!previous) {
    await interaction.followUp({ content: 'No previous track.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (current) {
    await player.queue.add(current, 0);
  }
  await player.play({ clientTrack: previous });
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
    await interaction.followUp({ content: 'No tracks to shuffle.', flags: MessageFlags.Ephemeral }).catch(() => {});
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

  const guildConfig = getConfig(interaction.guildId);
  const defaultSource = client.lavalink?.options?.playerOptions?.defaultSearchPlatform;
  const query = applyPreferredSource(trimmed, guildConfig, defaultSource);

  let result;
  try {
    result = await Promise.race([
      node.search({ query }, interaction.user),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Search timeout')), AUTOCOMPLETE_TIMEOUT)
      ),
    ]);
  } catch {
    await interaction
      .respond([{ name: truncateLabel(trimmed, 100), value: trimmed.slice(0, 100) }])
      .catch(() => {});
    return;
  }

  const tracks = result?.tracks?.slice(0, MAX_AUTOCOMPLETE_RESULTS) ?? [];
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
  const ignoredCodes = [10062, 10008, 40060];

  const errorCode = error?.code ?? error?.rawError?.code;
  if (ignoredCodes.includes(errorCode)) return;

  const isCommandError = error instanceof CommandError;
  if (!isCommandError) {
    console.error('Command execution error:', error);
  }

  const content = isCommandError
    ? error.message
    : 'Something went wrong. Please try again.';
  const ephemeral = isCommandError ? error.ephemeral : true;

  try {
    if (!interaction.isRepliable()) return;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({
        content,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    }
  } catch {}
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n[${signal}] Shutting down gracefully...`);

  clearInterval(activityIntervalId);

  const players = client.lavalink?.players?.values() ?? [];
  for (const player of players) {
    try {
      await savePlayerState(player);
      await player.destroy('Bot shutting down', false);
    } catch {}
  }

  for (const guildId of client.musicUI?.messages?.keys() ?? []) {
    await client.musicUI.clear(guildId).catch(() => {});
  }

  try {
    client.destroy();
  } catch {}

  console.log('Shutdown complete.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return;
  gracefulShutdown('uncaughtException');
});
