const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { getConfig, setConfig, deleteConfig, DEFAULT_CONFIG } = require('./state/guildConfig');
const { getGuildInsights, getGuildHistory } = require('./state/analyticsStore');
const { getBalance, addBalance, removeBalance, getLeaderboard } = require('./games/economy');
const {
  setAutoplay,
  addManualSeed,
  recordAutoplaySkip,
  clearAutoplayState,
  clearAutoplayPrefetch,
  handleAutoplay,
} = require('./music/autoplay');
const { applyPreferredSource } = require('./music/searchUtils');
const { classifyPlaybackError, describeSearchFailure } = require('./music/playbackErrors');
const { clearVoiceTrackStatus, setVoiceTrackStatus } = require('./music/voiceStatus');
const { createFileSessionStore } = require('./state/sessionStore');
const { createHealthRouter } = require('./routes/health');
const { createActivityRouter } = require('./routes/activity');
const { createUploadRouter } = require('./routes/uploads');
const { createAuthRouter } = require('./routes/auth');
const { hydratePlayer, getStoredLocalUploadPaths, savePlayerState } = require('./state/queueStore');
const { createGuildConfigRouter } = require('./routes/guildConfig');
const { createPlayerRouter } = require('./routes/player');
const { resolveActivityCapabilities, resolveDashboardCapabilities } = require('./dashboard/access');
const { findLyrics, trackToLyricsQuery } = require('./music/lyrics');
const { handleSkipRequest, clearVoteSkip, getVoteSkipSnapshot } = require('./music/skipManager');
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

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = ['identify', 'guilds'].join(' ');
const activityAuthCache = new Map();
const ACTIVITY_ARTWORK_MAX_BYTES = 6 * 1024 * 1024;
const ACTIVITY_TOKEN_RATE_LIMIT = createFixedWindowRateLimiter({ windowMs: 60_000, max: 10 });
const ACTIVITY_ARTWORK_RATE_LIMIT = createFixedWindowRateLimiter({ windowMs: 60_000, max: 120 });
const ACTIVITY_ARTWORK_HOSTS = [
  'i.ytimg.com',
  'img.youtube.com',
  'yt3.ggpht.com',
  'i.scdn.co',
  'scdn.co',
  'sndcdn.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
];

const FILTER_PRESET_CHOICES = [
  { value: 'bassboost', label: 'Bassboost', description: 'Deep, punchy bass boost.' },
  { value: 'nightcore', label: 'Nightcore', description: 'Faster tempo (1.25x) + higher pitch.' },
  { value: 'vaporwave', label: 'Vaporwave', description: 'Slower tempo (0.85x) + lower pitch.' },
  { value: 'soft', label: 'Soft', description: 'Warm EQ with enhanced mids for vocals.' },
  { value: 'karaoke', label: 'Karaoke', description: 'Reduces center vocals (mono channel).' },
  { value: '8d', label: '8D Audio', description: 'Rotating stereo panning effect.' },
  { value: 'vibrato', label: 'Vibrato', description: 'Pitch modulation (retro/synth vibe).' },
  { value: 'tremolo', label: 'Tremolo', description: 'Volume modulation (pulsating effect).' },
  { value: 'radio', label: 'Radio', description: 'Lo-fi radio/telephone effect.' },
];

const BASSBOOST_EQ = [
  { band: 0, gain: 0.15 },
  { band: 1, gain: 0.20 },
  { band: 2, gain: 0.18 },
  { band: 3, gain: 0.12 },
  { band: 4, gain: 0.06 },
  { band: 5, gain: 0.0 },
  { band: 6, gain: -0.03 },
  { band: 7, gain: -0.03 },
  { band: 8, gain: 0.0 },
  { band: 9, gain: 0.0 },
  { band: 10, gain: 0.03 },
  { band: 11, gain: 0.03 },
  { band: 12, gain: 0.0 },
  { band: 13, gain: 0.0 },
  { band: 14, gain: 0.0 },
];

const RADIO_EQ = [
  { band: 0, gain: -0.25 },
  { band: 1, gain: -0.20 },
  { band: 2, gain: -0.15 },
  { band: 3, gain: -0.10 },
  { band: 4, gain: 0.0 },
  { band: 5, gain: 0.10 },
  { band: 6, gain: 0.15 },
  { band: 7, gain: 0.20 },
  { band: 8, gain: 0.15 },
  { band: 9, gain: 0.10 },
  { band: 10, gain: 0.0 },
  { band: 11, gain: -0.10 },
  { band: 12, gain: -0.15 },
  { band: 13, gain: -0.20 },
  { band: 14, gain: -0.25 },
];

