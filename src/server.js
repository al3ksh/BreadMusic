const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfig, setConfig, deleteConfig, DEFAULT_CONFIG } = require('./state/guildConfig');
const { getGuildInsights, getGuildHistory } = require('./state/analyticsStore');
const { getBalance, addBalance, removeBalance, getLeaderboard } = require('./games/economy');
const { setAutoplay, resetSeed, recordAutoplaySkip, clearAutoplayState } = require('./music/autoplay');
const { applyPreferredSource } = require('./music/searchUtils');
const { classifyPlaybackError, describeSearchFailure } = require('./music/playbackErrors');
const { clearVoiceTrackStatus, setVoiceTrackStatus } = require('./music/voiceStatus');
const { createFileSessionStore } = require('./state/sessionStore');
const { resolveActivityCapabilities, resolveDashboardCapabilities } = require('./dashboard/access');
const { findLyrics, trackToLyricsQuery } = require('./music/lyrics');
const { handleSkipRequest } = require('./music/skipManager');
const { buildAccessDeniedMessage, isGuildAllowed } = require('./access/guildAccess');

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = ['identify', 'guilds'].join(' ');
const activityAuthCache = new Map();
const ACTIVITY_ARTWORK_MAX_BYTES = 6 * 1024 * 1024;
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

const DASHBOARD_ACTION_INTERVAL_MS = 500;
const dashboardActionTimestamps = new Map();
const AUDIO_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
const AUDIO_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const AUDIO_UPLOAD_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.webm']);
const AUDIO_UPLOAD_MIME_PREFIXES = ['audio/'];
const AUDIO_UPLOAD_MIME_TYPES = new Set(['application/ogg', 'video/webm']);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PLAYER_TEXT_CHANNEL_DISABLED = 'disabled';
const CONTROL_MESSAGE_LIMIT = 50;
const CONTROL_MESSAGE_CACHE_TTL_MS = 60_000;
const controlMessageCache = new Map();

