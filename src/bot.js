// @ts-check
const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  ActivityType,
  MessageFlags,
  Partials,
} = require('discord.js');
// @ts-expect-error lavalink-client publishes ESM-only types for its CommonJS build.
const { LavalinkManager } = require('lavalink-client');
const path = require('node:path');
const { loadConfig } = require('./config');
const { CommandError } = require('./music/utils');
const {
  commands,
  buildHelpEmbed,
  buildHelpComponents,
} = require('./commands');
const { MusicUI, BUTTON_PREFIX } = require('./music/ui');
const { clearVoteSkip, VOTE_SKIP_BUTTON_PREFIX } = require('./music/skipManager');
const { isPlayerStopping } = require('./music/playerLifecycle');
const { savePlayerState, hydratePlayer, flushQueueStore } = require('./state/queueStore');
const { recordTrackPlay, getUserInsights } = require('./state/analyticsStore');
const { isStreamTrack } = require('./music/autoplay/normalize');
const { VOLUME_DECREMENTER, capLavalinkVolume, syncGainStage } = require('./music/volume');
const { scheduleIdleLeave, handleVoiceStateUpdate, clearEmptyChannelTimer, clearIdleTimer } = require('./music/idleTracker');
const { getConfig, listConfigs } = require('./state/guildConfig');
const { createSelection } = require('./state/searchCache');
const { deleteInteractionReply } = require('./utils/interactions');
const { buildDashboardUrl } = require('./dashboard/url');
const { createDmResponder } = require('./utils/dmResponder');
const { collectTasteHints, createDmPersona, getVoiceContext } = require('./utils/dmPersona');
const { DM_RECOMMEND_PREFIX, handleDmRecommendButton } = require('./utils/dmRecommendQueue');
const { createPresenceRotation } = require('./utils/presenceRotation');
const { QUEUE_BUTTON_PREFIX } = require('./music/queueFormatter');
const { applyPreferredSource } = require('./music/searchUtils');
const { formatDuration } = require('./utils/time');
const { BUTTON_PREFIX: BLACKJACK_BUTTON_PREFIX } = require('./games/blackjack');
const { BUTTON_PREFIX: ARCADE_BUTTON_PREFIX } = require('./games/arcadeControls');
const {
  handleAutoplay,
  scheduleAutoplayPrefetch,
  clearAutoplayState,
  addToRecentTracks,
  recordTrackPlayed,
  blockAutoplayAfterPlaybackFailure,
  resumeAutoplayAfterPlaybackSuccess,
  autoplayEvents,
} = require('./music/autoplay');
const { syncPlayerEmojis } = require('./music/playerEmojis');
const { flush: flushAutoplayProfiles } = require('./music/autoplay/profileStore');
const { flush: flushLibrary } = require('./music/library');
const { flush: flushAutoplayUserTaste } = require('./music/autoplay/userTaste');
const {
  clearVoiceTrackStatus,
  handleVoiceStatusGatewayEvent,
  setVoiceTrackStatus,
} = require('./music/voiceStatus');
const { createRadioNowPlaying } = require('./music/radioNowPlaying');
const { buildAccessDeniedMessage, isGuildAllowed } = require('./access/guildAccess');
const { createPlaybackRecovery } = require('./music/playbackRecovery');
const { createPlaybackFallback } = require('./music/playbackFallback');
const { getGeminiStatus } = require('./music/autoplayAi');
const { createAlertManager, createDmTransport, startMonitoring } = require('./utils/alerts');
const {
  CLOSE_LYRICS_BUTTON_PREFIX,
  LyricsUI,
  LIVE_LYRICS_BUTTON_PREFIX,
  PAGE_LYRICS_BUTTON_PREFIX,
} = require('./music/lyricsUi');
const { RPS_BUTTON_PREFIX, setExpireCallback, buildRPSExpiredMessage } = require('./games/fun');
const { handleBlackjackButton, handleArcadeReplayButton, handleRPSButton } = require('./games/buttons');
const { createMusicButtons } = require('./music/buttons');

const HELP_BUTTON_PREFIX = 'help:';

const ACTIVITY_ROTATION_INTERVAL = 30_000;
const NODE_RECONNECT_DELAY = 5_000;
const AUTOCOMPLETE_TIMEOUT = 2_500;
const MAX_AUTOCOMPLETE_RESULTS = 5;
const SHUTDOWN_TEARDOWN_TIMEOUT_MS = 6_000;

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

