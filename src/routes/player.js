const express = require('express');
const { isStreamTrack } = require('../music/autoplay/normalize');
const defaultRadio = require('../music/radio');
const { CommandError } = require('../utils/commandError');
const { createPlayerUploadRouter } = require('./playerUpload');
const { createQueueActions } = require('./playerQueueActions');
const { createControlActions } = require('./playerControlActions');

// Anyone listening in the bot's voice channel may vote to skip and give autoplay feedback.
const listenerActions = new Set(['skip', 'library_like', 'autoplay_like', 'autoplay_dislike', 'autoplay_reroll']);

function createPlayerRouter(deps) {
  const {
    client,
    requireAuth,
    requirePlayerAccess,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    buildPlayerStatusSnapshot,
    parseQueuePage,
    writeSseEvent,
    buildQueueSnapshot,
    getPlayerNotice,
    playerEventSubscribers,
    filterPresetChoices,
    acquireGuildMutex,
    resolvePlayerTextChannelId,
    getConfig,
    savePlayerState,
    getGuildHistory,
    findLyrics,
    trackToLyricsQuery,
    waitForPlayerVoice,
    activityVoiceReconnectDelayMs,
    hydratePlayer,
    getRequestUser,
    broadcastPlayerUpdate,
    library = null,
    radio = defaultRadio,
  } = deps;
  const router = express.Router();
  const actions = {
    ...createQueueActions({ ...deps, library, radio }),
    ...createControlActions({ ...deps, library }),
  };

  router.get('/api/guilds/:guildId/status', requireAuth, requirePlayerAccess, (req, res) => {
    res.json(buildPlayerStatusSnapshot(client, req.params.guildId, getRequestUser(req)?.id));
  });

  router.get('/api/guilds/:guildId/player/events', requireAuth, requirePlayerAccess, (req, res) => {
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
      try {
        writeSseEvent(res, 'snapshot', {
          status: buildPlayerStatusSnapshot(client, guildId, getRequestUser(req)?.id),
          queue: buildQueueSnapshot(client, guildId, page),
          notice: getPlayerNotice(guildId),
          timestamp: Date.now(),
        });
      } catch {
        closed = true;
      }
    };

    const subscribers = playerEventSubscribers.get(guildId) || new Set();
    subscribers.add(sendSnapshot);
    playerEventSubscribers.set(guildId, subscribers);
    sendSnapshot();
    const heartbeatInterval = setInterval(() => {
      if (closed) return;
      try {
        res.write(': keep-alive\n\n');
      } catch {
        closed = true;
      }
    }, 15000);

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeatInterval);
      subscribers.delete(sendSnapshot);
      if (subscribers.size === 0) playerEventSubscribers.delete(guildId);
    });
  });

  router.get('/api/guilds/:guildId/player/filters', requireAuth, requirePlayerAccess, (_req, res) => {
    res.json({ presets: filterPresetChoices });
  });

  router.use(createPlayerUploadRouter(deps));

  router.get('/api/guilds/:guildId/queue', requireAuth, requirePlayerAccess, (req, res) => {
    res.json(buildQueueSnapshot(client, req.params.guildId, parseQueuePage(req.query.page)));
  });

  router.get('/api/guilds/:guildId/history', requireAuth, requirePlayerAccess, (req, res) => {
    if (!req.activityUser && !req.dashboardCapabilities?.canAccess) {
      return res.status(403).json({ error: 'Dashboard access is not enabled for your role' });
    }
    res.json(getGuildHistory(req.params.guildId, {
      page: req.query.page,
      limit: req.query.limit,
    }));
  });

  router.get('/api/guilds/:guildId/lyrics', requireAuth, requirePlayerAccess, async (req, res) => {
    try {
      const player = client.lavalink?.players?.get(req.params.guildId);
      const requestedTitle = typeof req.query.title === 'string' ? req.query.title.trim() : '';
      const requestedArtist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
      if (!(requestedTitle && requestedArtist) && isStreamTrack(player?.queue?.current)) {
        return res.status(404).json({ error: 'Lyrics are not available for live radio' });
      }
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

  router.post('/api/guilds/:guildId/player/:action', requireAuth, requirePlayerAccess, requireTrustedOrigin, requireDashboardActionRateLimit, async (req, res) => {
    const guildId = req.params.guildId;
    const action = req.params.action;
    let player = client.lavalink?.players?.get(guildId);
    const guild = client.guilds.cache.get(guildId);
    const releaseAction = await acquireGuildMutex(guildId);
    res.once('finish', () => broadcastPlayerUpdate(guildId));

    try {
      const guildConfig = getConfig(guildId);
      const member = req.guildMember;
      const capabilities = req.dashboardCapabilities;
      const memberVoiceChannelId = member?.voice?.channelId || null;
      const connectedBotVoiceChannelId = guild?.members?.me?.voice?.channelId || null;
      let botVoiceChannelId = connectedBotVoiceChannelId || player?.voiceChannelId || null;
      const privileged = capabilities.canControlPlayer === true;
      const canQueue = capabilities.canQueue === true;
      const queueContributorAction = action === 'search' || action === 'play' || action === 'library' || action === 'library_track' || action === 'radio';
      if (!privileged && !listenerActions.has(action) && !(canQueue && queueContributorAction)) {
        return res.status(403).json({ error: 'Player control is not enabled for your role' });
      }

      if (action === 'search') return await actions.search({ req, res, guildId, guildConfig });

      if (action === 'join') {
        const activityChannelId = req.body?.channelId || null;
        // Activities launched from text-channel buttons may report the text
        // channel as the launch context. Trust the gateway view of where the
        // member actually sits instead of the client-provided channel.
        const targetVoiceChannelId = memberVoiceChannelId || activityChannelId;
        if (!targetVoiceChannelId || req.activityUser && !memberVoiceChannelId) {
          return res.status(403).json({ error: 'Join a voice channel before opening the Activity' });
        }

        const channel = guild?.channels?.cache?.get(targetVoiceChannelId);
        if (!channel?.isVoiceBased()) {
          return res.status(400).json({ error: 'The Activity channel is not a voice channel' });
        }
        if (connectedBotVoiceChannelId && connectedBotVoiceChannelId !== targetVoiceChannelId) {
          return res.status(409).json({ error: 'Bread is already active in another voice channel' });
        }

        const preferredTextChannelId = resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, player?.textChannelId ?? null);
        const createdActivityPlayer = !player;
        if (!player) {
          player = client.lavalink.createPlayer({
            guildId,
            voiceChannelId: targetVoiceChannelId,
            textChannelId: preferredTextChannelId,
            selfDeaf: true,
            volume: guildConfig.defaultVolume ?? 60,
          });
        } else {
          player.voiceChannelId = targetVoiceChannelId;
          player.textChannelId = preferredTextChannelId;
        }

        if (createdActivityPlayer) {
          if (connectedBotVoiceChannelId) {
            await player.disconnect(true).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, activityVoiceReconnectDelayMs));
          }
          await player.connect();
          const voiceReady = await waitForPlayerVoice(player);
          if (!voiceReady) console.warn(`[Activity] Voice handshake still pending for guild ${guildId}; restoring player anyway.`);
          await hydratePlayer(player, client).catch((error) => {
            console.error(`Failed to restore Activity player for ${guildId}:`, error.message);
          });
          if (!player.queue.current && player.queue.tracks.length === 0) {
            await player.node.updatePlayer({ guildId, playerOptions: { track: { encoded: null }, paused: false } });
            player.playing = false;
            player.paused = false;
          }
        } else if (!connectedBotVoiceChannelId) {
          await player.connect();
        }
        return res.json({ success: true, channelId: targetVoiceChannelId, channelName: channel.name });
      }

      const djOnlyActions = new Set(['stop', 'clearqueue', 'shuffle', 'loop', 'back', 'volume', 'filter', 'sound', 'autoplay', 'remove', 'seek', 'move', 'playnow', 'playnext', 'playlist']);
      // A Library track jumps the line only for DJs, like play next and play now.
      const jumpsQueue = action === 'library_track' && ['next', 'now'].includes(req.body?.mode);
      if (!privileged && (djOnlyActions.has(action) || jumpsQueue)) {
        return res.status(403).json({ error: 'This action requires the DJ role or Manage Guild permission' });
      }

      const isPlaybackAction = ['play', 'playnow', 'playnext', 'playlist', 'library', 'library_track', 'radio'].includes(action);
      if (isPlaybackAction && req.activityUser && !memberVoiceChannelId) {
        return res.status(403).json({ error: 'Join the voice channel Bread is playing in before controlling playback' });
      }
      // Prefer the gateway view of the member's voice channel over the
      // client-provided launch context, which can be a text channel when the
      // Activity is opened from a player button.
      const requestedPlaybackChannelId = isPlaybackAction
        ? memberVoiceChannelId || req.body?.channelId || connectedBotVoiceChannelId || null
        : null;
      if (requestedPlaybackChannelId) {
        const channel = guild?.channels?.cache?.get(requestedPlaybackChannelId);
        if (!channel?.isVoiceBased()) return res.status(400).json({ error: 'The Activity channel is not a voice channel' });
        if (connectedBotVoiceChannelId && connectedBotVoiceChannelId !== requestedPlaybackChannelId) {
          return res.status(409).json({ error: 'Bread is already active in another voice channel' });
        }

        const createdPlaybackPlayer = !player;
        if (!player) {
          player = client.lavalink.createPlayer({
            guildId,
            voiceChannelId: requestedPlaybackChannelId,
            textChannelId: resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, null),
            selfDeaf: true,
            volume: guildConfig.defaultVolume ?? 60,
          });
        } else {
          player.voiceChannelId = requestedPlaybackChannelId;
          player.textChannelId = resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, player.textChannelId ?? null);
        }
        if (createdPlaybackPlayer) {
          if (connectedBotVoiceChannelId) {
            await player.disconnect(true).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, activityVoiceReconnectDelayMs));
          }
          await player.connect();
          const voiceReady = await waitForPlayerVoice(player);
          if (!voiceReady) console.warn(`[Player] Voice handshake still pending for guild ${guildId}; continuing playback request.`);
          await hydratePlayer(player, client).catch((error) => {
            console.error(`Failed to restore player for ${guildId}:`, error.message);
          });
        } else if (!connectedBotVoiceChannelId) {
          await player.connect();
        }
        botVoiceChannelId = requestedPlaybackChannelId;
      }

      if (!privileged && (!memberVoiceChannelId || memberVoiceChannelId !== botVoiceChannelId)) {
        return res.status(403).json({ error: 'Join the same voice channel as the bot to control playback' });
      }

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

      if (!player) return res.status(404).json({ error: 'No active player in this guild' });

      if (guild) {
        const preferredTextChannelId = resolvePlayerTextChannelId(guild, guildConfig.playerTextChannelId, player.textChannelId ?? null);
        if (player.textChannelId !== preferredTextChannelId) player.textChannelId = preferredTextChannelId;
      }

      const handler = Object.hasOwn(actions, action) ? actions[action] : null;
      if (!handler) return res.status(400).json({ error: `Unknown action: ${action}` });
      await handler({ req, res, action, guildId, guild, player, guildConfig, member, privileged });
      if (res.headersSent) return;

      if (['pause', 'resume', 'toggle', 'skip', 'autoplay_dislike', 'shuffle'].includes(action)) {
        await client.musicUI?.refresh(player).catch(() => {});
      }
      await savePlayerState(player).catch(() => {});
      res.json({ success: true });
    } catch (err) {
      if (err instanceof CommandError) {
        if (!res.headersSent) res.status(409).json({ error: err.message });
        return;
      }
      console.error(`Player action ${action} error:`, err);
      if (!res.headersSent) res.status(500).json({ error: `Action failed: ${err.message}` });
    } finally {
      releaseAction();
    }
  });

  return router;
}

module.exports = { createPlayerRouter };