function createApiServer(client) {
  const app = express();
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required.');
  }
  const trustedOrigins = buildTrustedOrigins(process.env.WEB_URL);

  // Behind cloudflared/reverse proxy, trust one hop so secure cookies work correctly.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser(sessionSecret));
  app.use(
    session({
      store: createFileSessionStore(session),
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

  app.get('/api/activity/config', (_req, res) => {
    res.json({
      enabled: process.env.ACTIVITY_ENABLED !== 'false',
      clientId: process.env.DISCORD_CLIENT_ID || null,
    });
  });

  app.get('/api/activity/artwork', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    let artworkUrl;

    try {
      artworkUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid artwork URL' });
    }

    if (artworkUrl.protocol !== 'https:' || !isAllowedActivityArtworkHost(artworkUrl.hostname)) {
      return res.status(403).json({ error: 'Artwork host is not allowed' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(artworkUrl, {
        signal: controller.signal,
        redirect: 'error',
        headers: { 'User-Agent': 'Bread Discord Activity' },
      });
      const contentType = response.headers.get('content-type') || '';
      const contentLength = Number(response.headers.get('content-length') || 0);

      if (!response.ok || !contentType.startsWith('image/')) {
        return res.status(404).json({ error: 'Artwork unavailable' });
      }
      if (contentLength > ACTIVITY_ARTWORK_MAX_BYTES) {
        return res.status(413).json({ error: 'Artwork is too large' });
      }

      const payload = Buffer.from(await response.arrayBuffer());
      if (payload.length > ACTIVITY_ARTWORK_MAX_BYTES) {
        return res.status(413).json({ error: 'Artwork is too large' });
      }

      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('Content-Type', contentType);
      return res.send(payload);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Activity artwork proxy failed:', error.message);
      }
      return res.status(502).json({ error: 'Could not load artwork' });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post('/api/activity/token', async (req, res) => {
    if (process.env.ACTIVITY_ENABLED === 'false') {
      return res.status(404).json({ error: 'Activity is disabled' });
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code || code.length > 512) {
      return res.status(400).json({ error: 'Activity authorization code is required' });
    }

    try {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
        }),
      });
      const payload = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !payload.access_token) {
        return res.status(401).json({ error: 'Activity authorization failed' });
      }

      return res.json({
        access_token: payload.access_token,
        expires_in: payload.expires_in || 604800,
      });
    } catch (error) {
      console.error('Activity token exchange failed:', error.message);
      return res.status(502).json({ error: 'Could not reach Discord authorization service' });
    }
  });

  app.get('/api/uploads/:guildId/:fileId/:fileName', async (req, res) => {
    const { guildId, fileId, fileName } = req.params;
    if (!isSafeId(guildId) || !isSafeId(fileId)) {
      return res.status(400).json({ error: 'Invalid upload path' });
    }

    const ext = path.extname(fileName || '').toLowerCase();
    if (!AUDIO_UPLOAD_EXTENSIONS.has(ext)) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const filePath = path.join(UPLOAD_DIR, guildId, `${fileId}${ext}`);
    if (!isPathInside(filePath, UPLOAD_DIR)) {
      return res.status(400).json({ error: 'Invalid upload path' });
    }

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Type', getAudioContentType(ext));
      res.sendFile(filePath);
    } catch {
      res.status(404).json({ error: 'Upload not found' });
    }
  });

  cleanupExpiredAudioUploads().catch((error) => {
    console.warn('Audio upload cleanup failed:', error.message);
  });
  setInterval(() => {
    cleanupExpiredAudioUploads().catch((error) => {
      console.warn('Audio upload cleanup failed:', error.message);
    });
  }, 60 * 60 * 1000);

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
      req.dashboardCapabilities = resolveActivityCapabilities(access.member, access.config);
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
    const key = `${userId}:${guildId}`;
    const last = dashboardActionTimestamps.get(key) || 0;
    const diff = now - last;

    if (diff < DASHBOARD_ACTION_INTERVAL_MS) {
      const retryAfterMs = DASHBOARD_ACTION_INTERVAL_MS - diff;
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

  app.get('/api/auth/discord', (req, res) => {
    const oauthState = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = oauthState;

    const redirectUri = `${process.env.WEB_URL || 'http://localhost:3000'}/api/auth/callback`;
    req.session.save((err) => {
      if (err) {
        console.error('OAuth state save error:', err);
        return res.redirect('/?error=session_failed');
      }

      const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        state: oauthState,
      });
      res.redirect(`https://discord.com/oauth2/authorize?${params}`);
    });
  });

  app.get('/api/auth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    const returnedState = typeof req.query.state === 'string' ? req.query.state : '';
    const expectedState = typeof req.session.oauthState === 'string' ? req.session.oauthState : '';

    delete req.session.oauthState;
    req.session.save(() => {});

    if (!returnedState || !expectedState || returnedState !== expectedState) {
      return res.redirect('/?error=invalid_state');
    }

    if (error) {
      return res.redirect(`/?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      return res.redirect('/?error=no_code');
    }

    const redirectUri = `${process.env.WEB_URL || 'http://localhost:3000'}/api/auth/callback`;

    try {
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.json().catch(() => ({}));
        console.error('Token exchange failed:', errBody);
        return res.redirect('/?error=token_failed');
      }

      const tokens = await tokenRes.json();

      const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userRes.ok) {
        return res.redirect('/?error=user_fetch_failed');
      }

      const user = await userRes.json();
      req.session.user = {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        global_name: user.global_name,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpires: Date.now() + tokens.expires_in * 1000,
      };

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.redirect('/?error=session_failed');
        }
        res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('OAuth callback error:', err);
      res.redirect('/?error=server_error');
    }
  });

  app.post('/api/auth/logout', requireTrustedOrigin, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('bread.sid');
      res.json({ success: true });
    });
  });

  app.get('/api/auth/logout', (_req, res) => {
    res.status(405).json({ error: 'Use POST /api/auth/logout' });
  });

  app.get('/api/me', requireAuth, async (req, res) => {
    try {
      let user = req.session.user;

      if (Date.now() > (user.tokenExpires || 0)) {
        const refreshed = await refreshAccessToken(user.refreshToken);
        if (refreshed) {
          user = {
            ...user,
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token || user.refreshToken,
            tokenExpires: Date.now() + refreshed.expires_in * 1000,
          };
          req.session.user = user;
          req.session.save(() => {});
        }
      }

      res.json({
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        avatar: user.avatar,
        global_name: user.global_name,
      });
    } catch (err) {
      console.error('Get me error:', err);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  });

  // ---- Guilds ----

  app.get('/api/guilds', requireAuth, async (req, res) => {
    try {
      let accessToken = req.session.user.accessToken;

      if (Date.now() > (req.session.user.tokenExpires || 0)) {
        const refreshed = await refreshAccessToken(req.session.user.refreshToken);
        if (refreshed) {
          accessToken = refreshed.access_token;
          req.session.user.accessToken = refreshed.access_token;
          req.session.user.tokenExpires = Date.now() + refreshed.expires_in * 1000;
          req.session.save(() => {});
        }
      }

      const MANAGE_GUILD = BigInt(0x20);
      const botGuildIds = new Set(client.guilds.cache.keys());

      async function mapGuilds(discordGuilds) {
        const mapped = await Promise.all(discordGuilds.map(async (g) => {
          const guild = client.guilds.cache.get(g.id);
          const guildAllowed = isGuildAllowed(client.guildAccess, g.id);
          if (!guildAllowed) return null;

          const oauthAdmin = (BigInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD;
          let capabilities = {
            accessLevel: oauthAdmin ? 'admin' : 'member',
            dashboardAccess: 'admin',
            canAccess: oauthAdmin,
          };

          if (guild) {
            let member = guild.members.cache.get(getRequestUser(req).id);
            if (!member) member = await guild.members.fetch(getRequestUser(req).id).catch(() => null);
            if (member) capabilities = resolveDashboardCapabilities(member, getConfig(g.id));
          }

          return {
            id: g.id,
            name: g.name,
            icon: g.icon,
            permissions: g.permissions,
            member_count: g.approximate_member_count || 0,
            bot_present: botGuildIds.has(g.id),
            access_level: capabilities.accessLevel,
            dashboard_access: capabilities.dashboardAccess,
            can_access: capabilities.canAccess,
            can_invite: oauthAdmin,
          };
        }));

        return mapped
          .filter(Boolean)
          .filter((g) => (g.bot_present ? g.can_access : g.can_invite))
          .sort((a, b) => b.bot_present - a.bot_present);
      }

      const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds?with_counts=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!guildsRes.ok) {
        if (guildsRes.status === 429) {
          const body = await guildsRes.json().catch(() => ({}));
          const retryMs = Math.ceil((body.retry_after || 1) * 1000) + 500;
          await new Promise((r) => setTimeout(r, retryMs));
          const retryRes = await fetch(`${DISCORD_API}/users/@me/guilds?with_counts=true`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (retryRes.ok) {
            return res.json(await mapGuilds(await retryRes.json()));
          }
        }
        const errBody = await guildsRes.json().catch(() => ({}));
        console.error('Guilds fetch failed:', guildsRes.status, errBody);
        return res.status(502).json({ error: `Failed to fetch guilds: ${guildsRes.status}` });
      }

      const guilds = await mapGuilds(await guildsRes.json());

      res.json(guilds);
    } catch (err) {
      console.error('Guilds fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch guilds' });
    }
  });

  // ---- Guild Config ----

  app.get('/api/guilds/:guildId/access', requireAuth, requirePlayerAccess, (req, res) => {
    res.json(req.dashboardCapabilities);
  });

  app.get('/api/guilds/:guildId/config', requireAuth, requireGuildAdmin, (req, res) => {
    const config = getConfig(req.params.guildId);
    const guild = client.guilds.cache.get(req.params.guildId);

    let djRoleName = null;
    let twentyFourSevenChannelName = null;
    let playerTextChannelName = null;

    if (config.djRoleId && guild) {
      const role = guild.roles.cache.get(config.djRoleId);
      djRoleName = role ? role.name : null;
    }

    if (config.twentyFourSevenChannelId && guild) {
      const channel = guild.channels.cache.get(config.twentyFourSevenChannelId);
      twentyFourSevenChannelName = channel ? channel.name : null;
    }

    if (config.playerTextChannelId && config.playerTextChannelId !== PLAYER_TEXT_CHANNEL_DISABLED && guild) {
      const channel = guild.channels.cache.get(config.playerTextChannelId);
      playerTextChannelName = channel ? channel.name : null;
    }

    res.json({
      preferredSource: config.preferredSource,
      djRoleId: config.djRoleId,
      djRoleName,
      maxVolume: config.maxVolume,
      voteSkipPercent: config.voteSkipPercent,
      stayInChannel: config.stayInChannel,
      afkTimeout: config.afkTimeout,
      persistentQueue: config.persistentQueue,
      twentyFourSevenChannelId: config.twentyFourSevenChannelId,
      twentyFourSevenChannelName,
      playerTextChannelId: config.playerTextChannelId,
      playerTextChannelName,
      defaultVolume: config.defaultVolume,
      autoplay: config.autoplay,
      voiceChannelStatus: config.voiceChannelStatus,
      dashboardAccess: config.dashboardAccess,
    });
  });

  app.put('/api/guilds/:guildId/config', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    const updates = {};
    const body = req.body;
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);
    const previousConfig = getConfig(guildId);

    if (typeof body.djRoleId === 'string') updates.djRoleId = body.djRoleId || null;
    if (Object.prototype.hasOwnProperty.call(body, 'playerTextChannelId')) {
      const channelId = body.playerTextChannelId || null;
      if (channelId && channelId !== PLAYER_TEXT_CHANNEL_DISABLED) {
        const channel = guild?.channels?.cache?.get(channelId);
        if (!isUsableTextChannel(channel)) {
          return res.status(400).json({ error: 'Invalid player text channel' });
        }
      }
      updates.playerTextChannelId = channelId;
    }
    if (typeof body.maxVolume === 'number') updates.maxVolume = Math.max(10, Math.min(500, body.maxVolume));
    if (typeof body.voteSkipPercent === 'number') updates.voteSkipPercent = Math.min(Math.max(body.voteSkipPercent, 0.1), 1);
    if (typeof body.stayInChannel === 'boolean') updates.stayInChannel = body.stayInChannel;
    if (typeof body.twentyFourSevenChannelId === 'string') updates.twentyFourSevenChannelId = body.twentyFourSevenChannelId || null;
    if (typeof body.afkTimeout === 'number') updates.afkTimeout = Math.max(60000, body.afkTimeout);
    if (typeof body.persistentQueue === 'boolean') updates.persistentQueue = body.persistentQueue;
    if (typeof body.preferredSource === 'string') updates.preferredSource = body.preferredSource || null;
    if (typeof body.autoplay === 'boolean') updates.autoplay = body.autoplay;
    if (typeof body.voiceChannelStatus === 'boolean') updates.voiceChannelStatus = body.voiceChannelStatus;
    if (['admin', 'dj', 'members'].includes(body.dashboardAccess)) updates.dashboardAccess = body.dashboardAccess;
    if (typeof body.defaultVolume === 'number') updates.defaultVolume = Math.max(0, Math.min(100, body.defaultVolume));

    const updated = setConfig(guildId, updates);

    if (Object.prototype.hasOwnProperty.call(updates, 'playerTextChannelId')) {
      const player = client.lavalink?.players?.get(guildId);
      const preferredTextChannelId = resolvePlayerTextChannelId(guild, updated.playerTextChannelId, player?.textChannelId ?? null);
      if (player && player.textChannelId !== preferredTextChannelId) {
        player.textChannelId = preferredTextChannelId;
      }

      if (updates.playerTextChannelId !== previousConfig.playerTextChannelId) {
        await client.musicUI?.clear(guildId).catch(() => {});
        if (player && preferredTextChannelId && player.queue.current) {
          await client.musicUI?.refresh(player).catch(() => {});
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'voiceChannelStatus')) {
      const player = client.lavalink?.players?.get(guildId);
      if (!updated.voiceChannelStatus && player) {
        await clearVoiceTrackStatus(client, player);
      } else if (updated.voiceChannelStatus && player?.queue.current) {
        await setVoiceTrackStatus(client, player, player.queue.current);
      }
    }

    res.json({ success: true, config: updated });
  });

  app.post('/api/guilds/:guildId/config/reset', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    deleteConfig(req.params.guildId);
    const fresh = getConfig(req.params.guildId);
    const player = client.lavalink?.players?.get(req.params.guildId);
    if (fresh.voiceChannelStatus && player?.queue.current) {
      await setVoiceTrackStatus(client, player, player.queue.current);
    }
    res.json({ success: true, config: fresh });
  });

  // ---- Guild Status / Player ----

  app.get('/api/guilds/:guildId/status', requireAuth, requirePlayerAccess, (req, res) => {
    res.json(buildPlayerStatusSnapshot(client, req.params.guildId));
  });

  app.get('/api/guilds/:guildId/player/events', requireAuth, requirePlayerAccess, (req, res) => {
    const guildId = req.params.guildId;
    const page = parseQueuePage(req.query.page);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    let closed = false;
    const sendSnapshot = () => {
      if (closed) return;
      writeSseEvent(res, 'snapshot', {
        status: buildPlayerStatusSnapshot(client, guildId),
        queue: buildQueueSnapshot(client, guildId, page),
        timestamp: Date.now(),
      });
    };

    sendSnapshot();
    const snapshotInterval = setInterval(sendSnapshot, 1000);
    const heartbeatInterval = setInterval(() => {
      if (!closed) res.write(': keep-alive\n\n');
    }, 15000);

    req.on('close', () => {
      closed = true;
      clearInterval(snapshotInterval);
      clearInterval(heartbeatInterval);
    });
  });

  app.get('/api/guilds/:guildId/player/filters', requireAuth, requirePlayerAccess, (_req, res) => {
    res.json({ presets: FILTER_PRESET_CHOICES });
  });

  app.post(
    '/api/guilds/:guildId/player/upload',
    requireAuth,
    requireGuildDJ,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    express.raw({ type: '*/*', limit: AUDIO_UPLOAD_MAX_BYTES }),
    async (req, res) => {
      const guildId = req.params.guildId;
      const guild = client.guilds.cache.get(guildId);
      let player = client.lavalink?.players?.get(guildId);

      try {
        const guildConfig = getConfig(guildId);

        if (!player && guild) {
          const botVoiceChannelId = guild.members.me?.voice?.channelId;
          if (botVoiceChannelId) {
            player = client.lavalink.createPlayer({
              guildId,
              voiceChannelId: botVoiceChannelId,
              textChannelId: resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, player?.textChannelId ?? null),
              selfDeaf: true,
              volume: guildConfig.defaultVolume ?? 60,
            });
            await player.connect();
          }
        }

        if (!player) {
          return res.status(404).json({ error: 'No active player in this guild' });
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json({ error: 'Upload body is empty' });
        }

        const originalName = sanitizeUploadName(decodeUploadHeader(req.get('x-file-name')) || 'upload');
        const ext = path.extname(originalName).toLowerCase();
        const mimeType = String(req.get('content-type') || '').split(';')[0].toLowerCase();

        if (!isAllowedAudioUpload(ext, mimeType)) {
          return res.status(400).json({ error: 'Unsupported audio file type' });
        }

        const uploadId = crypto.createHash('sha256').update(req.body).digest('hex');
        const guildUploadDir = path.join(UPLOAD_DIR, guildId);
        await fs.promises.mkdir(guildUploadDir, { recursive: true });

        const filePath = path.join(guildUploadDir, `${uploadId}${ext}`);
        if (!isPathInside(filePath, UPLOAD_DIR)) {
          return res.status(400).json({ error: 'Invalid upload path' });
        }

        const alreadyStored = await fileExists(filePath);
        if (alreadyStored) {
          await touchFile(filePath);
        } else {
          await fs.promises.writeFile(filePath, req.body, { flag: 'wx' });
        }

        const publicName = encodeURIComponent(originalName);
        const playbackUrl = `${getUploadPlaybackBaseUrl()}/api/uploads/${encodeURIComponent(guildId)}/${uploadId}/${publicName}`;
        const requester = getDashboardRequester(req, client);
        const node = getUsableNode(client);
        if (!node) {
          if (!alreadyStored) await safeDeleteFile(filePath);
          return res.status(503).json({ error: 'No Lavalink node available' });
        }

        let result;
        try {
          result = await node.search({ query: playbackUrl }, requester);
        } catch (error) {
          if (!alreadyStored) await safeDeleteFile(filePath);
          console.error('Lavalink upload load failed:', error);
          return res.status(502).json({ error: `Lavalink could not load upload URL: ${error.message}` });
        }

        const track = result?.tracks?.[0];
        if (!track) {
          if (!alreadyStored) await safeDeleteFile(filePath);
          return res.status(400).json({ error: 'Lavalink could not load this audio file' });
        }

        const uploadTitle = track.info?.title || path.basename(originalName, ext);
        const uploadAuthor = isUnknownTrackAuthor(track.info?.author) ? 'Local upload' : track.info.author;
        const queuedTrack = {
          ...track,
          info: {
            ...track.info,
            title: uploadTitle,
            author: uploadAuthor,
            uri: track.info?.uri || playbackUrl,
            sourceName: 'localUpload',
            isLocalUpload: true,
          },
        };
        queuedTrack.localUpload = {
          guildId,
          uploadId,
          fileName: originalName,
          filePath,
          expiresAt: Date.now() + AUDIO_UPLOAD_TTL_MS,
          cached: alreadyStored,
        };

        const startedFromIdle = !player.playing && !player.paused;
        await addManualTrackToQueue(player, queuedTrack);

        if (startedFromIdle) {
          await player.play();
          await client.musicUI?.refresh(player).catch(() => {});
        }

        const { savePlayerState } = require('./state/queueStore');
        await savePlayerState(player).catch(() => {});

        res.json({
          success: true,
          title: queuedTrack.info.title,
          author: queuedTrack.info.author,
          size: req.body.length,
          cached: alreadyStored,
        });
      } catch (err) {
        console.error('Player upload error:', err);
        res.status(500).json({ error: `Upload failed: ${err.message}` });
      }
    },
  );

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

  app.get('/api/guilds/:guildId/queue', requireAuth, requirePlayerAccess, (req, res) => {
    res.json(buildQueueSnapshot(client, req.params.guildId, parseQueuePage(req.query.page)));
  });

  app.get('/api/guilds/:guildId/history', requireAuth, requireGuildAccess, (req, res) => {
    res.json(getGuildHistory(req.params.guildId, {
      page: req.query.page,
      limit: req.query.limit,
    }));
  });

  app.get('/api/guilds/:guildId/lyrics', requireAuth, requirePlayerAccess, async (req, res) => {
    try {
      const player = client.lavalink?.players?.get(req.params.guildId);
      const requestedTitle = typeof req.query.title === 'string' ? req.query.title.trim() : '';
      const requestedArtist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
      const query = requestedTitle && requestedArtist
        ? { title: requestedTitle, artist: requestedArtist, duration: Number(req.query.duration) || 0 }
        : trackToLyricsQuery(player?.queue?.current);
      if (!query.title || !query.artist) {
        return res.status(404).json({ error: 'Nothing is playing and no song was provided' });
      }
      const lyrics = await findLyrics(query);
      if (!lyrics) return res.status(404).json({ error: 'Lyrics not found' });
      res.json(lyrics);
    } catch (error) {
      console.error('Lyrics lookup failed:', error.message);
      res.status(502).json({ error: 'Lyrics provider is temporarily unavailable' });
    }
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

  app.post('/api/guilds/:guildId/player/:action', requireAuth, requirePlayerAccess, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    const guildId = req.params.guildId;
    const action = req.params.action;
    let player = client.lavalink?.players?.get(guildId);
    const guild = client.guilds.cache.get(guildId);

    try {
      const guildConfig = getConfig(guildId);
      const member = req.guildMember;
      const capabilities = req.dashboardCapabilities;
      const memberVoiceChannelId = member?.voice?.channelId || null;
      const connectedBotVoiceChannelId = guild?.members?.me?.voice?.channelId || null;
      const botVoiceChannelId = connectedBotVoiceChannelId || player?.voiceChannelId || null;
      const privileged = capabilities.accessLevel === 'admin' || capabilities.accessLevel === 'dj';
      if (!capabilities.canControlPlayer) {
        return res.status(403).json({ error: 'Player control is not enabled for your role' });
      }

      if (action === 'join') {
        const activityChannelId = req.body?.channelId || null;
        if (!memberVoiceChannelId || activityChannelId !== memberVoiceChannelId) {
          return res.status(403).json({ error: 'Open the Activity from the voice channel you are currently in' });
        }

        const channel = guild?.channels?.cache?.get(memberVoiceChannelId);
        if (!channel?.isVoiceBased()) {
          return res.status(400).json({ error: 'The Activity channel is not a voice channel' });
        }
        if (connectedBotVoiceChannelId && connectedBotVoiceChannelId !== memberVoiceChannelId) {
          return res.status(409).json({ error: 'Bread is already active in another voice channel' });
        }

        const preferredTextChannelId = resolvePlayerTextChannelId(
          guild,
          guildConfig.playerTextChannelId,
          player?.textChannelId ?? null,
        );
        if (!player) {
          player = client.lavalink.createPlayer({
            guildId,
            voiceChannelId: memberVoiceChannelId,
            textChannelId: preferredTextChannelId,
            selfDeaf: true,
            volume: guildConfig.defaultVolume ?? 60,
          });
          await player.node.updatePlayer({
            guildId,
            playerOptions: { track: { encoded: null }, paused: false },
          });
          player.queue.current = null;
          player.playing = false;
          player.paused = false;
        } else {
          player.voiceChannelId = memberVoiceChannelId;
          player.textChannelId = preferredTextChannelId;
        }

        if (!connectedBotVoiceChannelId) await player.connect();
        return res.json({ success: true, channelId: memberVoiceChannelId, channelName: channel.name });
      }

      if (!privileged && (!memberVoiceChannelId || memberVoiceChannelId !== botVoiceChannelId)) {
        return res.status(403).json({ error: 'Join the same voice channel as the bot to control playback' });
      }
      const djOnlyActions = new Set([
        'stop',
        'clearqueue',
        'shuffle',
        'loop',
        'back',
        'volume',
        'filter',
        'autoplay',
        'remove',
        'seek',
        'move',
        'playnow',
      ]);
      if (!privileged && djOnlyActions.has(action)) {
        return res.status(403).json({ error: 'This action requires the DJ role or Manage Guild permission' });
      }

      // Allow dashboard play when the bot is already in voice but player object is missing.
      if (!player && action === 'play' && guild) {
        const botVoiceChannelId = guild.members.me?.voice?.channelId;
        if (botVoiceChannelId) {
          player = client.lavalink.createPlayer({
            guildId,
            voiceChannelId: botVoiceChannelId,
            textChannelId: resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, player?.textChannelId ?? null),
            selfDeaf: true,
            volume: guildConfig.defaultVolume ?? 60,
          });
          await player.connect();
        }
      }

      if (!player) {
        return res.status(404).json({ error: 'No active player in this guild' });
      }

      if (guild) {
        const preferredTextChannelId = resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, player.textChannelId ?? null);
        if (player.textChannelId !== preferredTextChannelId) {
          player.textChannelId = preferredTextChannelId;
        }
      }

      switch (action) {
        case 'pause':
          if (player && !player.paused) await player.pause();
          break;

        case 'resume':
          if (player && player.paused) await player.resume();
          break;

        case 'toggle':
          if (player) {
            if (player.paused) await player.resume();
            else await player.pause();
          }
          break;

        case 'skip':
          if (player) {
            if (privileged) {
              const currentTrack = player.queue.current;
              recordAutoplaySkip(guildId, currentTrack, { position: player.position });
              if (player.queue.tracks.length === 0 && player.queue.current) {
                await player.stopPlaying(false, false);
              } else {
                await player.skip();
              }
            } else {
              const result = await handleSkipRequest({
                member,
                guild,
                user: { id: getRequestUser(req).id },
              }, player, guildConfig, client);
              return res.json({ success: true, skipped: result.skipped, message: result.message });
            }
          }
          break;

        case 'stop':
          if (player) {
            clearAutoplayState(guildId);
            await player.stopPlaying(true);
            player.queue.tracks.splice(0, player.queue.tracks.length);
            await player.destroy('Stopped via dashboard', true);
            client.musicUI?.clear(guildId);
          }
          return res.json({ success: true, stopped: true });

        case 'clearqueue': {
          if (!player) return res.status(404).json({ error: 'No active player' });
          const removed = player.queue.tracks.length;
          if (removed > 0) {
            player.queue.tracks.splice(0, removed);
          }
          await client.musicUI?.refresh(player).catch(() => {});
          const { savePlayerState } = require('./state/queueStore');
          await savePlayerState(player).catch(() => {});
          return res.json({ success: true, removed });
        }

        case 'shuffle':
          if (player && player.queue.tracks.length > 0) {
            await player.queue.shuffle();
          }
          break;

        case 'loop': {
          if (player) {
            const order = ['off', 'track', 'queue'];
            const current = order.indexOf(player.repeatMode ?? 'off');
            const next = order[(current + 1) % order.length];
            await player.setRepeatMode(next);
            await client.musicUI?.refresh(player).catch(() => {});
            return res.json({ success: true, repeatMode: next });
          }
          break;
        }

        case 'back': {
          const previous = await player.queue.shiftPrevious();
          if (!previous) return res.status(404).json({ error: 'No previous tracks' });
          await player.play({ clientTrack: previous });
          await client.musicUI?.refresh(player).catch(() => {});
          break;
        }

        case 'volume': {
          const volume = parseInt(req.body.volume, 10);
          if (isNaN(volume) || volume < 0 || volume > 500) {
            return res.status(400).json({ error: 'Invalid volume value' });
          }
          const clamped = Math.min(guildConfig.maxVolume, Math.max(0, volume));
          if (player) {
            await player.setVolume(clamped);
            await client.musicUI?.refresh(player).catch(() => {});
          }
          return res.json({ success: true, volume: clamped });
        }

        case 'search': {
          const query = req.body.query;
          if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query is required' });
          }
          if (!player) {
            return res.status(404).json({ error: 'No active player in this guild' });
          }
          const node = getUsableNode(client);
          if (!node) {
            return res.status(503).json({ error: 'No Lavalink node available' });
          }
          const defaultSource = client.lavalink?.options?.playerOptions?.defaultSearchPlatform || 'ytsearch';
          const preparedQuery = applyPreferredSource(query, guildConfig, defaultSource);
          const requester = getDashboardRequester(req, client);
          let result;
          try {
            result = await node.search({ query: preparedQuery }, requester);
          } catch (error) {
            const failure = classifyPlaybackError(error);
            return res.status(502).json({
              error: failure.description,
              code: failure.code,
            });
          }
          if (result?.loadType === 'error' || result?.exception) {
            const failure = describeSearchFailure(result);
            return res.status(502).json({
              error: failure.description,
              code: failure.code,
            });
          }
          const tracks = (result?.tracks || []).slice(0, 10).map((t) => ({
            encoded: t.encoded,
            title: t.info.title,
            author: t.info.author,
            uri: t.info.uri,
            duration: t.info.duration,
            artwork: extractArtwork(t.info),
          }));
          return res.json({ success: true, tracks });
        }

        case 'playnow':
        case 'play': {
          const { encoded, query } = req.body;
          const playImmediately = action === 'playnow';
          const requester = getDashboardRequester(req, client);

          if (encoded) {
            const track = { encoded, info: {}, requester };
            await addRequestedTrackToQueue(player, track, playImmediately);
            if (playImmediately && player.queue.current) {
              await player.skip();
            } else if (!player.queue.current || (!player.playing && !player.paused)) {
              await player.play();
            }
            await client.musicUI?.refresh(player).catch(() => {});
            const { savePlayerState } = require('./state/queueStore');
            await savePlayerState(player).catch(() => {});
            return res.json({ success: true, mode: playImmediately ? 'now' : 'queue' });
          }

          if (query) {
            const searchNode = getUsableNode(client);
            if (!searchNode) return res.status(503).json({ error: 'No Lavalink node available' });
            const defaultSource = client.lavalink?.options?.playerOptions?.defaultSearchPlatform || 'ytsearch';
            const preparedQuery = applyPreferredSource(query, guildConfig, defaultSource);
            let result;
            try {
              result = await searchNode.search({ query: preparedQuery }, requester);
            } catch (error) {
              const failure = classifyPlaybackError(error);
              return res.status(502).json({
                error: failure.description,
                code: failure.code,
              });
            }
            const track = result?.tracks?.[0];
            if (!track) {
              const failure = describeSearchFailure(result);
              const status = failure.code === 'not_found' ? 404 : 502;
              return res.status(status).json({
                error: failure.description,
                code: failure.code,
              });
            }
            if (track.info) {
              resetSeed(guildId, {
                title: track.info.title,
                author: track.info.author,
                identifier: track.info.identifier,
                uri: track.info.uri,
                duration: track.info.duration ?? track.info.length,
                sourceName: track.info.sourceName,
              });
            }
            await addRequestedTrackToQueue(player, track, playImmediately);
            if (playImmediately && player.queue.current) {
              await player.skip();
            } else if (!player.queue.current || (!player.playing && !player.paused)) {
              await player.play();
            }
            await client.musicUI?.refresh(player).catch(() => {});
            const { savePlayerState } = require('./state/queueStore');
            await savePlayerState(player).catch(() => {});
            return res.json({ success: true, title: track.info.title, mode: playImmediately ? 'now' : 'queue' });
          }

          return res.status(400).json({ error: 'Provide encoded track or query' });
        }

        case 'filter': {
          if (!player) return res.status(404).json({ error: 'No active player' });
          const preset = typeof req.body?.preset === 'string' ? req.body.preset.toLowerCase() : '';
          if (!preset) {
            return res.status(400).json({ error: 'preset is required' });
          }

          if (preset === 'clear' || preset === 'off' || preset === 'none') {
            await player.filterManager.resetFilters();
            await player.filterManager.clearEQ();
            await player.filterManager.applyPlayerFilters();
            player.filterManager.activePreset = null;
            await client.musicUI?.refresh(player).catch(() => {});
            return res.json({ success: true, filter: null });
          }

          const handler = FILTER_PRESETS[preset];
          if (!handler) {
            return res.status(400).json({ error: 'Unknown filter preset' });
          }

          await handler(player.filterManager);
          await player.filterManager.applyPlayerFilters();
          player.filterManager.activePreset = preset;
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true, filter: preset });
        }

        case 'autoplay': {
          const enabled = typeof req.body?.enabled === 'boolean'
            ? req.body.enabled
            : !Boolean(guildConfig.autoplay);
          setAutoplay(guildId, enabled);
          if (player) {
            await client.musicUI?.refresh(player).catch(() => {});
          }
          return res.json({ success: true, autoplay: enabled });
        }

        case 'remove': {
          if (!player) return res.status(404).json({ error: 'No active player' });
          const start = parseInt(req.body.start, 10);
          const end = req.body.end != null ? parseInt(req.body.end, 10) : start;
          if (isNaN(start) || isNaN(end) || start < 0 || end < start || end >= player.queue.tracks.length) {
            return res.status(400).json({ error: 'Invalid range' });
          }
          const count = end - start + 1;
          player.queue.tracks.splice(start, count);
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true, removed: count });
        }

        case 'seek': {
          const position = parseInt(req.body.position, 10);
          if (isNaN(position) || position < 0) return res.status(400).json({ error: 'Invalid position' });
          if (player) await player.seek(position);
          return res.json({ success: true, position });
        }

        case 'move': {
          if (!player) return res.status(404).json({ error: 'No active player' });
          const from = parseInt(req.body.from, 10);
          const to = parseInt(req.body.to, 10);
          if (isNaN(from) || isNaN(to) || from < 0 || to < 0 || from >= player.queue.tracks.length || to >= player.queue.tracks.length) {
            return res.status(400).json({ error: 'Invalid index' });
          }
          const removed = player.queue.tracks.splice(from, 1)[0];
          player.queue.tracks.splice(to, 0, removed);
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true });
        }

        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }

      if (player && ['pause', 'resume', 'toggle', 'skip', 'shuffle'].includes(action)) {
        await client.musicUI?.refresh(player).catch(() => {});
      }

      // Save state for non-terminal actions
      const { savePlayerState } = require('./state/queueStore');
      if (player) await savePlayerState(player).catch(() => {});

      res.json({ success: true });
    } catch (err) {
      console.error(`Player action ${action} error:`, err);
      res.status(500).json({ error: `Action failed: ${err.message}` });
    }
  });

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

function getUploadPlaybackBaseUrl() {
  const configured = process.env.UPLOAD_BASE_URL || process.env.LOCAL_AUDIO_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const port = process.env.WEB_PORT || 3001;
  const lavalinkHost = String(process.env.LAVALINK_HOST || '').toLowerCase();
  if (lavalinkHost === 'lavalink') {
    return `http://bot:${port}`;
  }

  return `http://127.0.0.1:${port}`;
}

async function safeDeleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch {}
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

async function cleanupExpiredAudioUploads() {
  let guildDirs = [];
  try {
    guildDirs = await fs.promises.readdir(UPLOAD_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return;
  }

  const cutoff = Date.now() - AUDIO_UPLOAD_TTL_MS;
  for (const guildDir of guildDirs) {
    if (!guildDir.isDirectory() || !isSafeId(guildDir.name)) continue;

    const guildPath = path.join(UPLOAD_DIR, guildDir.name);
    const files = await fs.promises.readdir(guildPath, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile()) continue;

      const filePath = path.join(guildPath, file.name);
      const stats = await fs.promises.stat(filePath).catch(() => null);
      if (stats && stats.mtimeMs < cutoff) {
        await safeDeleteFile(filePath);
      }
    }
  }
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
    sessionHistory,
  };
}

function buildQueueSnapshot(client, guildId, page = 0) {
  const player = client.lavalink?.players?.get(guildId);
  if (!player) {
    return { current: null, tracks: [], total: 0, page, totalPages: 0 };
  }

  const perPage = 20;
  const allTracks = player.queue.tracks;
  const start = page * perPage;

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
  };
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

module.exports = { createApiServer };
