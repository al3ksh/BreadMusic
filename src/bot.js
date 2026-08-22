const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  ActivityType,
  MessageFlags,
  Partials,
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
const {
  handleSkipRequest,
  clearVoteSkip,
  getTrackKey,
  getTrackToken,
  VOTE_SKIP_BUTTON_PREFIX,
} = require('./music/skipManager');
const { isPlayerStopping, markPlayerStopping } = require('./music/playerLifecycle');
const { buildTrackEmbed } = require('./music/embeds');
const { savePlayerState, hydratePlayer, flushQueueStore } = require('./state/queueStore');
const { recordTrackPlay } = require('./state/analyticsStore');
const { withGuildMutex } = require('./music/guildMutex');
const { scheduleIdleLeave, handleVoiceStateUpdate, clearEmptyChannelTimer, clearIdleTimer } = require('./music/idleTracker');
const { getConfig, listConfigs, assertDJ, hasDJPermissions } = require('./state/guildConfig');
const { createSelection } = require('./state/searchCache');
const { deleteInteractionReply } = require('./utils/interactions');
const { buildDashboardUrl } = require('./dashboard/url');
const { createDmResponder } = require('./utils/dmResponder');
const { createPresenceRotation } = require('./utils/presenceRotation');
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
  doubleDown: doubleBlackjack,
  endGame: endBlackjack,
  buildEmbed: buildBlackjackEmbed,
  buildComponents: buildBlackjackComponents,
  BUTTON_PREFIX: BLACKJACK_BUTTON_PREFIX,
} = require('./games/blackjack');
const { hasBalance, addBalance, removeBalance, getBalance } = require('./games/economy');
const {
  handleAutoplay,
  scheduleAutoplayPrefetch,
  clearAutoplayState,
  addToRecentTracks,
  blockAutoplayAfterPlaybackFailure,
  resumeAutoplayAfterPlaybackSuccess,
} = require('./music/autoplay');
const {
  clearVoiceTrackStatus,
  handleVoiceStatusGatewayEvent,
  setVoiceTrackStatus,
} = require('./music/voiceStatus');
const { buildAccessDeniedMessage, isGuildAllowed } = require('./access/guildAccess');
const { createPlaybackRecovery } = require('./music/playbackRecovery');
const {
  CLOSE_LYRICS_BUTTON_PREFIX,
  LyricsUI,
  LIVE_LYRICS_BUTTON_PREFIX,
  PAGE_LYRICS_BUTTON_PREFIX,
} = require('./music/lyricsUi');
const {
  RPS_BUTTON_PREFIX,
  RPS_CHOICES,
  createChallenge,
  setMessageInfo,
  buildRPSChallengeEmbed,
  buildRPSChallengeComponents,
  getChallenge,
  cancelChallenge,
  setTargetChoice,
  determineWinner,
  cleanupChallenge,
  setExpireCallback,
  buildRPSDuelResultEmbed,
  buildRPSExpiredEmbed,
} = require('./games/fun');

const HELP_BUTTON_PREFIX = 'help:';

const ACTIVITY_ROTATION_INTERVAL = 45_000;
const NODE_RECONNECT_DELAY = 5_000;
const AUTOCOMPLETE_TIMEOUT = 2_500;
const MAX_AUTOCOMPLETE_RESULTS = 5;

const config = loadConfig();
let isShuttingDown = false;
const playbackFailureRecovery = new Set();