const FILTER_PRESETS = {
  bassboost: async (manager) => manager.setEQ(BASSBOOST_EQ),
  nightcore: async (manager) => manager.toggleNightcore(1.25, 1.2, 1),
  vaporwave: async (manager) => manager.toggleVaporwave(0.85, 0.8, 1),
  soft: async (manager) => manager.setEQPreset('FullSound'),
  karaoke: async (manager) => manager.toggleKaraoke(),
  '8d': async (manager) => manager.toggleRotation(0.15),
  vibrato: async (manager) => manager.toggleVibrato(8, 1),
  tremolo: async (manager) => manager.toggleTremolo(4, 0.6),
  radio: async (manager) => {
    await manager.setEQ(RADIO_EQ);
    await manager.toggleLowPass(15);
  },
};

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
const AUDIO_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
const AUDIO_UPLOAD_QUOTA_DEFAULT_MB = 1024;
const AUDIO_UPLOAD_QUOTA_MIN_MB = 256;
const AUDIO_UPLOAD_QUOTA_MAX_MB = 10 * 1024;
const configuredUploadQuotaMb = Number.parseInt(process.env.UPLOAD_STORAGE_LIMIT_MB || '', 10);
const AUDIO_UPLOAD_QUOTA_BYTES = Math.max(
  AUDIO_UPLOAD_QUOTA_MIN_MB,
  Math.min(
    AUDIO_UPLOAD_QUOTA_MAX_MB,
    Number.isFinite(configuredUploadQuotaMb) ? configuredUploadQuotaMb : AUDIO_UPLOAD_QUOTA_DEFAULT_MB,
  ),
) * 1024 * 1024;
const AUDIO_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const AUDIO_UPLOAD_TEMP_TTL_MS = 60 * 60 * 1000;
const AUDIO_UPLOAD_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
const AUDIO_UPLOAD_MIME_PREFIXES = ['audio/'];
const AUDIO_UPLOAD_MIME_TYPES = new Set(['application/ogg', 'video/webm']);
const DATA_DIR = path.resolve(process.env.BREAD_DATA_DIR || path.join(process.cwd(), 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PLAYER_TEXT_CHANNEL_DISABLED = 'disabled';
const CONTROL_MESSAGE_LIMIT = 50;
const CONTROL_MESSAGE_CACHE_TTL_MS = 60_000;
const controlMessageCache = new Map();
const MEMBER_SEARCH_CACHE_TTL_MS = 30_000;
const MEMBER_SEARCH_CACHE_MAX_ENTRIES = 100;
let uploadQuotaQueue = Promise.resolve();
const activeUploadTempPaths = new Set();

async function acquireUploadQuotaMutex() {
  const previous = uploadQuotaQueue;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  uploadQuotaQueue = previous.catch(() => {}).then(() => gate);
  await previous.catch(() => {});
  return release;
}

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
const memberSearchCache = new Map();
const playerEventSubscribers = new Map();
const playerNotices = new Map();

function publishPlayerNotice(guildId, message, tone = 'info') {
  if (!guildId || !message) return;
  playerNotices.set(guildId, {
    id: crypto.randomUUID(),
    message,
    tone,
    expiresAt: Date.now() + 8000,
  });
  broadcastPlayerUpdate(guildId);
}

function getPlayerNotice(guildId) {
  const notice = playerNotices.get(guildId);
  if (!notice) return null;
  if (notice.expiresAt <= Date.now()) {
    playerNotices.delete(guildId);
    return null;
  }
  return notice;
}

function broadcastPlayerUpdate(guildId) {
  const subscribers = playerEventSubscribers.get(guildId);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    try {
      subscriber();
    } catch (error) {
      console.warn(`Failed to broadcast player update for ${guildId}:`, error.message);
    }
  }
}

function createApiServer(client) {
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
  attachControlMessageCacheListeners(client);

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
    if (!req.session?.user) {
      const activityToken = readBearerToken(req);
      if (!activityToken) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const activityUser = await resolveActivityUser(activityToken);
      if (!activityUser) {
        return res.status(401).json({ error: 'Activity authentication expired' });
      }

      req.activityUser = activityUser;
    }
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
      } catch {
        res.status(403).json({ error: 'You are not in this guild' });
        return null;
      }
    }

    const config = getConfig(guildId);
    const capabilities = resolveDashboardCapabilities(member, config);
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
    filterPresets: FILTER_PRESETS,
    isTrackSeekable,
    seekTrack,
    isUnseekableTrackError,
    audioUploadDirectory: UPLOAD_DIR,
    broadcastPlayerUpdate,
  }));

  app.get('/api/guilds/:guildId/health', requireAuth, requireGuildAccess, (req, res) => {
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);
    const player = client.lavalink?.players?.get(guildId) ?? null;
    const config = getConfig(guildId);

    const configuredChannelId = config.playerTextChannelId || null;
    const configuredChannel = configuredChannelId && guild ? guild.channels.cache.get(configuredChannelId) : null;
    const configuredChannelSendable = configuredChannel ? isUsableTextChannel(configuredChannel) : false;

    let totalNodes = 0;
    let connectedNodes = 0;
    const nodes = client.lavalink?.nodeManager?.nodes;
    if (nodes) {
      for (const node of nodes.values()) {
        totalNodes += 1;
        if (node.connected) connectedNodes += 1;
      }
    }

    res.json({
      api: {
        ok: true,
        timestamp: Date.now(),
      },
      discord: {
        ok: client.isReady(),
        wsStatusCode: client.ws?.status ?? null,
        ping: Number.isFinite(client.ws?.ping) ? Math.round(client.ws.ping) : null,
      },
      lavalink: {
        ok: connectedNodes > 0,
        connectedNodes,
        totalNodes,
      },
      player: {
        exists: Boolean(player),
        connected: Boolean(player?.voiceChannelId),
      },
      playerMessageChannel: {
        configured: Boolean(configuredChannelId),
        channelId: configuredChannelId,
        channelName: configuredChannel?.name ?? null,
        sendable: configuredChannelId ? configuredChannelSendable : null,
      },
    });
  });

  app.get('/api/guilds/:guildId/insights', requireAuth, requireGuildAccess, (req, res) => {
    const guildId = req.params.guildId;
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(25, requested)) : 5;
    const requestedRange = typeof req.query.range === 'string' ? req.query.range : 'all';
    const range = ['24h', '7d', 'all'].includes(requestedRange) ? requestedRange : 'all';

    res.json(getGuildInsights(guildId, { limit, range }));
  });


  // ---- Economy ----

  app.get('/api/guilds/:guildId/economy/leaderboard', requireAuth, requireGuildAccess, async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const requested = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, requested)) : 20;
      const members = await getGuildMembersSnapshot(guild);
      const memberIds = new Set(members.keys());

      const entries = getLeaderboard(5000)
        .filter((entry) => memberIds.has(entry.userId))
        .slice(0, limit)
        .map((entry, index) => {
          const member = members.get(entry.userId) || guild.members.cache.get(entry.userId);
          return {
            rank: index + 1,
            userId: entry.userId,
            username: member?.user?.username || 'Unknown',
            displayName: member?.displayName || member?.user?.username || 'Unknown',
            avatar: member?.displayAvatarURL?.({ size: 64 }) || null,
            balance: entry.balance || 0,
          };
        });

      res.json({ entries });
    } catch (err) {
      console.error('Economy leaderboard error:', err);
      res.status(500).json({ error: 'Failed to load leaderboard' });
    }
  });

  app.get('/api/guilds/:guildId/economy/members', requireAuth, requireGuildAdmin, async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const requested = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(300, requested)) : 100;
      const members = await getGuildMembersSnapshot(guild);

      const list = [...members.values()]
        .filter((member) => !member.user.bot)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, limit)
        .map((member) => ({
          userId: member.id,
          username: member.user.username,
          displayName: member.displayName || member.user.username,
          avatar: member.displayAvatarURL?.({ size: 64 }) || null,
          balance: getBalance(member.id),
        }));

      res.json({ members: list });
    } catch (err) {
      console.error('Economy members error:', err);
      res.status(500).json({ error: 'Failed to load members' });
    }
  });

  app.post('/api/guilds/:guildId/economy/adjust', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
      const mode = typeof req.body?.mode === 'string' ? req.body.mode : '';
      const amount = parseInt(req.body?.amount, 10);

      if (!userId) return res.status(400).json({ error: 'userId is required' });
      if (!['add', 'remove', 'set'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be add, remove or set' });
      }
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: 'amount must be a non-negative number' });
      }

      let member = guild.members.cache.get(userId);
      if (!member) {
        try {
          member = await guild.members.fetch(userId);
        } catch {
          return res.status(404).json({ error: 'User not found in this guild' });
        }
      }

      if (member.user.bot) {
        return res.status(400).json({ error: 'Cannot modify bot balances' });
      }

      let balance;
      if (mode === 'add') {
        balance = addBalance(userId, amount);
      } else if (mode === 'remove') {
        balance = removeBalance(userId, amount);
      } else {
        const current = getBalance(userId);
        balance = addBalance(userId, amount - current);
      }

      res.json({
        success: true,
        userId,
        mode,
        amount,
        balance,
      });
    } catch (err) {
      console.error('Economy adjust error:', err);
      res.status(500).json({ error: 'Failed to adjust balance' });
    }
  });

  // ---- Player Controls ----


  // ---- Remote Control ----

  app.get('/api/guilds/:guildId/channels', requireAuth, requireGuildAdmin, async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      
      const channels = guild.channels.cache.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type, 
        position: c.position,
        parentId: c.parentId
      }));
      res.json(channels);
    } catch (err) {
      console.error('Channels fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch channels' });
    }
  });

  app.get('/api/guilds/:guildId/roles', requireAuth, requireGuildAdmin, async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      
      const roles = guild.roles.cache.map(r => ({
        id: r.id,
        name: r.name,
        color: r.hexColor
      }));
      res.json(roles);
    } catch (err) {
      console.error('Roles fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch roles' });
    }

  });

  app.get('/api/guilds/:guildId/members', requireAuth, requireGuildAdmin, async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      const requested = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(25, requested)) : 8;
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (query.length < 2) {
        return res.json({ members: [] });
      }

      const cacheKey = `${guild.id}:${limit}:${query.toLowerCase()}`;
      const cached = memberSearchCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json({ members: cached.members });
      }

      let members;
      try {
        members = await guild.members.search({ query, limit, cache: true });
      } catch {
        const normalizedQuery = query.toLowerCase();
        const snapshot = await getGuildMembersSnapshot(guild);
        members = snapshot.filter((member) => {
          const displayName = member.displayName || member.user.globalName || member.user.username || '';
          const username = member.user.username || '';
          return `${displayName} ${username}`.toLowerCase().includes(normalizedQuery);
        });
      }

      const list = [...members.values()]
        .filter((member) => !member.user.bot)
        .sort((a, b) => (a.displayName || a.user.username).localeCompare(b.displayName || b.user.username))
        .slice(0, limit)
        .map((member) => ({
          id: member.id,
          username: member.user.username,
          displayName: member.displayName || member.user.globalName || member.user.username,
          avatar: member.displayAvatarURL({ size: 64 }) || null,
        }));

      memberSearchCache.set(cacheKey, {
        members: list,
        expiresAt: Date.now() + MEMBER_SEARCH_CACHE_TTL_MS,
      });
      if (memberSearchCache.size > MEMBER_SEARCH_CACHE_MAX_ENTRIES) {
        const oldestKey = memberSearchCache.keys().next().value;
        if (oldestKey) memberSearchCache.delete(oldestKey);
      }

      res.json({ members: list });
    } catch (err) {
      console.error('Members fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch members' });
    }
  });

  app.get('/api/guilds/:guildId/control/messages', requireAuth, requireGuildAdmin, async (req, res) => {
    try {
      const channelId = req.query.channelId;
      if (!channelId) return res.status(400).json({ error: 'Missing channelId' });
      
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return res.status(404).json({ error: 'Channel not found' });
      
      const messages = await getCachedControlMessages(channel);
      res.json(messages);
    } catch (err) {
      console.error('Messages fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  app.post('/api/guilds/:guildId/control/say', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    try {
      const { channelId, message, attachmentBase64, attachmentName, allowedMentions } = req.body;
      if (!channelId || (!message && !attachmentBase64)) return res.status(400).json({ error: 'Missing channelId or content' });
      
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });
      if (!channel.isTextBased()) return res.status(400).json({ error: 'Not a text channel' });
      
      const payload = {
        content: message || undefined,
        allowedMentions: normalizeAllowedMentions(allowedMentions),
      };
      if (attachmentBase64) {
        let base64Data = attachmentBase64;
        if (base64Data.includes(',')) base64Data = base64Data.split(',')[1];
        payload.files = [{
          attachment: Buffer.from(base64Data, 'base64'),
          name: attachmentName || 'upload.png'
        }];
      }
      
      await channel.send(payload);
      markControlMessagesStale(guild.id, channel.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Control say error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/guilds/:guildId/control/action', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    try {
      const { type, channelId } = req.body;
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      const guildConfig = getConfig(guild.id);

      if (type === 'summon') {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) return res.status(400).json({ error: 'Invalid voice channel' });

        const preferredTextChannelId = resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, null);
        
        let player = client.lavalink.players.get(guild.id);
        if (!player) {
          player = client.lavalink.createPlayer({
            guildId: guild.id,
            voiceChannelId: channel.id,
            textChannelId: preferredTextChannelId,
            selfDeaf: true
          });
        }

        if (preferredTextChannelId && player.textChannelId !== preferredTextChannelId) {
          player.textChannelId = preferredTextChannelId;
        }
        
        player.voiceChannelId = channel.id;
        await player.connect();
        return res.json({ success: true });

      } else if (type === 'leave') {
        const player = client.lavalink.players.get(guild.id);
        if (player) {
           clearAutoplayState(guild.id);
           await player.destroy('Remote leave', true);
        } else {
           if (guild.members.me?.voice?.disconnect) {
             guild.members.me.voice.disconnect();
           }
        }
        return res.json({ success: true });
      }
      res.status(400).json({ error: 'Unknown action type' });
    } catch (err) {
      console.error('Control action error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Stats ----

  app.get('/api/stats', (_req, res) => {
    let totalUsers = 0;
    let activePlayers = 0;

    for (const [, guild] of client.guilds.cache) {
      totalUsers += guild.memberCount || 0;
    }

    if (client.lavalink?.players) {
      for (const [, player] of client.lavalink.players) {
        if (player.playing || player.paused) activePlayers++;
      }
    }

    const uptimeMs = client.uptime || 0;
    const days = Math.floor(uptimeMs / 86400000);
    const hours = Math.floor((uptimeMs % 86400000) / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);
    let uptime = '';
    if (days > 0) uptime += `${days}d `;
    if (hours > 0) uptime += `${hours}h `;
    uptime += `${minutes}m`;

    res.json({
      guilds: client.guilds.cache.size,
      users: totalUsers,
      players: activePlayers,
      uptime,
    });
  });

  app.get('/api/bot-info', (_req, res) => {
    const u = client.user;
    res.json({
      id: u.id,
      name: u.username,
      displayName: u.globalName || u.username,
      avatar: u.avatarURL({ size: 256 }),
      clientId: process.env.DISCORD_CLIENT_ID,
    });
  });

  // ---- Invite ----

  app.get('/api/invite', (_req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const permissions = [
      1n << 10n, // View channels
      1n << 11n, // Send messages
      1n << 14n, // Embed links
      1n << 15n, // Attach files
      1n << 16n, // Read message history
      1n << 17n, // Mention everyone
      1n << 18n, // Use external emojis
      1n << 20n, // Connect
      1n << 21n, // Speak
      1n << 25n, // Use voice activity
      1n << 48n, // Set voice channel status
    ].reduce((combined, permission) => combined | permission, 0n);
    const params = new URLSearchParams({
      client_id: clientId,
      permissions: String(permissions),
      scope: 'bot applications.commands',
      integration_type: '0',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

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

function attachControlMessageCacheListeners(client) {
  if (client.__breadControlMessageCacheListenersAttached) return;
  client.__breadControlMessageCacheListenersAttached = true;

  client.on('messageCreate', (message) => {
    if (message.guildId && message.channelId) markControlMessagesStale(message.guildId, message.channelId);
  });

  client.on('messageUpdate', (_oldMessage, message) => {
    if (message.guildId && message.channelId) markControlMessagesStale(message.guildId, message.channelId);
  });

  client.on('messageDelete', (message) => {
    if (message.guildId && message.channelId) removeCachedControlMessage(message.guildId, message.channelId, message.id);
  });

  client.on('messageDeleteBulk', (messages) => {
    for (const message of messages.values()) {
      if (message.guildId && message.channelId) removeCachedControlMessage(message.guildId, message.channelId, message.id);
    }
  });
}

function controlMessageCacheKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function markControlMessagesStale(guildId, channelId) {
  const key = controlMessageCacheKey(guildId, channelId);
  const cached = controlMessageCache.get(key);
  if (cached) cached.stale = true;
}

function removeCachedControlMessage(guildId, channelId, messageId) {
  const key = controlMessageCacheKey(guildId, channelId);
  const cached = controlMessageCache.get(key);
  if (!cached) return;
  cached.messages = cached.messages.filter((message) => message.id !== messageId);
}

async function getCachedControlMessages(channel) {
  const key = controlMessageCacheKey(channel.guildId, channel.id);
  const cached = controlMessageCache.get(key);
  const now = Date.now();

  if (cached && !cached.stale && now - cached.fetchedAt < CONTROL_MESSAGE_CACHE_TTL_MS) {
    return cached.messages;
  }

  const messages = await channel.messages.fetch({ limit: CONTROL_MESSAGE_LIMIT });
  const formatted = messages.map(formatControlMessage);
  controlMessageCache.set(key, {
    fetchedAt: now,
    stale: false,
    messages: formatted,
  });
  pruneControlMessageCache();
  return formatted;
}

function formatControlMessage(message) {
  return {
    id: message.id,
    content: message.content,
    author: {
      username: message.author.username,
      avatar: message.author.displayAvatarURL() || null,
      bot: message.author.bot,
    },
    timestamp: message.createdTimestamp,
    attachments: message.attachments.map((attachment) => ({
      url: attachment.url,
      name: attachment.name || 'attachment',
      contentType: attachment.contentType || null,
      width: attachment.width || null,
      height: attachment.height || null,
    })),
    embeds: message.embeds.map((embed) => ({
      title: embed.title || null,
      description: embed.description || null,
      url: embed.url || null,
      image: embed.image?.url || embed.thumbnail?.url || null,
      provider: embed.provider?.name || null,
    })),
    mentions: {
      users: message.mentions.users.map((user) => ({
        id: user.id,
        label: user.globalName || user.username,
      })),
      roles: message.mentions.roles.map((role) => ({
        id: role.id,
        label: role.name,
      })),
      channels: message.mentions.channels.map((mentionedChannel) => ({
        id: mentionedChannel.id,
        label: mentionedChannel.name,
      })),
    },
  };
}

function pruneControlMessageCache() {
  if (controlMessageCache.size <= 200) return;
  const cutoff = Date.now() - 10 * CONTROL_MESSAGE_CACHE_TTL_MS;
  for (const [key, cached] of controlMessageCache.entries()) {
    if (cached.fetchedAt < cutoff) controlMessageCache.delete(key);
  }
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
  const autoplayIndex = player.queue.tracks.findIndex((entry) => entry.isAutoplay);
  if (autoplayIndex !== -1) {
    player.queue.tracks.splice(autoplayIndex, 0, track);
    return;
  }

  await player.queue.add(track);
}

async function addRequestedTrackToQueue(player, track, playImmediately) {
  if (playImmediately && player.queue.current) {
    player.queue.tracks.unshift(track);
    return;
  }
  await addManualTrackToQueue(player, track);
}

function sanitizeUploadName(fileName) {
  const normalized = path.basename(String(fileName || 'upload.mp3'))
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  const fallback = 'upload.mp3';
  if (!normalized || normalized === '.' || normalized === '..') return fallback;

  const ext = path.extname(normalized);
  const base = path.basename(normalized, ext).slice(0, Math.max(1, 120 - ext.length));
  return `${base || 'upload'}${ext}`;
}

function decodeUploadHeader(value) {
  const encoded = String(value || '');
  if (!encoded) return '';
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function isAllowedAudioUpload(ext, mimeType) {
  if (!AUDIO_UPLOAD_EXTENSIONS.has(ext)) return false;
  if (!mimeType || mimeType === 'application/octet-stream') return true;
  if (AUDIO_UPLOAD_MIME_TYPES.has(mimeType)) return true;
  return AUDIO_UPLOAD_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function isSafeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
}

function isPathInside(filePath, parentPath) {
  const relative = path.relative(parentPath, filePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function getAudioContentType(ext) {
  switch (ext) {
    case '.mp3':
      return 'audio/mpeg';
    case '.flac':
      return 'audio/flac';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
    case '.opus':
      return 'audio/ogg';
    case '.m4a':
    case '.aac':
      return 'audio/aac';
    case '.webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

function normalizeAllowedMentions(input) {
  const parse = [];
  if (input?.users) parse.push('users');
  if (input?.roles) parse.push('roles');
  if (input?.everyone) parse.push('everyone');
  return { parse };
}

function streamUploadToFile(request, filePath, maxBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      const error = new Error(`Upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
      error.code = 'LIMIT_FILE_SIZE';
      request.resume();
      reject(error);
      return;
    }

    const hash = crypto.createHash('sha256');
    let size = 0;
    let settled = false;
    const transform = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) {
          const error = new Error(`Upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
          error.code = 'LIMIT_FILE_SIZE';
          callback(error);
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const output = fs.createWriteStream(filePath, { flags: 'wx' });

    const cleanup = async () => {
      request.unpipe(transform);
      request.resume();
      transform.destroy();
      output.destroy();
      await safeDeleteFile(filePath);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup().finally(() => reject(error));
    };

    request.once('aborted', () => {
      const error = new Error('Upload request was aborted');
      error.code = 'ECONNABORTED';
      fail(error);
    });
    request.once('error', fail);
    transform.once('error', fail);
    output.once('error', fail);
    output.once('finish', () => {
      if (settled) return;
      settled = true;
      resolve({ path: filePath, size, uploadId: hash.digest('hex') });
    });

    request.pipe(transform).pipe(output);
  });
}

async function renameFileWithRetry(source, destination, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error) {
      const retryable = ['EPERM', 'EACCES', 'EBUSY', 'ENOENT'].includes(error.code);
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function safeDeleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch {}
  return false;
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function touchFile(filePath) {
  const now = new Date();
  try {
    await fs.promises.utimes(filePath, now, now);
  } catch {}
}

function getProtectedAudioUploadPaths(client) {
  const protectedPaths = new Set();
  const players = client?.lavalink?.players;
  if (players) {
    for (const player of players.values()) {
      const tracks = [player.queue?.current, ...(player.queue?.tracks || [])].filter(Boolean);
      for (const track of tracks) {
        const filePath = track.localUpload?.filePath;
        if (!filePath) continue;
        const resolvedPath = path.resolve(filePath);
        if (isPathInside(resolvedPath, UPLOAD_DIR)) protectedPaths.add(resolvedPath);
      }
    }
  }

  for (const filePath of getStoredLocalUploadPaths()) {
    const resolvedPath = path.resolve(filePath);
    if (isPathInside(resolvedPath, UPLOAD_DIR)) protectedPaths.add(resolvedPath);
  }
  return protectedPaths;
}

async function listAudioUploadFiles() {
  let guildDirs = [];
  try {
    guildDirs = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const guildDir of guildDirs) {
    if (!guildDir.isDirectory() || !isSafeId(guildDir.name)) continue;

    const guildPath = path.join(UPLOAD_DIR, guildDir.name);
    const entries = await fs.promises.readdir(guildPath, { withFileTypes: true }).catch(() => []);
    for (const file of entries) {
      if (!file.isFile()) continue;

      const filePath = path.join(guildPath, file.name);
      const stats = await fs.promises.stat(filePath).catch(() => null);
      if (stats?.isFile()) {
        const incoming = file.name.startsWith('.incoming-');
        files.push({
          path: filePath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          incoming,
          activeIncoming: incoming && activeUploadTempPaths.has(path.resolve(filePath)),
        });
      }
    }
  }
  return files;
}

async function cleanupExpiredAudioUploads(client) {
  const files = await listAudioUploadFiles();
  const protectedPaths = getProtectedAudioUploadPaths(client);
  const now = Date.now();
  for (const file of files) {
    if (file.activeIncoming) continue;
    const cutoff = now - (file.incoming ? AUDIO_UPLOAD_TEMP_TTL_MS : AUDIO_UPLOAD_TTL_MS);
    if (file.mtimeMs < cutoff && !protectedPaths.has(path.resolve(file.path))) {
      await safeDeleteFile(file.path);
    }
  }
}

async function runAudioUploadCleanup(client) {
  const releaseQuota = await acquireUploadQuotaMutex();
  try {
    await cleanupExpiredAudioUploads(client);
  } finally {
    releaseQuota();
  }
}

async function makeRoomForAudioUpload(requiredBytes, client, incomingPath = null) {
  const files = await listAudioUploadFiles();
  const protectedPaths = getProtectedAudioUploadPaths(client);
  const excludedIncomingPath = incomingPath ? path.resolve(incomingPath) : null;
  let totalBytes = files.reduce(
    (total, file) => total + (path.resolve(file.path) === excludedIncomingPath ? 0 : file.size),
    0,
  );
  if (totalBytes + requiredBytes <= AUDIO_UPLOAD_QUOTA_BYTES) return true;

  const candidates = files
    .filter((file) => !file.incoming && !protectedPaths.has(path.resolve(file.path)))
    .sort((left, right) => left.mtimeMs - right.mtimeMs);

  for (const file of candidates) {
    if (totalBytes + requiredBytes <= AUDIO_UPLOAD_QUOTA_BYTES) break;
    if (await safeDeleteFile(file.path)) {
      totalBytes -= file.size;
    }
  }

  return totalBytes + requiredBytes <= AUDIO_UPLOAD_QUOTA_BYTES;
}

function resolvePlayerTextChannelId(guild, preferredChannelId = null, fallbackChannelId = null) {
  if (!guild) return null;

  if (preferredChannelId === PLAYER_TEXT_CHANNEL_DISABLED) {
    return null;
  }

  if (preferredChannelId) {
    const preferred = guild.channels.cache.get(preferredChannelId);
    if (isUsableTextChannel(preferred)) {
      return preferred.id;
    }
  }

  if (fallbackChannelId) {
    const fallback = guild.channels.cache.get(fallbackChannelId);
    if (isUsableTextChannel(fallback)) {
      return fallback.id;
    }
  }

  return null;
}

function isUsableTextChannel(channel) {
  if (!channel || !channel.isTextBased()) return false;
  if (typeof channel.isSendable === 'function') return channel.isSendable();
  return channel.viewable !== false;
}

function buildPlayerStatusSnapshot(client, guildId) {
  const player = client.lavalink?.players?.get(guildId);
  const guild = client.guilds.cache.get(guildId);
  const config = getConfig(guildId);

  if (!player) {
    return {
      connected: false,
      playing: false,
      paused: false,
      voiceChannelId: null,
      voiceChannelName: null,
      currentTrack: null,
      queueLength: 0,
      repeatMode: 'off',
      volume: 100,
      filters: null,
      autoplay: config.autoplay ?? false,
      autoplayMode: config.autoplayMode ?? 'ai_assisted',
      voteSkip: null,
      sessionHistory: [],
    };
  }

  let voiceChannelName = null;
  if (player.voiceChannelId && guild) {
    const channel = guild.channels.cache.get(player.voiceChannelId);
    voiceChannelName = channel ? channel.name : null;
  }

  let currentTrack = null;
  if (player.queue.current) {
    const info = player.queue.current.info || {};
    const isLocalUpload = isLocalUploadInfo(info, player.queue.current);
    currentTrack = {
      title: info.title || 'Unknown',
      author: isLocalUpload && isUnknownTrackAuthor(info.author) ? 'Local upload' : info.author || 'Unknown',
      uri: info.uri || '',
      duration: info.duration || 0,
      position: player.position || 0,
      seekable: isTrackSeekable(player.queue.current),
      artwork: extractArtwork(info),
      requester: formatRequester(player.queue.current.requester),
    };
  }

  const sessionHistory = (player.queue.previous || [])
    .slice(-2)
    .reverse()
    .map((track) => {
      const info = track?.info || {};
      return {
        title: info.title || 'Unknown',
        author: info.author || 'Unknown',
        uri: info.uri || '',
        duration: info.duration || 0,
        artwork: extractArtwork(info),
      };
    });

  return {
    connected: true,
    playing: player.playing,
    paused: player.paused,
    voiceChannelId: player.voiceChannelId,
    voiceChannelName,
    currentTrack,
    queueLength: player.queue.tracks.length,
    repeatMode: player.repeatMode || 'off',
    volume: player.volume ?? 100,
    filters: player.filterManager?.activePreset || null,
    autoplay: config.autoplay ?? false,
    autoplayMode: config.autoplayMode ?? 'ai_assisted',
    voteSkip: getVoteSkipSnapshot(player, config, guild),
    sessionHistory,
  };
}

function buildQueueSnapshot(client, guildId, page = 0) {
  const player = client.lavalink?.players?.get(guildId);
  if (!player) {
    return { current: null, tracks: [], total: 0, page, totalPages: 0, revision: 'empty' };
  }

  const perPage = 20;
  const allTracks = player.queue.tracks;
  const start = page * perPage;
  const revision = buildQueueRevision(allTracks);

  const current = player.queue.current
    ? formatQueueTrack(player.queue.current)
    : null;

  const tracks = allTracks
    .slice(start, start + perPage)
    .map((track) => formatQueueTrack(track));

  return {
    current,
    tracks,
    total: allTracks.length,
    page,
    totalPages: Math.ceil(allTracks.length / perPage),
    revision,
  };
}

function buildQueueRevision(tracks) {
  const hash = crypto.createHash('sha1');
  hash.update(String(tracks.length));
  for (const track of tracks) {
    const info = track?.info || {};
    hash.update('\0');
    hash.update(String(info.identifier || info.uri || track?.localUpload?.uploadId || ''));
    hash.update('\0');
    hash.update(String(info.title || ''));
    hash.update('\0');
    hash.update(String(info.author || ''));
    hash.update('\0');
    hash.update(String(track?.requester?.id || track?.requester?.username || ''));
    hash.update('\0');
    hash.update(track?.isAutoplay ? '1' : '0');
  }
  return hash.digest('base64url').slice(0, 16);
}

function formatQueueTrack(track) {
  const info = track?.info || {};
  const isLocalUpload = isLocalUploadInfo(info, track);
  const formatted = {
    title: info.title || track?.localUpload?.fileName || 'Unknown',
    author: isLocalUpload && isUnknownTrackAuthor(info.author) ? 'Local upload' : info.author || 'Unknown',
    uri: info.uri || '',
    duration: info.duration || 0,
    requester: formatRequester(track?.requester),
    artwork: extractArtwork(info),
  };

  return formatted;
}

function formatRequester(requester) {
  return requester?.global_name || requester?.globalName || requester?.username || requester?.tag || requester?.id || 'Unknown';
}

function isLocalUploadInfo(info = {}, track = null) {
  return Boolean(
    track?.localUpload ||
      info.localUpload ||
      info.isLocalUpload ||
      info.sourceName === 'localUpload' ||
      (typeof info.uri === 'string' && info.uri.includes('/api/uploads/')),
  );
}

function isUnknownTrackAuthor(author) {
  if (typeof author !== 'string') return true;
  const normalized = author.trim().toLowerCase();
  return !normalized || normalized === 'unknown' || normalized === 'unknown artist';
}

function parseQueuePage(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function extractArtwork(info) {
  if (info.artworkUrl) return info.artworkUrl;
  if (info.uri && (info.uri.includes('youtube.com') || info.uri.includes('youtu.be')) && info.identifier) {
    return `https://i.ytimg.com/vi/${info.identifier}/mqdefault.jpg`;
  }
  return null;
}

function isAllowedActivityArtworkHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return ACTIVITY_ARTWORK_HOSTS.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}

function getDashboardRequester(req, client) {
  const user = getRequestUser(req);
  if (user?.id) {
    return {
      id: user.id,
      username: user.username || user.global_name || 'Dashboard user',
      global_name: user.global_name || null,
      avatar: user.avatar || null,
      bot: false,
    };
  }

  return client.user ?? { id: '0', username: 'Bot', bot: true };
}

function getRequestUser(req) {
  return req.activityUser || req.session?.user || null;
}

function readBearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function resolveActivityUser(accessToken) {
  const cached = activityAuthCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  if (cached) activityAuthCache.delete(accessToken);

  try {
    const response = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const profile = await response.json();
    if (!profile?.id) return null;

    const user = {
      id: profile.id,
      username: profile.username,
      discriminator: profile.discriminator,
      avatar: profile.avatar,
      global_name: profile.global_name || null,
      accessToken,
    };
    activityAuthCache.set(accessToken, {
      user,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return user;
  } catch {
    return null;
  }
}

function getUsableNode(client) {
  const nodes = client.lavalink?.nodeManager?.nodes;
  if (!nodes) return null;
  for (const node of nodes.values()) {
    if (node.connected) return node;
  }
  return nodes.values().next().value ?? null;
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildTrustedOrigins(webUrl) {
  const candidates = [
    webUrl,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  const origins = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) origins.add(normalized);
  }

  return origins;
}

module.exports = { createApiServer, broadcastPlayerUpdate };
