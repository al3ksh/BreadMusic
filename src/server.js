const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { getConfig, setConfig, deleteConfig, isDJListening } = require('./state/guildConfig');
const { getGuildInsights, getGuildHistory } = require('./state/analyticsStore');
const { getBalance, addBalance, removeBalance, getLeaderboard } = require('./games/economy');
const {
  setAutoplay,
  addManualSeed,
  recordAutoplaySkip,
  clearAutoplayState,
  clearAutoplayPrefetch,
  handleAutoplay,
  likeTrack,
  dislikeTrack,
  undislikeTrack,
  rerollNext,
  rebuildProfileFromHistory,
  scheduleAutoplayPrefetch,
  getListenerIds,
} = require('./music/autoplay');
const { SOUND_PRESET_CHOICES } = require('./music/sound');
const { getLastfmClient } = require('./music/autoplay/lastfm');
const { applyPreferredSource } = require('./music/searchUtils');
const { classifyPlaybackError, describeSearchFailure } = require('./music/playbackErrors');
const { clearVoiceTrackStatus, setVoiceTrackStatus } = require('./music/voiceStatus');
const { createFileSessionStore } = require('./state/sessionStore');
const { createHealthRouter } = require('./routes/health');
const { createActivityRouter } = require('./routes/activity');
const { createUploadRouter } = require('./routes/uploads');
const { createAuthRouter } = require('./routes/auth');
const { hydratePlayer, savePlayerState } = require('./state/queueStore');
const { createGuildConfigRouter } = require('./routes/guildConfig');
const { createPlayerRouter } = require('./routes/player');
const { createLibraryRouter } = require('./routes/library');
const { createGuildStatusRouter } = require('./routes/guildStatus');
const { createEconomyRouter } = require('./routes/economy');
const { createControlRouter } = require('./routes/control');
const { createPublicRouter } = require('./routes/public');
const library = require('./music/library');
const { resolveActivityCapabilities, resolveDashboardCapabilities } = require('./dashboard/access');
const { createServerExtensionHost } = require('./extensions/serverExtensions');
const { findLyrics, trackToLyricsQuery } = require('./music/lyrics');
const { handleSkipRequest, clearVoteSkip } = require('./music/skipManager');
const { queueRequestedTracks } = require('./music/queueInsert');
const { markPlayerStopping } = require('./music/playerLifecycle');
const { buildAccessDeniedMessage, isGuildAllowed } = require('./access/guildAccess');
const { acquireGuildMutex } = require('./music/guildMutex');
const {
  isTrackSeekable,
  getTrackCapabilityMetadata,
  isUnseekableTrackError,
  seekTrack,
} = require('./music/trackCapabilities');
const { normalizeSourceName } = require('./music/sourceNames');
const {
  createSignedUploadUrl,
  getUploadPlaybackBaseUrl,
  hasValidUploadSignature,
} = require('./music/uploadUrls');
const { createFixedWindowRateLimiter } = require('./utils/rateLimit');
const {
  AUDIO_UPLOAD_MAX_BYTES,
  AUDIO_UPLOAD_QUOTA_BYTES,
  AUDIO_UPLOAD_TTL_MS,
  AUDIO_UPLOAD_EXTENSIONS,
  UPLOAD_DIR,
  activeUploadTempPaths,
  acquireUploadQuotaMutex,
  sanitizeUploadName,
  decodeUploadHeader,
  isAllowedAudioUpload,
  isSafeId,
  isPathInside,
  getAudioContentType,
  streamUploadToFile,
  renameFileWithRetry,
  safeDeleteFile,
  fileExists,
  touchFile,
  cleanupExpiredAudioUploads,
  runAudioUploadCleanup,
  makeRoomForAudioUpload,
} = require('./api/uploadStorage');
const {
  PLAYER_TEXT_CHANNEL_DISABLED,
  resolvePlayerTextChannelId,
  isUsableTextChannel,
  buildPlayerStatusSnapshot,
  buildQueueSnapshot,
  isUnknownTrackAuthor,
  parseQueuePage,
  writeSseEvent,
  extractArtwork,
  isAllowedActivityArtworkHost,
} = require('./api/playerSnapshot');
const {
  playerEventSubscribers,
  publishPlayerNotice,
  getPlayerNotice,
  broadcastPlayerUpdate,
} = require('./api/playerEvents');
const {
  DISCORD_API,
  SCOPES,
  getDashboardRequester,
  getRequestUser,
  resolveRequestAuth,
  resolveActivityUser,
  getUsableNode,
  refreshAccessToken,
  normalizeOrigin,
  buildTrustedOrigins,
} = require('./api/requestAuth');

