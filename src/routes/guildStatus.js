// @ts-check
const express = require('express');

function createGuildStatusRouter({
  client,
  requireAuth,
  requireGuildAccess,
  getConfig,
  getGuildInsights,
  isUsableTextChannel,
}) {
  const router = express.Router();

  router.get('/api/guilds/:guildId/health', requireAuth, requireGuildAccess, (req, res) => {
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

  router.get('/api/guilds/:guildId/insights', requireAuth, requireGuildAccess, (req, res) => {
    const guildId = req.params.guildId;
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(25, requested)) : 5;
    const requestedRange = typeof req.query.range === 'string' ? req.query.range : 'all';
    const range = ['24h', '7d', 'all'].includes(requestedRange) ? requestedRange : 'all';

    res.json(getGuildInsights(guildId, { limit, range }));
  });

  return router;
}

module.exports = { createGuildStatusRouter };
