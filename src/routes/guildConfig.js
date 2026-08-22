const express = require('express');

function createGuildConfigRouter({
  client,
  discordApi,
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
  playerTextChannelDisabled,
}) {
  const router = express.Router();

  router.get('/api/guilds', requireAuth, async (req, res) => {
    try {
      let accessToken = req.session.user.accessToken;

      const refreshSessionToken = async () => {
        const refreshed = await refreshAccessToken(req.session.user.refreshToken);
        if (!refreshed) return null;

        req.session.user = {
          ...req.session.user,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token || req.session.user.refreshToken,
          tokenExpires: Date.now() + refreshed.expires_in * 1000,
        };
        await new Promise((resolve, reject) => {
          req.session.save((error) => (error ? reject(error) : resolve()));
        });
        return refreshed.access_token;
      };

      if (Date.now() > (req.session.user.tokenExpires || 0)) {
        accessToken = await refreshSessionToken() || accessToken;
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

      const fetchGuilds = (token) => fetch(`${discordApi}/users/@me/guilds?with_counts=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      let guildsRes = await fetchGuilds(accessToken);

      if (guildsRes.status === 401) {
        const refreshedAccessToken = await refreshSessionToken();
        if (!refreshedAccessToken) {
          console.warn('Guilds fetch rejected the access token and session refresh failed');
          await new Promise((resolve) => req.session.destroy(() => resolve()));
          res.clearCookie('bread.sid');
          return res.status(401).json({ error: 'Discord session expired', reauth: true });
        }
        accessToken = refreshedAccessToken;
        guildsRes = await fetchGuilds(accessToken);
      }

      if (!guildsRes.ok) {
        if (guildsRes.status === 429) {
          const body = await guildsRes.json().catch(() => ({}));
          const retryMs = Math.ceil((body.retry_after || 1) * 1000) + 500;
          await new Promise((resolve) => setTimeout(resolve, retryMs));
          const retryRes = await fetchGuilds(accessToken);
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

  router.get('/api/guilds/:guildId/access', requireAuth, requirePlayerAccess, (req, res) => {
    res.json(req.dashboardCapabilities);
  });

  router.get('/api/guilds/:guildId/config', requireAuth, requireGuildAdmin, (req, res) => {
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

    if (config.playerTextChannelId && config.playerTextChannelId !== playerTextChannelDisabled && guild) {
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
      autoplayMode: config.autoplayMode,
      voiceChannelStatus: config.voiceChannelStatus,
      dashboardAccess: config.dashboardAccess,
    });
  });

  router.put('/api/guilds/:guildId/config', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    const updates = {};
    const body = req.body;
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);
    const previousConfig = getConfig(guildId);

    if (typeof body.djRoleId === 'string') updates.djRoleId = body.djRoleId || null;
    if (Object.prototype.hasOwnProperty.call(body, 'playerTextChannelId')) {
      const channelId = body.playerTextChannelId || null;
      if (channelId && channelId !== playerTextChannelDisabled) {
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
    if (typeof body.autoplayMode === 'string' && ['classic', 'ai_assisted', 'discovery'].includes(body.autoplayMode)) {
      updates.autoplayMode = body.autoplayMode;
    }
    if (typeof body.voiceChannelStatus === 'boolean') updates.voiceChannelStatus = body.voiceChannelStatus;
    if (['admin', 'dj', 'members'].includes(body.dashboardAccess)) updates.dashboardAccess = body.dashboardAccess;
    if (typeof body.defaultVolume === 'number') updates.defaultVolume = Math.max(0, Math.min(100, body.defaultVolume));

    const updated = setConfig(guildId, updates);

    if (Object.prototype.hasOwnProperty.call(updates, 'maxVolume')) {
      const player = client.lavalink?.players?.get(guildId);
      if (player && Number.isFinite(player.volume) && player.volume > updated.maxVolume) {
        await player.setVolume(updated.maxVolume);
        await savePlayerState(player).catch(() => {});
        await client.musicUI?.refresh(player).catch(() => {});
        broadcastPlayerUpdate(guildId);
      }
    }

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

  router.post('/api/guilds/:guildId/config/reset', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    const guildId = req.params.guildId;
    deleteConfig(guildId);
    const fresh = getConfig(guildId);
    const player = client.lavalink?.players?.get(guildId);
    if (player && Number.isFinite(player.volume) && player.volume > fresh.maxVolume) {
      await player.setVolume(fresh.maxVolume);
      await savePlayerState(player).catch(() => {});
      await client.musicUI?.refresh(player).catch(() => {});
      broadcastPlayerUpdate(guildId);
    }
    if (fresh.voiceChannelStatus && player?.queue.current) {
      await setVoiceTrackStatus(client, player, player.queue.current);
    }
    res.json({ success: true, config: fresh });
  });

  return router;
}

module.exports = { createGuildConfigRouter };
