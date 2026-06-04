const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { getConfig, setConfig, deleteConfig, DEFAULT_CONFIG } = require('./state/guildConfig');
const { getGuildInsights } = require('./state/analyticsStore');
const { getBalance, addBalance, removeBalance, getLeaderboard } = require('./games/economy');
const { setAutoplay, resetSeed, recordAutoplaySkip } = require('./music/autoplay');
const { applyPreferredSource } = require('./music/searchUtils');

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = ['identify', 'guilds'].join(' ');

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

  function requireAuth(req, res, next) {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
  }

  async function requireGuildAdmin(req, res, next) {
    const guildId = req.params.guildId;
    if (!guildId) return res.status(400).json({ error: 'Missing guild ID' });

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Bot is not in this guild' });

    let member = guild.members.cache.get(req.session.user.id);
    if (!member) {
      try {
        member = await guild.members.fetch(req.session.user.id);
      } catch {
        return res.status(403).json({ error: 'You are not in this guild' });
      }
    }

    if (!member.permissions.has('ManageGuild')) {
      return res.status(403).json({ error: 'Manage Guild permission required' });
    }

    next();
  }

  function requireTrustedOrigin(req, res, next) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const requestOrigin = normalizeOrigin(origin) || normalizeOrigin(referer);

    if (!requestOrigin || !trustedOrigins.has(requestOrigin)) {
      return res.status(403).json({ error: 'Invalid request origin' });
    }

    next();
  }

  function requireDashboardActionRateLimit(req, res, next) {
    const userId = req.session?.user?.id;
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

      function mapGuilds(discordGuilds) {
        return discordGuilds
          .filter((g) => (BigInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD)
          .map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.icon,
            permissions: g.permissions,
            member_count: g.approximate_member_count || 0,
            bot_present: botGuildIds.has(g.id),
          }))
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
            return res.json(mapGuilds(await retryRes.json()));
          }
        }
        const errBody = await guildsRes.json().catch(() => ({}));
        console.error('Guilds fetch failed:', guildsRes.status, errBody);
        return res.status(502).json({ error: `Failed to fetch guilds: ${guildsRes.status}` });
      }

      const guilds = mapGuilds(await guildsRes.json());

      res.json(guilds);
    } catch (err) {
      console.error('Guilds fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch guilds' });
    }
  });

  // ---- Guild Config ----

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

    if (config.playerTextChannelId && guild) {
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
    });
  });

  app.put('/api/guilds/:guildId/config', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    const updates = {};
    const body = req.body;
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);
    const previousConfig = getConfig(guildId);

    if (typeof body.djRoleId === 'string') updates.djRoleId = body.djRoleId || null;
    if (typeof body.playerTextChannelId === 'string') {
      const channelId = body.playerTextChannelId || null;
      if (channelId) {
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
    if (typeof body.defaultVolume === 'number') updates.defaultVolume = Math.max(0, Math.min(100, body.defaultVolume));

    const updated = setConfig(guildId, updates);

    if (Object.prototype.hasOwnProperty.call(updates, 'playerTextChannelId')) {
      const preferredTextChannelId = getFallbackTextChannelId(guild, updated.playerTextChannelId);
      const player = client.lavalink?.players?.get(guildId);
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

    res.json({ success: true, config: updated });
  });

  app.post('/api/guilds/:guildId/config/reset', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, (req, res) => {
    deleteConfig(req.params.guildId);
    const fresh = getConfig(req.params.guildId);
    res.json({ success: true, config: fresh });
  });

  // ---- Guild Status / Player ----

  app.get('/api/guilds/:guildId/status', requireAuth, requireGuildAdmin, (req, res) => {
    const guildId = req.params.guildId;
    const player = client.lavalink?.players?.get(guildId);
    const guild = client.guilds.cache.get(guildId);
    const config = getConfig(guildId);

    if (!player) {
      return res.json({
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
      });
    }

    let voiceChannelName = null;
    if (player.voiceChannelId && guild) {
      const channel = guild.channels.cache.get(player.voiceChannelId);
      voiceChannelName = channel ? channel.name : null;
    }

    let currentTrack = null;
    if (player.queue.current) {
      const info = player.queue.current.info;
      currentTrack = {
        title: info.title || 'Unknown',
        author: info.author || 'Unknown',
        uri: info.uri || '',
        duration: info.duration || 0,
        position: player.position || 0,
        artwork: extractArtwork(info),
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

    res.json({
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
    });
  });

  app.get('/api/guilds/:guildId/player/filters', requireAuth, requireGuildAdmin, (_req, res) => {
    res.json({ presets: FILTER_PRESET_CHOICES });
  });

  app.get('/api/guilds/:guildId/health', requireAuth, requireGuildAdmin, (req, res) => {
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

  app.get('/api/guilds/:guildId/insights', requireAuth, requireGuildAdmin, (req, res) => {
    const guildId = req.params.guildId;
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(25, requested)) : 5;
    const requestedRange = typeof req.query.range === 'string' ? req.query.range : 'all';
    const range = ['24h', '7d', 'all'].includes(requestedRange) ? requestedRange : 'all';

    res.json(getGuildInsights(guildId, { limit, range }));
  });

  app.get('/api/guilds/:guildId/queue', requireAuth, requireGuildAdmin, (req, res) => {
    const player = client.lavalink?.players?.get(req.params.guildId);
    if (!player) {
      return res.json({ current: null, tracks: [], total: 0 });
    }

    const page = parseInt(req.query.page, 10) || 0;
    const perPage = 20;
    const allTracks = player.queue.tracks;

    const current = player.queue.current
      ? {
          title: player.queue.current.info.title,
          author: player.queue.current.info.author,
          uri: player.queue.current.info.uri,
          duration: player.queue.current.info.duration,
          artwork: extractArtwork(player.queue.current.info),
        }
      : null;

    const start = page * perPage;
    const tracks = allTracks.slice(start, start + perPage).map((t) => ({
      title: t.info.title,
      author: t.info.author,
      uri: t.info.uri,
      duration: t.info.duration,
      requester: t.requester?.username || t.requester?.id || 'Unknown',
      artwork: extractArtwork(t.info),
    }));

    res.json({
      current,
      tracks,
      total: allTracks.length,
      page,
      totalPages: Math.ceil(allTracks.length / perPage),
    });
  });

  // ---- Economy ----

  app.get('/api/guilds/:guildId/economy/leaderboard', requireAuth, requireGuildAdmin, async (req, res) => {
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

  app.post('/api/guilds/:guildId/player/:action', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    const guildId = req.params.guildId;
    const action = req.params.action;
    let player = client.lavalink?.players?.get(guildId);
    const guild = client.guilds.cache.get(guildId);

    try {
      const guildConfig = getConfig(guildId);

      // Allow dashboard play when the bot is already in voice but player object is missing.
      if (!player && action === 'play' && guild) {
        const botVoiceChannelId = guild.members.me?.voice?.channelId;
        if (botVoiceChannelId) {
          player = client.lavalink.createPlayer({
            guildId,
            voiceChannelId: botVoiceChannelId,
            textChannelId: getFallbackTextChannelId(guild, guildConfig.playerTextChannelId),
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
        const preferredTextChannelId = getFallbackTextChannelId(guild, guildConfig.playerTextChannelId);
        if (preferredTextChannelId && player.textChannelId !== preferredTextChannelId) {
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
            recordAutoplaySkip(guildId, player.queue.current, { position: player.position });
            if (player.queue.tracks.length === 0 && player.queue.current) {
               await player.stopPlaying(false, false);
            } else {
               await player.skip();
            }
          }
          break;

        case 'stop':
          if (player) {
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
          const result = await node.search({ query: preparedQuery }, requester);
          const tracks = (result?.tracks || []).slice(0, 10).map((t) => ({
            title: t.info.title,
            author: t.info.author,
            uri: t.info.uri,
            duration: t.info.duration,
            artwork: extractArtwork(t.info),
          }));
          return res.json({ success: true, tracks });
        }

        case 'play': {
          const { encoded, query } = req.body;
          const startedFromIdle = !player.playing && !player.paused;
          const requester = getDashboardRequester(req, client);

          if (encoded) {
            const track = { encoded, info: {}, requester };
            await addManualTrackToQueue(player, track);
            if (startedFromIdle) {
              await player.play();
              await client.musicUI?.refresh(player).catch(() => {});
            }
            const { savePlayerState } = require('./state/queueStore');
            await savePlayerState(player).catch(() => {});
            return res.json({ success: true });
          }

          if (query) {
            const searchNode = getUsableNode(client);
            if (!searchNode) return res.status(503).json({ error: 'No Lavalink node available' });
            const defaultSource = client.lavalink?.options?.playerOptions?.defaultSearchPlatform || 'ytsearch';
            const preparedQuery = applyPreferredSource(query, guildConfig, defaultSource);
            const result = await searchNode.search({ query: preparedQuery }, requester);
            const track = result?.tracks?.[0];
            if (!track) return res.status(404).json({ error: 'No results found' });
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
            await addManualTrackToQueue(player, track);
            if (startedFromIdle) {
              await player.play();
              await client.musicUI?.refresh(player).catch(() => {});
            }
            const { savePlayerState } = require('./state/queueStore');
            await savePlayerState(player).catch(() => {});
            return res.json({ success: true, title: track.info.title });
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

  app.get('/api/guilds/:guildId/control/messages', requireAuth, requireGuildAdmin, async (req, res) => {
    try {
      const channelId = req.query.channelId;
      if (!channelId) return res.status(400).json({ error: 'Missing channelId' });
      
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) return res.status(404).json({ error: 'Channel not found' });
      
      const messages = await channel.messages.fetch({ limit: 50 });
      const formatted = messages.map(m => ({
        id: m.id,
        content: m.content,
        author: {
          username: m.author.username,
          avatar: m.author.displayAvatarURL() || null,
          bot: m.author.bot
        },
        timestamp: m.createdTimestamp,
        attachments: m.attachments.map(a => a.url)
      }));
      res.json(formatted);
    } catch (err) {
      console.error('Messages fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  app.post('/api/guilds/:guildId/control/say', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    try {
      const { channelId, message, attachmentBase64, attachmentName } = req.body;
      if (!channelId || (!message && !attachmentBase64)) return res.status(400).json({ error: 'Missing channelId or content' });
      
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });
      if (!channel.isTextBased()) return res.status(400).json({ error: 'Not a text channel' });
      
      const payload = { content: message || undefined };
      if (attachmentBase64) {
        let base64Data = attachmentBase64;
        if (base64Data.includes(',')) base64Data = base64Data.split(',')[1];
        payload.files = [{
          attachment: Buffer.from(base64Data, 'base64'),
          name: attachmentName || 'upload.png'
        }];
      }
      
      await channel.send(payload);
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

        const preferredTextChannelId = getFallbackTextChannelId(guild, guildConfig.playerTextChannelId);
        
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
    const permissions = 3145728 + 36700160;
    const params = new URLSearchParams({
      client_id: clientId,
      permissions: String(permissions),
      scope: 'bot applications.commands',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  // ---- Error Handler ----

  app.use((err, _req, res, _next) => {
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
  const autoplayIndex = player.queue.tracks.findIndex((entry) => entry.isAutoplay);
  if (autoplayIndex !== -1) {
    player.queue.tracks.splice(autoplayIndex, 0, track);
    return;
  }

  await player.queue.add(track);
}

function getFallbackTextChannelId(guild, preferredChannelId = null) {
  if (!guild) return null;

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

function extractArtwork(info) {
  if (info.artworkUrl) return info.artworkUrl;
  if (info.uri && (info.uri.includes('youtube.com') || info.uri.includes('youtu.be')) && info.identifier) {
    return `https://img.youtube.com/vi/${info.identifier}/mqdefault.jpg`;
  }
  return null;
}

function getDashboardRequester(req, client) {
  const user = req.session?.user;
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
