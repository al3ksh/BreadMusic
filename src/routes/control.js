const express = require('express');

const CONTROL_MESSAGE_LIMIT = 50;
const CONTROL_MESSAGE_CACHE_TTL_MS = 60_000;
const MEMBER_SEARCH_CACHE_TTL_MS = 30_000;
const MEMBER_SEARCH_CACHE_MAX_ENTRIES = 100;
const controlMessageCache = new Map();
const memberSearchCache = new Map();

function createControlRouter({
  client,
  requireAuth,
  requireGuildAdmin,
  requireTrustedOrigin,
  requireDashboardActionRateLimit,
  getConfig,
  getGuildMembersSnapshot,
  resolvePlayerTextChannelId,
  clearAutoplayState,
}) {
  const router = express.Router();
  attachControlMessageCacheListeners(client);

  router.get('/api/guilds/:guildId/channels', requireAuth, requireGuildAdmin, async (req, res) => {
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

  router.get('/api/guilds/:guildId/roles', requireAuth, requireGuildAdmin, async (req, res) => {
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

  router.get('/api/guilds/:guildId/members', requireAuth, requireGuildAdmin, async (req, res) => {
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

  router.get('/api/guilds/:guildId/control/messages', requireAuth, requireGuildAdmin, async (req, res) => {
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

  router.post('/api/guilds/:guildId/control/say', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
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
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  router.post('/api/guilds/:guildId/control/action', requireAuth, requireGuildAdmin, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
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
      res.status(500).json({ error: 'Failed to run action' });
    }
  });

  return router;
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

function normalizeAllowedMentions(input) {
  const parse = [];
  if (input?.users) parse.push('users');
  if (input?.roles) parse.push('roles');
  if (input?.everyone) parse.push('everyone');
  return { parse };
}

module.exports = { createControlRouter };
