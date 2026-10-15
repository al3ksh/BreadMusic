// @ts-check
const express = require('express');

function createEconomyRouter({
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
}) {
  const router = express.Router();

  router.get('/api/guilds/:guildId/economy/leaderboard', requireAuth, requireGuildAccess, async (req, res) => {
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

  router.get('/api/guilds/:guildId/economy/members', requireAuth, requireGuildAdmin, async (req, res) => {
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

  router.post('/api/guilds/:guildId/economy/adjust', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
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

  return router;
}

module.exports = { createEconomyRouter };
