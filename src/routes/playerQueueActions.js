const { classifyQuery, isOrigin, tagOrigin } = require('../music/trackOrigin');
const { playStation } = require('../music/radioPlayback');
const { queueRequestedTracks, fitQueueLimit, takeDuplicateWarning } = require('../music/queueInsert');

// Actions that find tracks and put them in the queue. Each one answers the request itself.
function createQueueActions({
  client,
  getDashboardRequester,
  getUsableNode,
  savePlayerState,
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
  addManualSeed,
  clearAutoplayPrefetch,
  addRequestedTrackToQueue,
  getRequestUser,
  library,
  radio,
}) {
  const actions = {
    async search({ req, res, guildId, guildConfig }) {
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
      // Picks are queued later by encoded track, so the result carries what the search box held.
      const searchOrigin = classifyQuery(query);
      const tracks = loadedTracks.slice(0, 10).map((track) => ({
        encoded: track.encoded,
        title: track.info.title,
        author: track.info.author,
        uri: track.info.uri,
        duration: track.info.duration,
        artwork: extractArtwork(track.info),
        source: normalizeSourceName(track.info),
        origin: searchOrigin,
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
        origin: searchOrigin,
        expiresAt: Date.now() + (playlist ? playerPlaylistCacheTtlMs : playerSearchCacheTtlMs),
      });
      prunePlayerSearchCache();
      return res.json({ success: true, tracks, playlist });
    },
    async playlist({ req, res, guildId, player, guildConfig, member }) {
      const cacheKey = typeof req.body?.cacheKey === 'string' ? req.body.cacheKey : '';
      if (!cacheKey.startsWith(`${guildId}:`)) return res.status(400).json({ error: 'Invalid playlist selection' });
      const cachedSearch = playerSearchCache.get(cacheKey);
      const playlistTracks = cachedSearch?.playlistTracks;
      if (!cachedSearch || cachedSearch.expiresAt <= Date.now() || !cachedSearch.playlist || !Array.isArray(playlistTracks) || playlistTracks.length === 0) {
        return res.status(410).json({ error: 'Playlist search expired. Search for the playlist again.' });
      }

      const requester = getDashboardRequester(req, client);
      const { tracks: tracksToAdd, skipped } = fitQueueLimit(
        player,
        playlistTracks.map((track) => ({ ...track, requester, origin: cachedSearch.origin ?? 'link' })),
        { userId: requester.id, member, config: guildConfig },
      );
      tracksToAdd.forEach((track) => addManualSeed(guildId, track, { invalidatePrefetch: false }));
      clearAutoplayPrefetch(guildId);
      await queueRequestedTracks(player, tracksToAdd, { fair: guildConfig.fairQueue });
      if (!player.queue.current && !player.playing && !player.paused) await player.play();
      await client.musicUI?.refresh(player).catch(() => {});
      await savePlayerState(player).catch(() => {});
      playerSearchCache.delete(cacheKey);
      return res.json({ success: true, title: cachedSearch.playlist.name, count: tracksToAdd.length, skipped, mode: 'queue', truncated: cachedSearch.playlist.truncated });
    },
    // Plays the requester's Liked list or one of their saved playlists.
    async library({ req, res, guildId, player, guildConfig, member }) {
      if (!library) return res.status(503).json({ error: 'The library is not available' });
      const userId = getRequestUser(req)?.id;
      const playlistId = typeof req.body?.playlistId === 'string' ? req.body.playlistId : '';
      const playable = playlistId ? library.resolvePlayable(userId, playlistId) : null;
      if (!playable) return res.status(404).json({ error: 'Playlist not found' });
      if (playable.tracks.length === 0) return res.status(409).json({ error: 'This playlist is empty' });

      const requester = getDashboardRequester(req, client);
      const entries = req.body?.shuffle === true ? library.shuffled(playable.tracks) : playable.tracks;
      const { tracks: tracksToAdd, skipped } = fitQueueLimit(
        player,
        tagOrigin(entries.map((entry) => library.entryToTrack(entry, requester)), 'library'),
        { userId: requester.id, member, config: guildConfig },
      );
      tracksToAdd.forEach((track) => addManualSeed(guildId, track, { invalidatePrefetch: false }));
      clearAutoplayPrefetch(guildId);
      await queueRequestedTracks(player, tracksToAdd, { fair: guildConfig.fairQueue });
      if (!player.queue.current && !player.playing && !player.paused) await player.play();
      await client.musicUI?.refresh(player).catch(() => {});
      await savePlayerState(player).catch(() => {});
      return res.json({ success: true, title: playable.name, count: tracksToAdd.length, skipped, mode: 'queue' });
    },
    // One saved track from the Library: queued for anyone, next in line or straight away for DJs.
    async library_track({ req, res, guildId, player, guildConfig, member }) {
      if (!library) return res.status(503).json({ error: 'The library is not available' });
      const mode = ['next', 'now'].includes(req.body?.mode) ? req.body.mode : 'queue';
      const userId = getRequestUser(req)?.id;
      const playlistId = typeof req.body?.playlistId === 'string' ? req.body.playlistId : '';
      const key = typeof req.body?.key === 'string' ? req.body.key : '';
      const playable = playlistId && key ? library.resolvePlayable(userId, playlistId) : null;
      const entry = playable?.tracks.find((saved) => saved.key === key);
      if (!entry) return res.status(404).json({ error: 'Track not found in your Library' });

      const requester = getDashboardRequester(req, client);
      const [track] = tagOrigin([library.entryToTrack(entry, requester)], 'library');
      if (mode !== 'now') {
        fitQueueLimit(player, [track], { userId: requester.id, member, config: guildConfig });
        const warning = takeDuplicateWarning(player, track, requester.id);
        if (warning) return res.status(409).json({ error: warning, code: 'duplicate' });
      }
      addManualSeed(guildId, track);
      if (mode === 'next' && player.queue.current) await queueRequestedTracks(player, track, { next: true });
      else await addRequestedTrackToQueue(player, track, mode === 'now');
      if (mode === 'now' && player.queue.current) await player.skip();
      else if (!player.queue.current || (!player.playing && !player.paused)) await player.play();
      await client.musicUI?.refresh(player).catch(() => {});
      await savePlayerState(player).catch(() => {});
      return res.json({ success: true, title: track.info.title, mode });
    },
    // Plays a station picked in the Activity radio tab (a search result or a saved station).
    async radio({ req, res, player }) {
      const stationId = typeof req.body?.stationId === 'string' ? req.body.stationId.trim() : '';
      if (!stationId) return res.status(400).json({ error: 'Pick a station' });
      let station;
      try {
        station = await radio.resolveStation(stationId);
      } catch (error) {
        return res.status(404).json({ error: error instanceof radio.RadioError ? error.message : 'Could not look up that station' });
      }
      let played;
      try {
        played = await playStation(player, station, getDashboardRequester(req, client), { radio });
      } catch (error) {
        const failure = classifyPlaybackError(error);
        return res.status(502).json({ error: failure.description || failure.title });
      }
      if (!played.track) return res.status(404).json({ error: 'That station is not streaming right now' });
      await client.musicUI?.refresh(player).catch(() => {});
      await savePlayerState(player).catch(() => {});
      return res.json({ success: true, title: station.name, mode: played.replaced ? 'switched' : 'queue' });
    },
    async play({ req, res, action, guildId, player, guildConfig, member }) {
      const { encoded, query, track: metadata } = req.body;
      const playImmediately = action === 'playnow';
      const playNext = action === 'playnext';
      // Play next goes straight to the front of the queue, ahead of everyone's turns.
      const enqueue = (track) => (playNext && player.queue.current
        ? queueRequestedTracks(player, track, { next: true })
        : addRequestedTrackToQueue(player, track, playImmediately));
      const mode = playImmediately ? 'now' : playNext ? 'next' : 'queue';
      const requester = getDashboardRequester(req, client);
      // The client names the origin for history replays and search picks.
      const requestedOrigin = [req.body?.origin, metadata?.origin].find(isOrigin) ?? null;
      const limitOptions = { userId: requester.id, member, config: guildConfig };
      // Play now skips straight to the track, so it neither waits in line nor asks about copies.
      const checkRoom = (track) => { if (!playImmediately) fitQueueLimit(player, [track], limitOptions); };
      const duplicateWarning = (track) => (playImmediately ? null : takeDuplicateWarning(player, track, requester.id));
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
          origin: requestedOrigin ?? 'search',
        };
        checkRoom(track);
        const warning = duplicateWarning(track);
        if (warning) return res.status(409).json({ error: warning, code: 'duplicate' });
        addManualSeed(guildId, track);
        await enqueue(track);
        if (playImmediately && player.queue.current) await player.skip();
        else if (!player.queue.current || (!player.playing && !player.paused)) await player.play();
        await client.musicUI?.refresh(player).catch(() => {});
        await savePlayerState(player).catch(() => {});
        return res.json({ success: true, mode });
      }
      if (query) {
        checkRoom(query);
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
        tagOrigin(track, requestedOrigin ?? classifyQuery(query));
        const warning = duplicateWarning(track);
        if (warning) return res.status(409).json({ error: warning, code: 'duplicate' });
        addManualSeed(guildId, track);
        await enqueue(track);
        if (playImmediately && player.queue.current) await player.skip();
        else if (!player.queue.current || (!player.playing && !player.paused)) await player.play();
        await client.musicUI?.refresh(player).catch(() => {});
        await savePlayerState(player).catch(() => {});
        return res.json({ success: true, title: track.info.title, mode });
      }
      return res.status(400).json({ error: 'Provide encoded track or query' });
    },
  };
  actions.playnow = actions.play;
  actions.playnext = actions.play;
  return actions;
}

module.exports = { createQueueActions };