const ACTIVITY_ARTWORK_MAX_BYTES = 6 * 1024 * 1024;
const ACTIVITY_TOKEN_RATE_LIMIT = createFixedWindowRateLimiter({ windowMs: 60_000, max: 10 });
const ACTIVITY_ARTWORK_RATE_LIMIT = createFixedWindowRateLimiter({ windowMs: 60_000, max: 120 });

const FILTER_PRESET_CHOICES = SOUND_PRESET_CHOICES;

const DASHBOARD_ACTION_INTERVAL_MS = 250;
const DASHBOARD_SEARCH_INTERVAL_MS = 750;
const DASHBOARD_JOIN_INTERVAL_MS = 750;
const ACTIVITY_VOICE_RECONNECT_DELAY_MS = 250;
const ACTIVITY_VOICE_READY_TIMEOUT_MS = 5_000;
const dashboardActionTimestamps = new Map();
const playerSearchCache = new Map();
const PLAYER_SEARCH_CACHE_TTL_MS = 10_000;
const PLAYER_PLAYLIST_CACHE_TTL_MS = 2 * 60_000;
const PLAYER_SEARCH_CACHE_MAX_ENTRIES = 200;
const PLAYER_PLAYLIST_CACHE_MAX_TRACKS = 5_000;
const PLAYER_PLAYLIST_MAX_TRACKS = 500;

function prunePlayerSearchCache(now = Date.now()) {
  for (const [key, entry] of playerSearchCache) {
    if (entry.expiresAt <= now) playerSearchCache.delete(key);
  }

  let cachedPlaylistTracks = 0;
  for (const entry of playerSearchCache.values()) {
    cachedPlaylistTracks += entry.playlistTracks?.length || 0;
  }

  while (
    playerSearchCache.size > PLAYER_SEARCH_CACHE_MAX_ENTRIES ||
    cachedPlaylistTracks > PLAYER_PLAYLIST_CACHE_MAX_TRACKS
  ) {
    const oldestKey = playerSearchCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = playerSearchCache.get(oldestKey);
    cachedPlaylistTracks -= oldest?.playlistTracks?.length || 0;
    playerSearchCache.delete(oldestKey);
  }
}

function waitForPlayerVoice(player, timeoutMs = ACTIVITY_VOICE_READY_TIMEOUT_MS) {
  if (player?.voice?.sessionId && player.voice.token && player.voice.endpoint) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (player?.voice?.sessionId && player.voice.token && player.voice.endpoint) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 100).unref?.();
    };
    check();
  });
}

