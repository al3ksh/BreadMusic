const express = require('express');

function createPublicRouter({ client }) {
  const router = express.Router();

  router.get('/api/stats', (_req, res) => {
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

  router.get('/api/bot-info', (_req, res) => {
    const u = client.user;
    res.json({
      id: u.id,
      name: u.username,
      displayName: u.globalName || u.username,
      avatar: u.avatarURL({ size: 256 }),
      clientId: process.env.DISCORD_CLIENT_ID,
    });
  });

  router.get('/api/invite', (_req, res) => {
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

  return router;
}

module.exports = { createPublicRouter };
