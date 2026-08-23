const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createPlayerRouter({
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
  filterPresetChoices,
  acquireGuildMutex,
  resolvePlayerTextChannelId,
  getConfig,
  sanitizeUploadName,
  decodeUploadHeader,
  isAllowedAudioUpload,
  uploadDir,
  uploadMaxBytes,
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
  audioUploadTtlMs,
  audioUploadQuotaBytes,
  savePlayerState,
  getGuildHistory,
  findLyrics,
  trackToLyricsQuery,
  playerSearchCache,
  prunePlayerSearchCache,
  playerPlaylistMaxTracks,
  playerPlaylistCacheTtlMs,
  playerSearchCacheTtlMs,
  applyPreferredSource,
  classifyPlaybackError,
  describeSearchFailure,
  extractArtwork,
  normalizeSourceName,
  getTrackCapabilityMetadata,
  waitForPlayerVoice,
  activityVoiceReconnectDelayMs,
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
  filterPresets,
  isTrackSeekable,
  seekTrack,
  isUnseekableTrackError,
  audioUploadDirectory,
  broadcastPlayerUpdate,
}) {
  const router = express.Router();

  router.get('/api/guilds/:guildId/status', requireAuth, requirePlayerAccess, (req, res) => {
    res.json(buildPlayerStatusSnapshot(client, req.params.guildId));
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
          status: buildPlayerStatusSnapshot(client, guildId),
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

  router.post(
    '/api/guilds/:guildId/player/upload',
    requireAuth,
    requireGuildDJ,
    requireTrustedOrigin,
    requireDashboardActionRateLimit,
    async (req, res) => {
      const guildId = req.params.guildId;
      res.once('finish', () => broadcastPlayerUpdate(guildId));
      const releaseUpload = await acquireGuildMutex(guildId);
      const guild = client.guilds.cache.get(guildId);
      let player = client.lavalink?.players?.get(guildId);
      let uploadTempPath = null;
      let activeUploadTempPath = null;
      let storedFilePath = null;

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

        const originalName = sanitizeUploadName(decodeUploadHeader(req.get('x-file-name')) || 'upload');
        const ext = path.extname(originalName).toLowerCase();
        const mimeType = String(req.get('content-type') || '').split(';')[0].toLowerCase();

        if (!isAllowedAudioUpload(ext, mimeType)) {
          return res.status(400).json({ error: 'Unsupported audio file type' });
        }

        const guildUploadDir = path.join(uploadDir, guildId);
        await fs.promises.mkdir(guildUploadDir, { recursive: true });

        uploadTempPath = path.join(
          guildUploadDir,
          `.incoming-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.tmp`,
        );
        activeUploadTempPath = path.resolve(uploadTempPath);
        activeUploadTempPaths.add(activeUploadTempPath);
        const streamedUpload = await streamUploadToFile(req, uploadTempPath, uploadMaxBytes);
        const streamedUploadId = streamedUpload.uploadId;
        uploadTempPath = streamedUpload.path;
        if (!streamedUpload.size) {
          return res.status(400).json({ error: 'Upload body is empty' });
        }

        const filePath = path.join(guildUploadDir, `${streamedUploadId}${ext}`);
        if (!isPathInside(filePath, audioUploadDirectory)) {
          return res.status(400).json({ error: 'Invalid upload path' });
        }

        const releaseQuota = await acquireUploadQuotaMutex();
        let alreadyStored;
        try {
          await cleanupExpiredAudioUploads(client);
          alreadyStored = await fileExists(filePath);
          if (alreadyStored) {
            await safeDeleteFile(uploadTempPath);
            uploadTempPath = null;
            await touchFile(filePath);
          } else {
            const hasRoom = await makeRoomForAudioUpload(streamedUpload.size, client, uploadTempPath);
            if (!hasRoom) {
              await safeDeleteFile(uploadTempPath);
              uploadTempPath = null;
              return res.status(507).json({
                error: `Upload storage limit reached (${Math.floor(audioUploadQuotaBytes / (1024 * 1024))} MB); all older files are still in use`,
              });
            }

            await renameFileWithRetry(uploadTempPath, filePath);
            uploadTempPath = null;
            storedFilePath = filePath;
          }
        } finally {
          releaseQuota();
        }

        const playbackUrl = createSignedUploadUrl({
          baseUrl: getUploadPlaybackBaseUrl(),
          guildId,
          uploadId: streamedUploadId,
          fileName: originalName,
        });
        const requester = getDashboardRequester(req, client);
        const node = getUsableNode(client);
        if (!node) {
          if (storedFilePath) await safeDeleteFile(storedFilePath);
          return res.status(503).json({ error: 'No Lavalink node available' });
        }

        let result;
        try {
          result = await node.search({ query: playbackUrl }, requester);
        } catch (error) {
          if (storedFilePath) await safeDeleteFile(storedFilePath);
          console.error('Lavalink upload load failed:', error);
          return res.status(502).json({ error: `Lavalink could not load upload URL: ${error.message}` });
        }

        const track = result?.tracks?.[0];
        if (!track) {
          if (storedFilePath) await safeDeleteFile(storedFilePath);
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
          uploadId: streamedUploadId,
          fileName: originalName,
          filePath,
          expiresAt: Date.now() + audioUploadTtlMs,
          cached: alreadyStored,
        };

        const startedFromIdle = !player.playing && !player.paused;
        await addManualTrackToQueue(player, queuedTrack);

        if (startedFromIdle) {
          await player.play();
          await client.musicUI?.refresh(player).catch(() => {});
        }

        await savePlayerState(player).catch(() => {});

        res.json({
          success: true,
          title: queuedTrack.info.title,
          author: queuedTrack.info.author,
          size: streamedUpload.size,
          cached: alreadyStored,
        });
      } catch (err) {
        console.error('Player upload error:', err);
        await safeDeleteFile(uploadTempPath);
        if (!res.headersSent) {
          const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.code === 'ECONNABORTED' ? 400 : 500;
          res.status(status).json({ error: `Upload failed: ${err.message}` });
        }
      } finally {
        if (activeUploadTempPath) activeUploadTempPaths.delete(activeUploadTempPath);
        releaseUpload();
      }
    },
  );

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
      const privileged = capabilities.accessLevel === 'admin' || capabilities.accessLevel === 'dj';
      if (!capabilities.canControlPlayer && action !== 'skip') {
        return res.status(403).json({ error: 'Player control is not enabled for your role' });
      }

      if (action === 'search') {
        const query = req.body.query;
        if (!query || typeof query !== 'string') {
          return res.status(400).json({ error: 'Query is required' });
        }
        const node = getUsableNode(client);
        if (!node) {
          return res.status(503).json({ error: 'No Lavalink node available' });
        }
        const defaultSource = client.lavalink?.options?.playerOptions?.defaultSearchPlatform || 'ytsearch';
        const preparedQuery = applyPreferredSource(query, guildConfig, defaultSource);
        const searchCacheKey = `${guildId}:${preparedQuery.trim().toLowerCase()}`;
        const cachedSearch = playerSearchCache.get(searchCacheKey);
        if (cachedSearch && cachedSearch.expiresAt > Date.now()) {
          playerSearchCache.delete(searchCacheKey);
          playerSearchCache.set(searchCacheKey, cachedSearch);
          return res.json({ success: true, tracks: cachedSearch.tracks, playlist: cachedSearch.playlist });
        }
        const requester = getDashboardRequester(req, client);
        let result;
        try {
          result = await node.search({ query: preparedQuery }, requester);
        } catch (error) {
          const failure = classifyPlaybackError(error);
          return res.status(502).json({ error: failure.description, code: failure.code });
        }
        if (result?.loadType === 'error' || result?.exception) {
          const failure = describeSearchFailure(result);
          return res.status(502).json({ error: failure.description, code: failure.code });
        }
        const loadedTracks = (result?.tracks || []).slice(0, playerPlaylistMaxTracks);
        const tracks = loadedTracks.slice(0, 10).map((track) => ({
          encoded: track.encoded,
          title: track.info.title,
          author: track.info.author,
          uri: track.info.uri,
          duration: track.info.duration,
          artwork: extractArtwork(track.info),
          source: normalizeSourceName(track.info),
          ...getTrackCapabilityMetadata(track),
        }));
        const playlist = result?.playlist
          ? {
            key: searchCacheKey,
            name: result.playlist.name || 'Playlist',
            trackCount: loadedTracks.length,
            totalDuration: loadedTracks.reduce((total, track) => total + (Number(track.info?.duration) || 0), 0),
            artwork: extractArtwork(loadedTracks[0]?.info),
            truncated: (result.tracks || []).length > loadedTracks.length,
          }
          : null;
        playerSearchCache.delete(searchCacheKey);
        playerSearchCache.set(searchCacheKey, {
          tracks,
          playlist,
          playlistTracks: result?.playlist ? loadedTracks : null,
          expiresAt: Date.now() + (playlist ? playerPlaylistCacheTtlMs : playerSearchCacheTtlMs),
        });
        prunePlayerSearchCache();
        return res.json({ success: true, tracks, playlist });
      }

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

      const djOnlyActions = new Set(['stop', 'clearqueue', 'shuffle', 'loop', 'back', 'volume', 'filter', 'autoplay', 'remove', 'seek', 'move', 'playnow', 'playlist']);
      if (!privileged && djOnlyActions.has(action)) {
        return res.status(403).json({ error: 'This action requires the DJ role or Manage Guild permission' });
      }

      const isPlaybackAction = ['play', 'playnow', 'playlist'].includes(action);
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

      switch (action) {
        case 'playlist': {
          const cacheKey = typeof req.body?.cacheKey === 'string' ? req.body.cacheKey : '';
          if (!cacheKey.startsWith(`${guildId}:`)) return res.status(400).json({ error: 'Invalid playlist selection' });
          const cachedSearch = playerSearchCache.get(cacheKey);
          const playlistTracks = cachedSearch?.playlistTracks;
          if (!cachedSearch || cachedSearch.expiresAt <= Date.now() || !cachedSearch.playlist || !Array.isArray(playlistTracks) || playlistTracks.length === 0) {
            return res.status(410).json({ error: 'Playlist search expired. Search for the playlist again.' });
          }

          const requester = getDashboardRequester(req, client);
          const tracksToAdd = playlistTracks.map((track) => ({ ...track, requester }));
          tracksToAdd.forEach((track) => addManualSeed(guildId, track, { invalidatePrefetch: false }));
          clearAutoplayPrefetch(guildId);
          const autoplayIndex = player.queue.tracks.findIndex((entry) => entry.isAutoplay);
          if (autoplayIndex !== -1) player.queue.tracks.splice(autoplayIndex, 0, ...tracksToAdd);
          else await player.queue.add(tracksToAdd);
          if (!player.queue.current && !player.playing && !player.paused) await player.play();
          await client.musicUI?.refresh(player).catch(() => {});
          await savePlayerState(player).catch(() => {});
          playerSearchCache.delete(cacheKey);
          return res.json({ success: true, title: cachedSearch.playlist.name, count: tracksToAdd.length, mode: 'queue', truncated: cachedSearch.playlist.truncated });
        }

        case 'pause':
          if (!player.paused) await player.pause();
          break;
        case 'resume':
          if (player.paused) await player.resume();
          break;
        case 'toggle':
          if (player.paused) await player.resume();
          else await player.pause();
          break;
        case 'skip':
          if (privileged) {
            const currentTrack = player.queue.current;
            recordAutoplaySkip(guildId, currentTrack, { position: player.position });
            await clearVoteSkip(guildId);
            if (player.queue.tracks.length === 0 && player.queue.current) {
              await player.stopPlaying(false, false);
              if (guildConfig.autoplay && currentTrack) await handleAutoplay(player, currentTrack, client);
            } else await player.skip();
          } else {
            const result = await handleSkipRequest({ member, guild, user: { id: getRequestUser(req).id } }, player, guildConfig, client);
            if (result.needsAutoplay && result.lastTrack) await handleAutoplay(player, result.lastTrack, client);
            broadcastPlayerUpdate(guildId);
            return res.json({ success: true, skipped: result.skipped, message: result.message, voteSkip: result.vote || null });
          }
          break;
        case 'stop':
          clearAutoplayState(guildId);
          markPlayerStopping(player);
          await clearVoiceTrackStatus(client, player);
          await player.stopPlaying(true);
          player.queue.tracks.splice(0, player.queue.tracks.length);
          await player.destroy('Stopped via dashboard', true);
          await client.musicUI?.clear(guildId).catch(() => {});
          return res.json({ success: true, stopped: true });
        case 'clearqueue': {
          const removed = player.queue.tracks.length;
          if (removed > 0) player.queue.tracks.splice(0, removed);
          await client.musicUI?.refresh(player).catch(() => {});
          await savePlayerState(player).catch(() => {});
          return res.json({ success: true, removed });
        }
        case 'shuffle':
          if (player.queue.tracks.length > 0) await player.queue.shuffle();
          break;
        case 'loop': {
          const order = ['off', 'track', 'queue'];
          const current = order.indexOf(player.repeatMode ?? 'off');
          const next = order[(current + 1) % order.length];
          await player.setRepeatMode(next);
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true, repeatMode: next });
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
          if (isNaN(volume) || volume < 0 || volume > 500) return res.status(400).json({ error: 'Invalid volume value' });
          const clamped = Math.min(guildConfig.maxVolume, Math.max(0, volume));
          await player.setVolume(clamped);
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true, volume: clamped });
        }
        case 'playnow':
        case 'play': {
          const { encoded, query, track: metadata } = req.body;
          const playImmediately = action === 'playnow';
          const requester = getDashboardRequester(req, client);
          if (encoded) {
            const track = {
              encoded,
              info: {
                title: typeof metadata?.title === 'string' ? metadata.title : 'Unknown title',
                author: typeof metadata?.author === 'string' ? metadata.author : 'Unknown artist',
                uri: typeof metadata?.uri === 'string' ? metadata.uri : null,
                duration: Number.isFinite(metadata?.duration) ? metadata.duration : 0,
                artworkUrl: typeof metadata?.artwork === 'string' ? metadata.artwork : null,
                sourceName: typeof metadata?.source === 'string' ? metadata.source : normalizeSourceName(metadata),
                isSeekable: metadata?.seekable === true,
                isStream: metadata?.isStream === true,
              },
              requester,
            };
            addManualSeed(guildId, track);
            await addRequestedTrackToQueue(player, track, playImmediately);
            if (playImmediately && player.queue.current) await player.skip();
            else if (!player.queue.current || (!player.playing && !player.paused)) await player.play();
            await client.musicUI?.refresh(player).catch(() => {});
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
              return res.status(502).json({ error: failure.description, code: failure.code });
            }
            const track = result?.tracks?.[0];
            if (!track) {
              const failure = describeSearchFailure(result);
              const status = failure.code === 'not_found' ? 404 : 502;
              return res.status(status).json({ error: failure.description, code: failure.code });
            }
            addManualSeed(guildId, track);
            await addRequestedTrackToQueue(player, track, playImmediately);
            if (playImmediately && player.queue.current) await player.skip();
            else if (!player.queue.current || (!player.playing && !player.paused)) await player.play();
            await client.musicUI?.refresh(player).catch(() => {});
            await savePlayerState(player).catch(() => {});
            return res.json({ success: true, title: track.info.title, mode: playImmediately ? 'now' : 'queue' });
          }
          return res.status(400).json({ error: 'Provide encoded track or query' });
        }
        case 'filter': {
          const preset = typeof req.body?.preset === 'string' ? req.body.preset.toLowerCase() : '';
          if (!preset) return res.status(400).json({ error: 'preset is required' });
          if (preset === 'clear' || preset === 'off' || preset === 'none') {
            await player.filterManager.resetFilters();
            await player.filterManager.clearEQ();
            await player.filterManager.applyPlayerFilters();
            player.filterManager.activePreset = null;
            await client.musicUI?.refresh(player).catch(() => {});
            return res.json({ success: true, filter: null });
          }
          const handler = filterPresets[preset];
          if (!handler) return res.status(400).json({ error: 'Unknown filter preset' });
          await handler(player.filterManager);
          await player.filterManager.applyPlayerFilters();
          player.filterManager.activePreset = preset;
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true, filter: preset });
        }
        case 'autoplay': {
          const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !Boolean(guildConfig.autoplay);
          setAutoplay(guildId, enabled);
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true, autoplay: enabled });
        }
        case 'remove': {
          const start = parseInt(req.body.start, 10);
          const end = req.body.end != null ? parseInt(req.body.end, 10) : start;
          if (isNaN(start) || isNaN(end) || start < 0 || end < start || end >= player.queue.tracks.length) return res.status(400).json({ error: 'Invalid range' });
          const count = end - start + 1;
          player.queue.tracks.splice(start, count);
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true, removed: count });
        }
        case 'seek': {
          const position = parseInt(req.body.position, 10);
          if (isNaN(position) || position < 0) return res.status(400).json({ error: 'Invalid position' });
          if (!isTrackSeekable(player.queue.current)) return res.status(409).json({ error: 'This track cannot be seeked.' });
          try {
            await seekTrack(player, position);
          } catch (error) {
            if (isUnseekableTrackError(error)) return res.status(409).json({ error: 'This track cannot be seeked.' });
            throw error;
          }
          return res.json({ success: true, position });
        }
        case 'move': {
          const from = parseInt(req.body.from, 10);
          const to = parseInt(req.body.to, 10);
          if (isNaN(from) || isNaN(to) || from < 0 || to < 0 || from >= player.queue.tracks.length || to >= player.queue.tracks.length) return res.status(400).json({ error: 'Invalid index' });
          const removed = player.queue.tracks.splice(from, 1)[0];
          player.queue.tracks.splice(to, 0, removed);
          await client.musicUI?.refresh(player).catch(() => {});
          return res.json({ success: true });
        }
        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }

      if (['pause', 'resume', 'toggle', 'skip', 'shuffle'].includes(action)) {
        await client.musicUI?.refresh(player).catch(() => {});
      }
      await savePlayerState(player).catch(() => {});
      res.json({ success: true });
    } catch (err) {
      console.error(`Player action ${action} error:`, err);
      if (!res.headersSent) res.status(500).json({ error: `Action failed: ${err.message}` });
    } finally {
      releaseAction();
    }
  });

  return router;
}

module.exports = { createPlayerRouter };