/**
 * The Discord client with the services Bread attaches to it at startup.
 * @typedef {Client & {
 *   commands: Collection<string, any>,
 *   musicUI: any,
 *   lyricsUI: any,
 *   behavior: any,
 *   guildAccess: any,
 *   lavalink: any,
 * }} BreadClient
 */
const client = /** @type {BreadClient} */ (new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
}));

const dmPersona = createDmPersona();
const handleDirectMessage = createDmResponder({
  dashboardUrl: `${String(process.env.WEB_URL || 'https://breadmusic.aleksh.xyz').replace(/\/$/, '')}/dashboard`,
  contact: process.env.PRIVATE_ACCESS_CONTACT || 'aleksh8',
  persona: dmPersona,
  getTasteHints: (userId) => collectTasteHints(client, userId, getUserInsights),
  getVoiceContext: (userId) => getVoiceContext(client, userId),
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
  { type: ActivityType.Playing,   name: "/play • skip button speedrun any%" },
  { type: ActivityType.Listening, name: "/play • your DJ arc begins" },
  { type: ActivityType.Watching,  name: "/play • the queue grows stronger" },
  { type: ActivityType.Playing,   name: "/play • certified banger incoming" },
  { type: ActivityType.Listening, name: "/play • shazam could never" },
  { type: ActivityType.Watching,  name: "/play • volume at illegal levels" },
  { type: ActivityType.Playing,   name: "/play • bass drop liability" },
  { type: ActivityType.Listening, name: "/play • the algorithm fears us" },

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
  { type: ActivityType.Playing,   name: "Activity • the aux is a shared burden" },
  { type: ActivityType.Listening, name: "Activity • eavesdropping on the vibe" },
  { type: ActivityType.Watching,  name: "Activity • DJing without leaving spawn" },
  { type: ActivityType.Playing,   name: "Activity • your playlist's villain arc" },
  { type: ActivityType.Listening, name: "Activity • group project, but fun" },
  { type: ActivityType.Watching,  name: "Activity • 24/7, no bathroom breaks" },
  { type: ActivityType.Playing,   name: "Activity • touch grass, keep the queue" },

  { type: ActivityType.Listening, name: "/dashboard • controlling the chaos" },
  { type: ActivityType.Playing,   name: "/dashboard • queue management simulator" },
  { type: ActivityType.Watching,  name: "/dashboard • live controls, questionable decisions" },
  { type: ActivityType.Listening, name: "/dashboard • control issues, resolved" },
  { type: ActivityType.Playing,   name: "/dashboard • knobs without the booth" },
  { type: ActivityType.Watching,  name: "/dashboard • browser-based DJ decisions" },
  { type: ActivityType.Watching,  name: "/dashboard • DJ powers from the couch" },
  { type: ActivityType.Playing,   name: "/dashboard • drag, drop and pray" },
  { type: ActivityType.Listening, name: "/dashboard • faders without a desk" },
  { type: ActivityType.Watching,  name: "/dashboard • your queue, but fancy" },
  { type: ActivityType.Playing,   name: "/dashboard • remote control energy" },

  { type: ActivityType.Playing,   name: "/lyrics • karaoke without the rent" },
  { type: ActivityType.Watching,  name: "/lyrics • words pending" },
  { type: ActivityType.Listening, name: "/lyrics • singing is optional" },
  { type: ActivityType.Playing,   name: "/lyrics • reading between the beats" },
  { type: ActivityType.Watching,  name: "/lyrics • subtitles for your shower concert" },
  { type: ActivityType.Listening, name: "/lyrics • vocals not included" },
  { type: ActivityType.Playing,   name: "/lyrics • words before the beat drops" },
  { type: ActivityType.Watching,  name: "/lyrics • mishear in HD" },
  { type: ActivityType.Listening, name: "/lyrics • words at 0.5x speed" },
  { type: ActivityType.Playing,   name: "/lyrics • duet with the ceiling" },
  { type: ActivityType.Watching,  name: "/lyrics • sing like nobody's watching" },

  { type: ActivityType.Playing,   name: "/help • ask nicely" },
  { type: ActivityType.Listening, name: "/help • professionally confused" },
  { type: ActivityType.Watching,  name: "/help • answers sold separately" },
  { type: ActivityType.Playing,   name: "/help • plot twist: documentation" },
  { type: ActivityType.Playing,   name: "/help • the manual speedrun" },
  { type: ActivityType.Listening, name: "/help • answers within seconds" },
  { type: ActivityType.Watching,  name: "/help • google, but friendlier" },
  { type: ActivityType.Watching,  name: "/stats • keeping receipts" },
  { type: ActivityType.Listening, name: "/stats • counting the damage" },
  { type: ActivityType.Watching,  name: "/stats • playback paperwork" },
  { type: ActivityType.Playing,   name: "/stats • your listening alibi" },
  { type: ActivityType.Listening, name: "/stats • numbers with rhythm" },
  { type: ActivityType.Watching,  name: "/stats • evidence of one more song" },
  { type: ActivityType.Playing,   name: "/stats • quantifying the vibe" },
  { type: ActivityType.Watching,  name: "/stats • your villain origin story" },
  { type: ActivityType.Playing,   name: "/stats • damage report ready" },
  { type: ActivityType.Listening, name: "/stats • the receipts are audited" },
  { type: ActivityType.Watching,  name: "/stats • graphs go brrr" },
  { type: ActivityType.Playing,   name: "/stats • wrapped before wrapped" },
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
    defaultSearchPlatform: /** @type {import('lavalink-client', { with: { 'resolution-mode': 'import' } }).SearchPlatform} */ (config.lavalink.defaultSource),
    volumeDecrementer: VOLUME_DECREMENTER,
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
      .then((channel) => (channel?.isTextBased() ? channel.messages.fetch(data.d.id) : null))
      .then((message) => message && processDirectMessage(message))
      .catch((error) => console.warn('[DirectMessage] Raw fallback failed:', error.message));
  });
});