function safeEventHandler(label, handler) {
  return (...args) => {
    Promise.resolve()
      .then(() => handler(...args))
      .catch((error) => console.error(`[${label}] handler failed:`, error));
  };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const handleDirectMessage = createDmResponder({
  dashboardUrl: `${String(process.env.WEB_URL || 'https://breadmusic.aleksh.xyz').replace(/\/$/, '')}/dashboard`,
  contact: process.env.PRIVATE_ACCESS_CONTACT || 'aleksh8',
});

const activityRotation = [
  { type: ActivityType.Listening, name: "/play • your requests" },
  { type: ActivityType.Watching,  name: "/play • soundcheck" },
  { type: ActivityType.Playing,   name: "/play • beats" },

  { type: ActivityType.Watching,  name: "/help • all commands" },
  { type: ActivityType.Listening, name: "/play • your excuses" },
  { type: ActivityType.Playing,   name: "/play • pretending to be a DJ" },
  { type: ActivityType.Watching,  name: "/play • the queue that never ends" },
  { type: ActivityType.Playing,   name: "/dashboard • live controls" },

  { type: ActivityType.Listening, name: "/play • memes being uploaded" },
  { type: ActivityType.Watching,  name: "/dashboard • live player" },
  { type: ActivityType.Playing,   name: "/play • teaching cats to DJ" },
  { type: ActivityType.Watching,  name: "/play • debugging in production" },
  { type: ActivityType.Listening, name: "/help • need a hand?" },
  { type: ActivityType.Watching,  name: "/dashboard • your queue" },

  { type: ActivityType.Listening, name: "/play • buffering... forever" },
  { type: ActivityType.Playing,   name: "/help • no manual required" },
  { type: ActivityType.Watching,  name: "/dashboard • take the wheel" },
  { type: ActivityType.Listening, name: "/help • commands, no ceremony" },
  { type: ActivityType.Playing,   name: "/play • finding your next song" },

  { type: ActivityType.Playing,   name: "/play • no skips, only consequences" },
  { type: ActivityType.Listening, name: "/play • autoplay has opinions" },
  { type: ActivityType.Playing,   name: "/play • pressing play emotionally" },
  { type: ActivityType.Watching,  name: "/play • queueing your character arc" },
  { type: ActivityType.Listening, name: "/play • source? trust me" },
  { type: ActivityType.Watching,  name: "/play • seekable in theory" },
  { type: ActivityType.Playing,   name: "/play • the vibe is buffering" },
  { type: ActivityType.Listening, name: "/play • skip responsibly" },
  { type: ActivityType.Playing,   name: "/play • playlist? say less" },
  { type: ActivityType.Watching,  name: "/play • one more song" },

  { type: ActivityType.Playing,   name: "Activity • shared aux unlocked" },
  { type: ActivityType.Watching,  name: "Activity • the queue has witnesses" },
  { type: ActivityType.Listening, name: "Activity • buttons with consequences" },
  { type: ActivityType.Playing,   name: "Activity • the aux cord is public" },
  { type: ActivityType.Watching,  name: "Activity • one queue, many DJs" },
  { type: ActivityType.Listening, name: "Activity • music, but social" },
  { type: ActivityType.Playing,   name: "Activity • no DJ degree required" },
  { type: ActivityType.Watching,  name: "Activity • click play, blame the DJ" },
  { type: ActivityType.Listening, name: "Activity • synced with the chaos" },
  { type: ActivityType.Playing,   name: "Activity • server-wide soundcheck" },
  { type: ActivityType.Watching,  name: "Activity • queueing together" },
  { type: ActivityType.Listening, name: "Activity • music with witnesses" },

  { type: ActivityType.Listening, name: "/dashboard • controlling the chaos" },
  { type: ActivityType.Playing,   name: "/dashboard • queue management simulator" },
  { type: ActivityType.Watching,  name: "/dashboard • live controls, questionable decisions" },
  { type: ActivityType.Listening, name: "/dashboard • control issues, resolved" },
  { type: ActivityType.Playing,   name: "/dashboard • knobs without the booth" },
  { type: ActivityType.Watching,  name: "/dashboard • browser-based DJ decisions" },

  { type: ActivityType.Playing,   name: "/lyrics • karaoke without the rent" },
  { type: ActivityType.Watching,  name: "/lyrics • words pending" },
  { type: ActivityType.Listening, name: "/lyrics • singing is optional" },
  { type: ActivityType.Playing,   name: "/lyrics • reading between the beats" },
  { type: ActivityType.Watching,  name: "/lyrics • subtitles for your shower concert" },
  { type: ActivityType.Listening, name: "/lyrics • vocals not included" },
  { type: ActivityType.Playing,   name: "/lyrics • words before the beat drops" },

  { type: ActivityType.Playing,   name: "/help • ask nicely" },
  { type: ActivityType.Listening, name: "/help • professionally confused" },
  { type: ActivityType.Watching,  name: "/help • answers sold separately" },
  { type: ActivityType.Playing,   name: "/help • plot twist: documentation" },
  { type: ActivityType.Watching,  name: "/stats • keeping receipts" },
  { type: ActivityType.Listening, name: "/stats • counting the damage" },
  { type: ActivityType.Watching,  name: "/stats • playback paperwork" },
  { type: ActivityType.Playing,   name: "/stats • your listening alibi" },
  { type: ActivityType.Listening, name: "/stats • numbers with rhythm" },
  { type: ActivityType.Watching,  name: "/stats • evidence of one more song" },
  { type: ActivityType.Playing,   name: "/stats • quantifying the vibe" },
];

let activityIntervalId;

function startActivityRotation() {
  if (!activityRotation.length) return;
  const nextActivity = createPresenceRotation(activityRotation, [
    '/play',
    '/dashboard',
    '/help',
    'Activity',
    '/lyrics',
    '/stats',
  ]);

  const applyPresence = () => {
    if (isShuttingDown) return;
    try {
      const current = nextActivity();
      if (!current) return;
      client.user.setPresence({
        status: 'online',
        activities: [{
          name: current.name,
          type: current.type,
          url: current.url,
        }],
      });
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
client.lyricsUI = new LyricsUI(client);
client.behavior = config.behavior;
client.guildAccess = config.guildAccess;

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

const handledDirectMessageIds = new Set();

async function processDirectMessage(message) {
  if (
    !message?.id ||
    message.guildId ||
    message.author?.bot ||
    handledDirectMessageIds.has(message.id)
  ) return;
  handledDirectMessageIds.add(message.id);
  const expiry = setTimeout(() => handledDirectMessageIds.delete(message.id), 60_000);
  expiry.unref?.();
  await handleDirectMessage(message);
}

client.on('raw', (data) => {
  client.lavalink.sendRawData(data);
  handleVoiceStatusGatewayEvent(data);

  if (data?.t !== 'MESSAGE_CREATE' || data.d?.guild_id || data.d?.author?.bot) return;
  setImmediate(() => {
    if (handledDirectMessageIds.has(data.d.id)) return;
    client.channels.fetch(data.d.channel_id)
      .then((channel) => channel?.messages?.fetch(data.d.id))
      .then((message) => message && processDirectMessage(message))
      .catch((error) => console.warn('[DirectMessage] Raw fallback failed:', error.message));
  });
});

client.on(Events.MessageCreate, safeEventHandler('DirectMessage', async (message) => {
  if (isShuttingDown) return;
  await processDirectMessage(message);
}));

client.once(Events.ClientReady, safeEventHandler('ClientReady', async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  client.lavalink.init({
    id: readyClient.user.id,
    username: readyClient.user.username,
  });

  setExpireCallback(async (challenge) => {
    if (challenge.channelId && challenge.messageId) {
      try {
        const channel = await client.channels.fetch(challenge.channelId);
        if (channel) {
          const message = await channel.messages.fetch(challenge.messageId);
          if (message) {
            const expiredEmbed = buildRPSExpiredEmbed(challenge);
            await message.edit({ embeds: [expiredEmbed], components: [] });
          }
        }
      } catch (err) {
      }
    }
  });

  startActivityRotation();
  await restoreTwentyFourSevenPlayers();
}));

client.on(Events.InteractionCreate, safeEventHandler('InteractionCreate', async (interaction) => {
  if (isShuttingDown) return;

  if (interaction.guildId && !isGuildAllowed(config.guildAccess, interaction.guildId)) {
    if (interaction.isAutocomplete()) {
      await interaction.respond([]).catch(() => {});
      return;
    }

    if (interaction.isRepliable()) {
      const payload = {
        content: buildAccessDeniedMessage(config.guildAccess),
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return;
  }

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
      if (interaction.customId.startsWith(`${VOTE_SKIP_BUTTON_PREFIX}:`)) {
        await handleVoteSkipButton(interaction);
        return;
      }

      if (interaction.customId.startsWith(PAGE_LYRICS_BUTTON_PREFIX)) {
        await client.lyricsUI.changePage(interaction);
        return;
      }

      if (interaction.customId.startsWith(CLOSE_LYRICS_BUTTON_PREFIX)) {
        await client.lyricsUI.close(interaction);
        return;
      }

      if (interaction.customId.startsWith(LIVE_LYRICS_BUTTON_PREFIX)) {
        await client.lyricsUI.toggle(interaction);
        return;
      }

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

      if (interaction.customId.startsWith(RPS_BUTTON_PREFIX)) {
        await handleRPSButton(interaction);
        return;
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
}));

client.on(Events.GuildCreate, safeEventHandler('GuildCreate', async (guild) => {
  if (isGuildAllowed(config.guildAccess, guild.id)) return;

  console.warn(`[GuildAccess] Unauthorized guild joined: ${guild.name} (${guild.id})`);
  const canSend = (candidate) =>
    candidate?.isTextBased?.() &&
    (typeof candidate.isSendable !== 'function' || candidate.isSendable());
  const channel = canSend(guild.systemChannel)
    ? guild.systemChannel
    : guild.channels.cache.find(canSend);

  if (!channel?.send) return;
  await channel.send({
    content: buildAccessDeniedMessage(config.guildAccess),
  }).catch(() => {});
}));

client.on(Events.VoiceStateUpdate, safeEventHandler('VoiceStateUpdate', async (oldState, newState) => {
  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!guildId) return;
  if (
    oldState.id === client.user?.id &&
    oldState.channelId &&
    oldState.channelId !== newState.channelId
  ) {
    clearVoiceTrackStatus(client, oldState.channelId).catch(() => {});
  }
  const player = client.lavalink.getPlayer(guildId);
  if (!player || !player.voiceChannelId) return;

  const affectedChannels = [oldState.channelId, newState.channelId];
  if (!affectedChannels.includes(player.voiceChannelId)) return;

  await handleVoiceStateUpdate(player, client);
}));

client.lavalink.on('trackStart', safeEventHandler('trackStart', async (player, track) => {
  resumeAutoplayAfterPlaybackSuccess(player.guildId);
  await clearVoteSkip(player.guildId);
  clearIdleTimer(player.guildId);
  addToRecentTracks(player.guildId, track);
  scheduleAutoplayPrefetch(player, track, client);
  recordTrackPlay(player.guildId, track, { botUserId: client.user?.id });
  await savePlayerState(player).catch((error) =>
    console.error('Failed to save queue:', error),
  );
  await Promise.all([
    client.musicUI.sendNowPlaying(player, track),
    setVoiceTrackStatus(client, player, track),
  ]);
  broadcastPlayerUpdate(player.guildId);
}));

client.lavalink.on('trackEnd', safeEventHandler('trackEnd', async (player, track, payload) => {
  await savePlayerState(player).catch(() => {});
  broadcastPlayerUpdate(player.guildId);
}));

client.lavalink.on('trackError', safeEventHandler('trackError', async (player, track, payload) => {
  const exception = payload?.exception;
  console.error(
    `[TrackError] Guild=${player.guildId} track=${track?.info?.title ?? 'unknown'} severity=${exception?.severity ?? 'unknown'} reason=${exception?.message ?? payload?.error ?? 'unknown'}`,
  );
  await recoverPlaybackFailure({ player, track, payload, label: 'TrackError' });
}));

client.lavalink.on('trackStuck', safeEventHandler('trackStuck', async (player, track, payload) => {
  console.warn(
    `[TrackStuck] Guild=${player.guildId} track=${track?.info?.title ?? 'unknown'} threshold=${payload?.thresholdMs ?? 'unknown'}`,
  );
  await recoverPlaybackFailure({
    player,
    track,
    label: 'TrackStuck',
    payload: {
      ...payload,
      message: `Track stuck after ${payload?.thresholdMs ?? 'an unknown duration'}ms`,
    },
  });
}));

client.lavalink.on('queueEnd', safeEventHandler('queueEnd', async (player, track) => {
  await savePlayerState(player).catch(() => {});

  if (isPlayerStopping(player)) return;
  
  const autoplayTriggered = await handleAutoplay(player, track, client);
  if (!autoplayTriggered) {
    await clearVoiceTrackStatus(client, player);
    await client.musicUI.refresh(player);
    scheduleIdleLeave(player, client);
    handleVoiceStateUpdate(player, client);
  }
  broadcastPlayerUpdate(player.guildId);
}));

client.lavalink.on('playerDestroy', safeEventHandler('playerDestroy', async (player) => {
  clearEmptyChannelTimer(player.guildId);
  clearAutoplayState(player.guildId);
  await clearVoteSkip(player.guildId);
  await clearVoiceTrackStatus(client, player);
  await client.musicUI.clear(player.guildId);
  broadcastPlayerUpdate(player.guildId);
}));

const nodeReconnectAttempts = new Map();

client.lavalink.nodeManager.on('disconnect', (node, reason) => {
  console.warn(`Node ${node.id} disconnected:`, reason?.message ?? reason);
  
  const attempts = nodeReconnectAttempts.get(node.id) ?? 0;
  const delay = Math.min(NODE_RECONNECT_DELAY * Math.pow(2, attempts), 60_000);
  
  nodeReconnectAttempts.set(node.id, attempts + 1);
  
  const reconnectTimer = setTimeout(() => {
    if (isShuttingDown) return;
    if (node?.connected === false && typeof node?.connect === 'function') {
      const result = node.connect();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => console.warn(`Failed to reconnect node ${node.id}:`, err.message));
      }
    }
  }, delay);
  reconnectTimer.unref?.();
});

client.lavalink.nodeManager.on('connect', (node) => {
  console.log(`Node ${node.id} connected.`);
  nodeReconnectAttempts.set(node.id, 0);
});

client.lavalink.nodeManager.on('error', (node, error) => {
  console.error(`Node ${node.id} error:`, error?.message ?? error);
});

const { createApiServer, broadcastPlayerUpdate } = require('./server');

const recoverPlaybackFailure = createPlaybackRecovery({
  recoverySet: playbackFailureRecovery,
  isPlayerStopping,
  sendPlaybackError: (player, track, payload) => client.musicUI.sendPlaybackError(player, track, payload),
  handleAutoplay: (player, track) => handleAutoplay(player, track, client),
  clearVoiceTrackStatus: (player) => clearVoiceTrackStatus(client, player),
  refreshPlayer: (player) => client.musicUI.refresh(player),
  scheduleIdleLeave: (player) => scheduleIdleLeave(player, client),
  broadcastPlayerUpdate,
  suspendAutoplay: blockAutoplayAfterPlaybackFailure,
});

client
  .login(config.token)
  .catch((error) => {
    console.error('Failed to start Discord client:', error);
    process.exit(1);
  });

const apiApp = createApiServer(client);
const webPort = parseInt(process.env.WEB_PORT, 10) || 3001;
apiApp.listen(webPort, process.env.WEB_HOST || '0.0.0.0', () => {
  console.log(`API server listening on port ${webPort}`);
});

async function handleMusicButton(interaction) {
  const [, action, guildId] = interaction.customId.split(':');
  if (!guildId || guildId !== interaction.guildId) {
    await interaction.reply({ content: 'Invalid button.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (action === BUTTONS.ACTIVITY) {
    await interaction.launchActivity();
    return;
  }

  const handlers = {
    [BUTTONS.PLAY_PAUSE]: togglePlayPause,
    [BUTTONS.SKIP]: skipTrack,
    [BUTTONS.STOP]: stopPlayback,
    [BUTTONS.BACK]: playPrevious,
    [BUTTONS.LOOP]: toggleLoop,
    [BUTTONS.SHUFFLE]: shuffleQueue,
    [BUTTONS.LYRICS]: showLyrics,
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
  } else if (action === 'double') {
    const result = doubleBlackjack(userId);
    if (result && result.error) {
      await interaction.followUp({ content: result.error, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    updatedGame = result;
  } else {
    return;
  }

  if (!updatedGame) {
    await interaction.followUp({ content: 'This blackjack game has ended.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const embed = buildBlackjackEmbed(interaction.user, updatedGame);
  const canDouble = updatedGame.player && updatedGame.player.length === 2 && !updatedGame.finished && updatedGame.bet > 0 && hasBalance(userId, updatedGame.bet);
  const components = buildBlackjackComponents(userId, updatedGame.finished, canDouble);

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

  const { HELP_PAGE_COUNT } = require('./commands');
  pageIndex = Math.max(0, Math.min(HELP_PAGE_COUNT - 1, pageIndex));

  const botAvatar = interaction.client.user?.displayAvatarURL({ size: 1024 }) ?? null;
  const dashboardUrl = interaction.guildId
    ? buildDashboardUrl(interaction.guildId, 'player')
    : `${String(process.env.WEB_URL || 'https://breadmusic.aleksh.xyz').replace(/\/$/, '')}/dashboard`;
  const embed = buildHelpEmbed(pageIndex, { botAvatar });
  const components = buildHelpComponents(pageIndex, userId, dashboardUrl);

  await interaction.update({ embeds: [embed], components }).catch(() => {});
}

async function handleRPSButton(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];

  if (!action) {
    await interaction.reply({ content: 'Invalid RPS action.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  
  if (action === 'choice') {
    if (parts.length < 6) {
      await interaction.update({ content: 'Invalid duel payload.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    const challengerId = parts[2];
    const targetId = parts[3];
    const bet = Math.max(0, parseInt(parts[4], 10) || 0);
    const choice = parts[5];

    if (interaction.user.id !== challengerId) {
      await interaction.reply({ content: 'This hidden choice menu is not for you!', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (!RPS_CHOICES.includes(choice)) {
      await interaction.update({ content: 'Invalid move selected.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (targetId === challengerId) {
      await interaction.update({ content: "You can't challenge yourself!", embeds: [], components: [] }).catch(() => {});
      return;
    }

    const opponent = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!opponent) {
      await interaction.update({ content: 'Could not find that opponent. Try again.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (opponent.bot) {
      await interaction.update({ content: "You can't challenge a bot. Use `/rps solo` instead.", embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (bet > 0) {
      if (!hasBalance(challengerId, bet)) {
        await interaction.update({ content: `You don't have enough 🍞! Your balance: ${getBalance(challengerId)} 🍞`, embeds: [], components: [] }).catch(() => {});
        return;
      }
      if (!hasBalance(targetId, bet)) {
        await interaction.update({ content: `**${opponent.username}** doesn't have enough 🍞 for this bet!`, embeds: [], components: [] }).catch(() => {});
        return;
      }
    }

    if (!interaction.channel || typeof interaction.channel.send !== 'function') {
      await interaction.update({ content: 'Could not send challenge in this channel.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    const challenge = createChallenge(
      challengerId,
      interaction.user.username,
      targetId,
      opponent.username,
      bet,
      choice,
    );

    const embed = buildRPSChallengeEmbed(challenge);
    const components = buildRPSChallengeComponents(challenge);

    try {
      const message = await interaction.channel.send({ content: `<@${targetId}>`, embeds: [embed], components });
      setMessageInfo(challenge.id, message.channelId, message.id);
      await interaction.update({
        content: `✅ Challenge sent to <@${targetId}>. Your move is hidden until duel ends.`,
        embeds: [],
        components: [],
      }).catch(() => {});
    } catch {
      cancelChallenge(challenge.id);
      await interaction.update({ content: 'Failed to send challenge message.', embeds: [], components: [] }).catch(() => {});
    }
    return;
  }

  const challengeId = parts[2];
  const parsedMeta = parseChallengeMeta(challengeId);
  const targetId = parsedMeta?.targetId || parts[3];

  if (!targetId) {
    await interaction.reply({ content: 'Invalid RPS interaction payload.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const hasExtendedPayload = action === 'play' ? parts.length >= 6 : parts.length >= 5;
  const encodedChallengerChoice = hasExtendedPayload ? parts[3] : null;
  const encodedBet = hasExtendedPayload ? Math.max(0, parseInt(parts[4], 10) || 0) : 0;
  const choice = action === 'play'
    ? (hasExtendedPayload ? parts[5] : parts[4])
    : null;

  const challenge = getChallenge(challengeId);
  
  if (interaction.user.id !== targetId) {
    await interaction.reply({ content: 'This challenge is not for you!', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  
  if (!challenge || challenge.status !== 'pending') {
    const canFallbackResolve = Boolean(
      parsedMeta &&
      encodedChallengerChoice &&
      RPS_CHOICES.includes(encodedChallengerChoice) &&
      Date.now() - parsedMeta.createdAt <= 60_000,
    );

    if (canFallbackResolve && action === 'decline') {
      await interaction.update({
        content: `❌ **${interaction.user.username}** declined the challenge.`,
        embeds: [],
        components: [],
      }).catch(() => {});
      return;
    }

    if (canFallbackResolve && action === 'play' && choice && RPS_CHOICES.includes(choice)) {
      const fallbackChallenge = {
        id: challengeId,
        challengerId: parsedMeta.challengerId,
        challengerName: 'Challenger',
        targetId: parsedMeta.targetId,
        targetName: interaction.user.username,
        bet: encodedBet,
        challengerChoice: encodedChallengerChoice,
        targetChoice: choice,
      };

      const challengerUser = await interaction.client.users.fetch(parsedMeta.challengerId).catch(() => null);
      if (challengerUser) {
        fallbackChallenge.challengerName = challengerUser.username;
      }

      if (fallbackChallenge.bet > 0) {
        if (!hasBalance(fallbackChallenge.challengerId, fallbackChallenge.bet)) {
          await interaction.update({
            content: `Challenge cancelled - **${fallbackChallenge.challengerName}** no longer has enough 🍞!`,
            embeds: [],
            components: [],
          }).catch(() => {});
          return;
        }

        if (!hasBalance(fallbackChallenge.targetId, fallbackChallenge.bet)) {
          await interaction.update({
            content: `Challenge cancelled - **${fallbackChallenge.targetName}** doesn't have enough 🍞!`,
            embeds: [],
            components: [],
          }).catch(() => {});
          return;
        }

        removeBalance(fallbackChallenge.challengerId, fallbackChallenge.bet);
        removeBalance(fallbackChallenge.targetId, fallbackChallenge.bet);
      }

      const outcome = determineWinner(fallbackChallenge);

      if (fallbackChallenge.bet > 0) {
        if (outcome.result === 'draw') {
          addBalance(fallbackChallenge.challengerId, fallbackChallenge.bet);
          addBalance(fallbackChallenge.targetId, fallbackChallenge.bet);
        } else {
          addBalance(outcome.winnerId, fallbackChallenge.bet * 2);
        }
      }

      const resultEmbed = buildRPSDuelResultEmbed(fallbackChallenge, outcome);
      await interaction.update({ embeds: [resultEmbed], components: [] }).catch(() => {});
      return;
    }

    await interaction.update({ 
      content: 'This challenge has expired or was cancelled.', 
      embeds: [], 
      components: [] 
    }).catch(() => {});
    return;
  }
  
  if (action === 'decline') {
    cleanupChallenge(challengeId);
    await interaction.update({ 
      content: `❌ **${interaction.user.username}** declined the challenge.`, 
      embeds: [], 
      components: [] 
    }).catch(() => {});
    return;
  }
  
  if (action === 'play') {
    if (!choice || !RPS_CHOICES.includes(choice)) {
      await interaction.update({ content: 'Invalid move selected.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (challenge.bet > 0) {
      if (!hasBalance(challenge.challengerId, challenge.bet)) {
        await interaction.update({ 
          content: `Challenge cancelled - **${challenge.challengerName}** no longer has enough 🍞!`, 
          embeds: [], 
          components: [] 
        }).catch(() => {});
        cleanupChallenge(challengeId);
        return;
      }
      if (!hasBalance(challenge.targetId, challenge.bet)) {
        await interaction.update({ 
          content: `Challenge cancelled - **${challenge.targetName}** doesn't have enough 🍞!`, 
          embeds: [], 
          components: [] 
        }).catch(() => {});
        cleanupChallenge(challengeId);
        return;
      }
      
      removeBalance(challenge.challengerId, challenge.bet);
      removeBalance(challenge.targetId, challenge.bet);
    }
    
    const updatedChallenge = setTargetChoice(challengeId, choice);
    
    if (!updatedChallenge) {
      await interaction.update({ content: 'Error saving choice.', embeds: [], components: [] }).catch(() => {});
      return;
    }
    
    const outcome = determineWinner(updatedChallenge);
    
    if (updatedChallenge.bet > 0) {
      if (outcome.result === 'draw') {
        addBalance(updatedChallenge.challengerId, updatedChallenge.bet);
        addBalance(updatedChallenge.targetId, updatedChallenge.bet);
      } else {
        addBalance(outcome.winnerId, updatedChallenge.bet * 2);
      }
    }
    
    const resultEmbed = buildRPSDuelResultEmbed(updatedChallenge, outcome);
    
    await interaction.update({ 
      embeds: [resultEmbed], 
      components: [] 
    }).catch(() => {});
    
    cleanupChallenge(challengeId);
    return;
  }
}

function parseChallengeMeta(challengeId) {
  if (!challengeId || typeof challengeId !== 'string') return null;
  const match = challengeId.match(/^(\d+)-(\d+)-(\d+)$/);
  if (!match) return null;

  const createdAt = Number(match[3]);
  if (!Number.isFinite(createdAt)) return null;

  return {
    challengerId: match[1],
    targetId: match[2],
    createdAt,
  };
}

async function togglePlayPause(interaction) {
  const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
  assertDJ(interaction, config);
  await interaction.deferUpdate();
  if (player.paused) await player.resume();
  else await player.pause();
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function skipTrack(interaction) {
  const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
  await interaction.deferUpdate();
  if (player.repeatMode === 'track' && canControlPlayer(interaction, config)) {
    const restarted = await restartCurrent(player);
    if (!restarted) {
      await interaction
        .followUp({ content: 'Nothing is playing to restart.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    return;
  }
  const result = await withGuildMutex(interaction.guildId, () =>
    handleSkipRequest(interaction, player, config, client),
  );
  broadcastPlayerUpdate(interaction.guildId);
  if (result.skipped) {
    if (result.needsAutoplay && result.lastTrack) {
      await handleAutoplay(player, result.lastTrack, client);
    }
    await savePlayerState(player).catch(() => {});
  } else {
    await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function stopPlayback(interaction) {
  const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
  assertDJ(interaction, config);
  await interaction.deferUpdate();
  clearAutoplayState(player.guildId);
  markPlayerStopping(player);
  await clearVoiceTrackStatus(client, player);
  await player.stopPlaying(true);
  player.queue.tracks.splice(0, player.queue.tracks.length);
  await player.destroy('Stopped via UI', true);
  await savePlayerState(player).catch(() => {});
  await client.musicUI.clear(player.guildId);
}

async function playPrevious(interaction) {
  const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
  assertDJ(interaction, config);
  await interaction.deferUpdate();
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
  const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
  assertDJ(interaction, config);
  await interaction.deferUpdate();
  const order = ['off', 'track', 'queue'];
  const currentIndex = order.indexOf(player.repeatMode ?? 'off');
  const nextMode = order[(currentIndex + 1) % order.length];
  await player.setRepeatMode(nextMode);
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function shuffleQueue(interaction) {
  const { player, config } = await ensurePlayer(interaction, { requireSameChannel: true });
  assertDJ(interaction, config);
  await interaction.deferUpdate();
  if (player.queue.tracks.length === 0) {
    await interaction.followUp({ content: 'No tracks to shuffle.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  await player.queue.shuffle();
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
}

async function handleVoteSkipButton(interaction) {
  const [, guildId, trackToken] = interaction.customId.split(':');
  if (!guildId || guildId !== interaction.guildId) {
    await interaction.reply({ content: 'This vote is no longer valid.', flags: MessageFlags.Ephemeral });
    return;
  }

  const player = client.lavalink?.getPlayer(guildId);
  if (!player?.queue?.current || getTrackToken(getTrackKey(player.queue.current)) !== trackToken) {
    await interaction.reply({ content: 'This track is no longer playing.', flags: MessageFlags.Ephemeral });
    await clearVoteSkip(guildId);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = getConfig(guildId);
  const result = await withGuildMutex(guildId, () =>
    handleSkipRequest(interaction, player, config, client),
  );
  broadcastPlayerUpdate(guildId);
  if (result.needsAutoplay && result.lastTrack) {
    await handleAutoplay(player, result.lastTrack, client);
  }
  if (result.skipped) await savePlayerState(player).catch(() => {});
  await interaction.editReply(result.message);
}

async function showLyrics(interaction) {
  const { player } = await ensurePlayer(interaction, { allowCreate: false });
  const track = player.queue.current;
  if (!track) {
    throw new CommandError('Nothing is playing.');
  }
  await client.lyricsUI.send(interaction, player, track);
}

async function restartCurrent(player) {
  const current = player.queue.current;
  if (!current) return false;
  await player.play({ clientTrack: current, startTime: 0 });
  await savePlayerState(player).catch(() => {});
  await client.musicUI.refresh(player);
  return true;
}

function canControlPlayer(interaction, guildConfig) {
  return !guildConfig?.djRoleId || hasDJPermissions(interaction.member, guildConfig);
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
    if (!isGuildAllowed(config.guildAccess, guildId)) continue;
    if (!guildConfig.stayInChannel || !guildConfig.twentyFourSevenChannelId) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const textChannelId = resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId);

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

function resolvePlayerTextChannelId(guild, preferredChannelId = null) {
  if (!guild) return null;

  if (preferredChannelId === 'disabled') {
    return null;
  }

  if (preferredChannelId) {
    const preferred = guild.channels.cache.get(preferredChannelId);
    if (isUsableTextChannel(preferred)) {
      return preferred.id;
    }
  }

  return null;
}

function isUsableTextChannel(channel) {
  if (!channel || !channel.isTextBased()) return false;
  if (typeof channel.isSendable === 'function') return channel.isSendable();
  return channel.viewable !== false;
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

    if ((interaction.deferred || interaction.replied) && ephemeral && !interaction.ephemeral) {
      await deleteInteractionReply(interaction).catch(() => {});
      await interaction.followUp({
        content,
        flags: MessageFlags.Ephemeral,
      });
    } else if (interaction.deferred || interaction.replied) {
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

  await flushQueueStore().catch((error) => {
    console.error('Failed to flush queue store:', error);
  });
  client.lyricsUI?.clearAll();

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
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') return;
  gracefulShutdown('uncaughtException');
});