function createApiServer(client) {
  const extensionHost = createServerExtensionHost();
  const app = express();
  client.on('breadPlayerNotice', ({ guildId, message, tone }) => {
    publishPlayerNotice(guildId, message, tone);
  });
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required.');
  }
  const trustedOrigins = buildTrustedOrigins(process.env.WEB_URL);

  // Behind cloudflared/reverse proxy, trust one hop so secure cookies work correctly.
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser(sessionSecret));
  app.use(
    session({
      store: createFileSessionStore(session, { secret: sessionSecret }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: isProduction ? 'auto' : false,
        sameSite: 'lax',
      },
      name: 'bread.sid',
    }),
  );

  app.use(createHealthRouter(client));
  app.use(createActivityRouter({
    discordApi: DISCORD_API,
    artworkMaxBytes: ACTIVITY_ARTWORK_MAX_BYTES,
    artworkRateLimit: ACTIVITY_ARTWORK_RATE_LIMIT,
    tokenRateLimit: ACTIVITY_TOKEN_RATE_LIMIT,
    isAllowedArtworkHost: isAllowedActivityArtworkHost,
  }));
  app.use(createUploadRouter({
    uploadDir: UPLOAD_DIR,
    audioExtensions: AUDIO_UPLOAD_EXTENSIONS,
    hasValidUploadSignature,
    isSafeId,
    isPathInside,
    getAudioContentType,
  }));

  runAudioUploadCleanup(client).catch((error) => {
    console.warn('Audio upload cleanup failed:', error.message);
  });
  const uploadCleanupTimer = setInterval(() => {
    runAudioUploadCleanup(client).catch((error) => {
      console.warn('Audio upload cleanup failed:', error.message);
    });
  }, 60 * 60 * 1000);
  uploadCleanupTimer.unref?.();

  async function requireAuth(req, res, next) {
    const auth = await resolveRequestAuth(req);
    if (auth.error) return res.status(401).json({ error: auth.error });
    if (auth.activityUser) req.activityUser = auth.activityUser;
    next();
  }

  async function loadGuildAccess(req, res) {
    const guildId = req.params.guildId;
    if (!guildId) {
      res.status(400).json({ error: 'Missing guild ID' });
      return null;
    }

    if (!isGuildAllowed(client.guildAccess, guildId)) {
      res.status(403).json({
        error: buildAccessDeniedMessage(client.guildAccess),
        code: 'GUILD_NOT_ALLOWED',
      });
      return null;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      res.status(404).json({ error: 'Bot is not in this guild' });
      return null;
    }

    const requestUser = getRequestUser(req);
    if (!requestUser?.id) {
      res.status(401).json({ error: 'Not authenticated' });
      return null;
    }

    let member = guild.members.cache.get(requestUser.id);
    if (!member) {
      try {
        member = await guild.members.fetch(requestUser.id);
      } catch {}
    }

    const config = getConfig(guildId);
    const coreCapabilities = member ? resolveDashboardCapabilities(member, config) : null;
    const extensionCapabilities = req.activityUser ? null : await extensionHost.resolveGuildAccess({
      req,
      requestUser,
      guild,
      member,
      config,
      capabilities: coreCapabilities,
    });
    const capabilities = extensionCapabilities || coreCapabilities;
    if (!capabilities) {
      res.status(403).json({ error: 'You are not in this guild' });
      return null;
    }
    req.guild = guild;
    req.guildMember = member;
    req.guildConfig = config;
    req.dashboardCapabilities = capabilities;
    return { guild, member, config, capabilities };
  }

  async function requireGuildAccess(req, res, next) {
    const access = await loadGuildAccess(req, res);
    if (!access) return;
    if (!access.capabilities.canAccess) {
      return res.status(403).json({ error: 'Dashboard access is not enabled for your role' });
    }
    next();
  }

  async function requirePlayerAccess(req, res, next) {
    const access = await loadGuildAccess(req, res);
    if (!access) return;
    if (req.activityUser) {
      const player = client.lavalink?.players?.get(req.params.guildId);
      req.dashboardCapabilities = resolveActivityCapabilities(access.member, access.config, {
        memberVoiceChannelId: access.member?.voice?.channelId ?? null,
        botVoiceChannelId: access.guild?.members?.me?.voice?.channelId ?? player?.voiceChannelId ?? null,
        djListening: isDJListening(access.guild?.members?.me?.voice?.channel, access.config),
      });
      return next();
    }
    if (!access.capabilities.canAccess) {
      return res.status(403).json({ error: 'Dashboard access is not enabled for your role' });
    }
    next();
  }

  async function requireGuildDJ(req, res, next) {
    const access = await loadGuildAccess(req, res);
    if (!access) return;
    if (!access.capabilities.canUpload) {
      return res.status(403).json({ error: 'DJ role or Manage Guild permission required' });
    }
    next();
  }

  async function requireGuildAdmin(req, res, next) {
    const access = await loadGuildAccess(req, res);
    if (!access) return;
    if (!access.capabilities.canManageConfig) {
      return res.status(403).json({ error: 'Manage Guild permission required' });
    }
    next();
  }

  function requireTrustedOrigin(req, res, next) {
    if (req.activityUser) return next();

    const origin = req.get('origin');
    const referer = req.get('referer');
    const requestOrigin = normalizeOrigin(origin) || normalizeOrigin(referer);

    if (!requestOrigin || !trustedOrigins.has(requestOrigin)) {
      return res.status(403).json({ error: 'Invalid request origin' });
    }

    next();
  }

  function requireDashboardActionRateLimit(req, res, next) {
    const userId = getRequestUser(req)?.id;
    const guildId = req.params.guildId;
    if (!userId || !guildId) return next();

    const now = Date.now();
    const action = req.params.action || '';
    const scope = action === 'search' ? 'search' : action === 'join' ? 'join' : 'action';
    const intervalMs = scope === 'search'
      ? DASHBOARD_SEARCH_INTERVAL_MS
      : scope === 'join'
        ? DASHBOARD_JOIN_INTERVAL_MS
        : DASHBOARD_ACTION_INTERVAL_MS;
    const key = `${userId}:${guildId}:${scope}`;
    const last = dashboardActionTimestamps.get(key) || 0;
    const diff = now - last;

    if (diff < intervalMs) {
      const retryAfterMs = intervalMs - diff;
      res.set('Retry-After', (retryAfterMs / 1000).toFixed(2));
      return res.status(429).json({ error: 'Too many dashboard actions. Slow down a little.' });
    }

    dashboardActionTimestamps.set(key, now);

    if (dashboardActionTimestamps.size > 2000) {
      const cutoff = now - 5 * 60 * 1000;
      for (const [entryKey, ts] of dashboardActionTimestamps.entries()) {
        if (ts < cutoff) dashboardActionTimestamps.delete(entryKey);
      }
    }

    next();
  }

  // ---- Auth ----

  extensionHost.attach(app, {
    client,
    requireAuth,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    isGuildAllowed,
    getConfig,
    setConfig,
    getRequestUser,
    clearAutoplayState,
    clearVoiceTrackStatus,
    savePlayerState,
    broadcastPlayerUpdate,
  });

  app.use(createAuthRouter({
    discordApi: DISCORD_API,
    scopes: SCOPES,
    requireAuth,
    requireTrustedOrigin,
    refreshAccessToken,
  }));

  app.use(createGuildConfigRouter({
    client,
    discordApi: DISCORD_API,
    requireAuth,
    requirePlayerAccess,
    requireGuildAdmin,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    refreshAccessToken,
    getRequestUser,
    isGuildAllowed,
    resolveDashboardCapabilities,
    getConfig,
    setConfig,
    deleteConfig,
    isUsableTextChannel,
    resolvePlayerTextChannelId,
    clearVoiceTrackStatus,
    setVoiceTrackStatus,
    savePlayerState,
    broadcastPlayerUpdate,
    playerTextChannelDisabled: PLAYER_TEXT_CHANNEL_DISABLED,
    // Liked seeds come from the people listening right now.
    rebuildProfileFromHistory: (guildId) => rebuildProfileFromHistory(
      guildId,
      getListenerIds(client.lavalink?.players?.get(guildId), client),
    ),
    scheduleAutoplayPrefetch,
    setAutoplay,
    getLastfmStatus: () => getLastfmClient().getStatus(),
  }));

  app.use(createPlayerRouter({
    client,
    requireAuth,
    requirePlayerAccess,
    requireGuildAccess,
    requireGuildDJ,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    buildPlayerStatusSnapshot,
    parseQueuePage,
    writeSseEvent,
    buildQueueSnapshot,
    getPlayerNotice,
    playerEventSubscribers,
    filterPresetChoices: FILTER_PRESET_CHOICES,
    acquireGuildMutex,
    resolvePlayerTextChannelId,
    getConfig,
    sanitizeUploadName,
    decodeUploadHeader,
    isAllowedAudioUpload,
    uploadDir: UPLOAD_DIR,
    uploadMaxBytes: AUDIO_UPLOAD_MAX_BYTES,
    activeUploadTempPaths,
    streamUploadToFile,
    isPathInside,
    acquireUploadQuotaMutex,
    cleanupExpiredAudioUploads,
    fileExists,
    safeDeleteFile,
    touchFile,
    makeRoomForAudioUpload,
    renameFileWithRetry,
    createSignedUploadUrl,
    getUploadPlaybackBaseUrl,
    getDashboardRequester,
    getUsableNode,
    isUnknownTrackAuthor,
    addManualTrackToQueue,
    audioUploadTtlMs: AUDIO_UPLOAD_TTL_MS,
    audioUploadQuotaBytes: AUDIO_UPLOAD_QUOTA_BYTES,
    savePlayerState,
    getGuildHistory,
    findLyrics,
    trackToLyricsQuery,
    playerSearchCache,
    prunePlayerSearchCache,
    playerPlaylistMaxTracks: PLAYER_PLAYLIST_MAX_TRACKS,
    playerPlaylistCacheTtlMs: PLAYER_PLAYLIST_CACHE_TTL_MS,
    playerSearchCacheTtlMs: PLAYER_SEARCH_CACHE_TTL_MS,
    applyPreferredSource,
    classifyPlaybackError,
    describeSearchFailure,
    extractArtwork,
    normalizeSourceName,
    getTrackCapabilityMetadata,
    waitForPlayerVoice,
    activityVoiceReconnectDelayMs: ACTIVITY_VOICE_RECONNECT_DELAY_MS,
    hydratePlayer,
    addManualSeed,
    clearAutoplayPrefetch,
    addRequestedTrackToQueue,
    clearAutoplayState,
    markPlayerStopping,
    clearVoiceTrackStatus,
    recordAutoplaySkip,
    clearVoteSkip,
    handleAutoplay,
    handleSkipRequest,
    getRequestUser,
    setAutoplay,
    likeTrack,
    dislikeTrack,
    undislikeTrack,
    rerollNext,
    isTrackSeekable,
    seekTrack,
    isUnseekableTrackError,
    audioUploadDirectory: UPLOAD_DIR,
    broadcastPlayerUpdate,
    library,
  }));

  app.use(createLibraryRouter({
    client,
    library,
    requireAuth,
    requirePlayerAccess,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    getRequestUser,
    getDashboardRequester,
    getUsableNode,
  }));

  app.use(createGuildStatusRouter({
    client,
    requireAuth,
    requireGuildAccess,
    getConfig,
    getGuildInsights,
    isUsableTextChannel,
  }));

  app.use(createEconomyRouter({
    client,
    requireAuth,
    requireGuildAccess,
    requireGuildAdmin,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    getGuildMembersSnapshot,
    getBalance,
    addBalance,
    removeBalance,
    getLeaderboard,
  }));

  app.use(createControlRouter({
    client,
    requireAuth,
    requireGuildAdmin,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    getConfig,
    getGuildMembersSnapshot,
    resolvePlayerTextChannelId,
    clearAutoplayState,
  }));

  app.use(createPublicRouter({ client }));

  // ---- Error Handler ----

  app.use((err, _req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Audio upload is too large' });
    }
    console.error('API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function getGuildMembersSnapshot(guild) {
  if (!guild) return new Map();
  try {
    return await guild.members.fetch();
  } catch {
    return guild.members.cache;
  }
}

async function addManualTrackToQueue(player, track) {
  await queueRequestedTracks(player, track);
}

async function addRequestedTrackToQueue(player, track, playImmediately) {
  if (playImmediately && player.queue.current) {
    player.queue.tracks.unshift(track);
    return;
  }
  await addManualTrackToQueue(player, track);
}

module.exports = {
  createApiServer,
  broadcastPlayerUpdate,
  __testing: { resolveRequestAuth, resolveActivityUser, cleanupExpiredAudioUploads, makeRoomForAudioUpload },
};