client.on(Events.MessageCreate, safeEventHandler('DirectMessage', async (message) => {
  if (isShuttingDown) return;
  await processDirectMessage(message);
}));

let alertMonitor = null;

function startAlertMonitoring() {
  if (alertMonitor || !config.alerts?.enabled) return;

  const alerter = createAlertManager({
    transports: [createDmTransport(client, config.alerts.dmUserId, {
      logger: (message) => console.log(message),
    })],
  });

  alertMonitor = startMonitoring({
    client,
    alerter,
    dataDir: path.join(process.cwd(), 'data'),
    diskMinBytes: config.alerts.diskMinBytes,
    rssMaxBytes: config.alerts.rssMaxBytes,
    getGeminiStatus: () => getGeminiStatus(),
  });
  console.log('Alert monitoring started (DM recipient:', config.alerts.dmUserId ? 'configured' : 'application owner', ').');
}

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
        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(challenge.messageId);
          if (message) {
            const expiredMessage = await buildRPSExpiredMessage(challenge);
            await message.edit({ ...expiredMessage, components: [] });
          }
        }
      } catch {
        // The challenge message was deleted or the channel is gone; nothing left to update.
      }
    }
  });

  const addedIcons = await syncPlayerEmojis(readyClient.application).catch(() => 0);
  if (addedIcons) console.log(`Uploaded ${addedIcons} player icons.`);

  startActivityRotation();
  await restoreTwentyFourSevenPlayers();
  startAlertMonitoring();
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
    } catch (error) {
      // Autocomplete often expires while the user keeps typing; anything else is worth seeing.
      if (error?.code !== 10062) console.warn('Autocomplete failed:', error?.message ?? error);
    }
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      if (interaction.guildId) broadcastPlayerUpdate(interaction.guildId);
      return;
    }

    // Commands that own their buttons, select menus and modals claim them by customId prefix.
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const owner = client.commands.find(
        (command) => command.componentPrefix && interaction.customId.startsWith(command.componentPrefix),
      );
      if (owner) {
        await owner.handleComponent(interaction);
        if (interaction.guildId) broadcastPlayerUpdate(interaction.guildId);
        return;
      }
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

      if (interaction.customId.startsWith(ARCADE_BUTTON_PREFIX)) {
        await handleArcadeReplayButton(interaction);
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

      if (interaction.customId.startsWith(DM_RECOMMEND_PREFIX)) {
        await handleDmRecommendButton(interaction, { client, broadcastPlayerUpdate });
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

// Radio streams say what they are airing, so the player and channel status follow the song.
const radioNowPlaying = createRadioNowPlaying({
  onChange: async (player, track) => {
    await Promise.all([
      client.musicUI.refresh(player),
      setVoiceTrackStatus(client, player, track),
    ]);
    broadcastPlayerUpdate(player.guildId);
  },
});

// A player created at a loud default volume would otherwise reach Lavalink above unity.
client.lavalink.on('playerCreate', (player) => capLavalinkVolume(player));

client.lavalink.on('trackStart', safeEventHandler('trackStart', async (player, track) => {
  radioNowPlaying.watch(player);
  await syncGainStage(player).catch((error) => console.error('Failed to sync gain stage:', error.message));
  resumeAutoplayAfterPlaybackSuccess(player.guildId);
  await clearVoteSkip(player.guildId);
  clearIdleTimer(player.guildId);
  addToRecentTracks(player.guildId, track);
  recordTrackPlayed(player.guildId, track);
  scheduleAutoplayPrefetch(player, track, client);
  // Live radio never finishes, so it would only skew listening stats.
  if (!isStreamTrack(track)) recordTrackPlay(player.guildId, track, { botUserId: client.user?.id });
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

  radioNowPlaying.stop(player.guildId);
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
  radioNowPlaying.stop(player.guildId);
  clearEmptyChannelTimer(player.guildId);
  // Players destroyed by a shutdown are restored on start, so their autoplay session is kept.
  if (!isShuttingDown) clearAutoplayState(player.guildId);
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
const { resolvePlayerTextChannelId } = require('./api/playerSnapshot');
const { handleMusicButton, handleQueueButton, handleVoteSkipButton } = createMusicButtons({ client, broadcastPlayerUpdate });

const AUTOPLAY_EXHAUSTED_MESSAGE = "Autoplay couldn't find a fitting track — add a song to keep going.";

autoplayEvents.on('next-changed', (guildId) => {
  broadcastPlayerUpdate(guildId);
  const player = client.lavalink.getPlayer(guildId);
  if (player) client.musicUI.scheduleAutoplayRefresh(player);
});

autoplayEvents.on('exhausted', (guildId) => {
  const player = client.lavalink.getPlayer(guildId);
  if (player) {
    client.musicUI.sendAutoplayNotice(player, AUTOPLAY_EXHAUSTED_MESSAGE).catch(() => {});
  }
  client.emit('breadPlayerNotice', { guildId, message: AUTOPLAY_EXHAUSTED_MESSAGE, tone: 'warning' });
});

function getConnectedNode() {
  const nodes = client.lavalink?.nodeManager?.nodes;
  if (!nodes) return null;
  for (const node of nodes.values()) {
    if (node.connected) return node;
  }
  return null;
}

const playbackFallback = createPlaybackFallback({
  search: async (query) => {
    const node = getConnectedNode();
    if (!node) return null;
    return await node.search({ query }, client.user);
  },
});

const recoverPlaybackFailure = createPlaybackRecovery({
  recoverySet: playbackFailureRecovery,
  isPlayerStopping,
  sendPlaybackError: (player, track, payload) => client.musicUI.sendPlaybackError(player, track, payload),
  findReplacement: ({ player, track }) => playbackFallback.findReplacementTrack({ player, track }),
  notifyReplacement: (player, track, replacement) =>
    client.musicUI.sendReplacementNotice(player, track, replacement),
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

async function handleAutocomplete(interaction) {
  const command = client.commands.get(interaction.commandName);
  if (typeof command?.autocomplete === 'function') {
    await command.autocomplete(interaction);
    return;
  }
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
  } catch {
    // The interaction expired, so the user can no longer be told about the error.
  }
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n[${signal}] Shutting down gracefully...`);

  clearInterval(activityIntervalId);
  radioNowPlaying.stopAll();
  alertMonitor?.stop();
  alertMonitor = null;

  // Docker kills the process 10 seconds after SIGTERM, so everything people saved is written
  // before the slower network teardown, and that teardown gets a deadline of its own.
  flushAutoplayProfiles();
  flushAutoplayUserTaste();
  flushLibrary();

  const players = [...(client.lavalink?.players?.values() ?? [])];
  for (const player of players) {
    await savePlayerState(player).catch(() => {});
  }
  await flushQueueStore().catch((error) => {
    console.error('Failed to flush queue store:', error);
  });

  const teardown = (async () => {
    await Promise.allSettled(players.map((player) => player.destroy('Bot shutting down', false)));
    await Promise.allSettled(
      [...(client.musicUI?.messages?.keys() ?? [])].map((guildId) => client.musicUI.clear(guildId)),
    );
  })();
  await Promise.race([teardown, new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TEARDOWN_TIMEOUT_MS))]);
  client.lyricsUI?.clearAll();

  try {
    client.destroy();
  } catch {
    // Shutting down anyway.
  }

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
  const { code } = /** @type {NodeJS.ErrnoException} */ (error);
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return;
  gracefulShutdown('uncaughtException');
});
