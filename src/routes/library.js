const express = require('express');

// The client never needs the encoded Lavalink blob, only what it shows.
function publicEntry(entry) {
  const { encoded: _encoded, identifier: _identifier, ...rest } = entry;
  return rest;
}

function publicSnapshot(snapshot) {
  return { ...snapshot, liked: snapshot.liked.map(publicEntry) };
}

const CREATE_FAILURES = {
  name: 'Give the playlist a name.',
  exists: 'You already have a playlist with that name.',
  limit: 'You have reached the playlist limit.',
};

const SHARE_FAILURES = {
  unknown: 'No shared playlist has that code.',
  own: 'That is your own playlist.',
};

const ADD_FAILURES = {
  missing: 'Playlist not found.',
  full: 'This playlist is full.',
};

function isPlaylistUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function createLibraryRouter({
  client,
  library,
  requireAuth,
  requirePlayerAccess,
  requireTrustedOrigin,
  requireDashboardActionRateLimit,
  getRequestUser,
  getDashboardRequester,
  getUsableNode,
}) {
  const router = express.Router();
  const base = '/api/guilds/:guildId/library';
  const mutate = [requireAuth, requirePlayerAccess, requireTrustedOrigin, requireDashboardActionRateLimit];
  const userIdOf = (req) => getRequestUser(req)?.id;

  // The tracks a save request refers to: what is playing now, or that plus the queue.
  function sourceTracks(guildId, from) {
    const player = client.lavalink?.players?.get(guildId);
    const current = player?.queue?.current ? [player.queue.current] : [];
    if (from === 'current') return current;
    if (from === 'queue') return [...current, ...(player?.queue?.tracks ?? [])];
    return [];
  }

  router.get(base, requireAuth, requirePlayerAccess, (req, res) => {
    res.json(publicSnapshot(library.getLibrarySnapshot(userIdOf(req))));
  });

  router.get(`${base}/playlists/:playlistId`, requireAuth, requirePlayerAccess, (req, res) => {
    const playlist = library.getPlaylist(userIdOf(req), req.params.playlistId);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
    return res.json({ ...playlist, tracks: playlist.tracks.map(publicEntry) });
  });

  // History rows only keep a link, so a single track is loaded back through Lavalink.
  async function resolveSingle(req, res) {
    const uri = typeof req.body?.uri === 'string' ? req.body.uri.trim() : '';
    if (!isPlaylistUrl(uri)) {
      res.status(400).json({ error: 'This track has no link to save.' });
      return null;
    }
    const node = getUsableNode(client);
    if (!node) {
      res.status(503).json({ error: 'No Lavalink node available' });
      return null;
    }
    try {
      const result = await node.search({ query: uri }, getDashboardRequester(req, client));
      const track = result?.tracks?.[0];
      if (track && library.canSaveTrack(track)) return track;
    } catch (error) {
      console.warn('[Library] Track lookup failed:', error.message);
    }
    res.status(404).json({ error: 'This track cannot be saved.' });
    return null;
  }

  router.post(`${base}/liked/add`, ...mutate, async (req, res) => {
    const track = await resolveSingle(req, res);
    if (!track) return undefined;
    library.setLiked(userIdOf(req), track, true);
    return res.json({ success: true, liked: true, title: track.info.title });
  });

  router.post(`${base}/liked/remove`, ...mutate, (req, res) => {
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!library.removeLiked(userIdOf(req), key)) return res.status(404).json({ error: 'Track is not in your Liked list.' });
    return res.json({ success: true, ...publicSnapshot(library.getLibrarySnapshot(userIdOf(req))) });
  });

  router.post(`${base}/playlists`, ...mutate, (req, res) => {
    const from = req.body?.from;
    const tracks = sourceTracks(req.params.guildId, from);
    if ((from === 'current' || from === 'queue') && tracks.length === 0) {
      return res.status(409).json({ error: 'Nothing is playing right now.' });
    }
    const result = library.createPlaylist(userIdOf(req), req.body?.name, tracks);
    if (!result.ok) return res.status(result.reason === 'limit' ? 409 : 400).json({ error: CREATE_FAILURES[result.reason], reason: result.reason });
    return res.json({ success: true, playlist: result.playlist, added: result.added, skipped: result.skipped });
  });

  router.post(`${base}/playlists/:playlistId/add`, ...mutate, async (req, res) => {
    let tracks;
    if (req.body?.from === 'uri') {
      const track = await resolveSingle(req, res);
      if (!track) return undefined;
      tracks = [track];
    } else {
      tracks = sourceTracks(req.params.guildId, req.body?.from === 'queue' ? 'queue' : 'current');
      if (tracks.length === 0) return res.status(409).json({ error: 'Nothing is playing right now.' });
    }
    const result = library.addToPlaylist(userIdOf(req), req.params.playlistId, tracks);
    if (!result.ok) return res.status(result.reason === 'missing' ? 404 : 409).json({ error: ADD_FAILURES[result.reason], reason: result.reason });
    return res.json({ success: true, playlist: result.playlist, added: result.added, skipped: result.skipped });
  });

  router.post(`${base}/playlists/:playlistId/remove`, ...mutate, (req, res) => {
    const index = Number(req.body?.index);
    if (!library.removeFromPlaylist(userIdOf(req), req.params.playlistId, index)) {
      return res.status(404).json({ error: 'Track not found in this playlist.' });
    }
    const playlist = library.getPlaylist(userIdOf(req), req.params.playlistId);
    return res.json({ success: true, playlist: { ...playlist, tracks: playlist.tracks.map(publicEntry) } });
  });

  router.post(`${base}/playlists/:playlistId/delete`, ...mutate, (req, res) => {
    if (!library.deletePlaylist(userIdOf(req), req.params.playlistId)) return res.status(404).json({ error: 'Playlist not found.' });
    return res.json({ success: true });
  });

  router.post(`${base}/playlists/:playlistId/share`, ...mutate, (req, res) => {
    const result = library.setPlaylistShared(userIdOf(req), req.params.playlistId, req.body?.enabled !== false);
    if (!result.ok) return res.status(404).json({ error: ADD_FAILURES.missing });
    return res.json({ success: true, playlist: result.playlist, code: result.code });
  });

  // Loads a Spotify / YouTube / SoundCloud playlist link through Lavalink and saves it,
  // or copies another user's playlist from its share code.
  router.post(`${base}/import`, ...mutate, async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const shareCode = library.parseShareCode(url);
    if (shareCode) {
      const copied = library.importShared(userIdOf(req), shareCode, req.body?.name);
      if (!copied.ok) {
        const status = copied.reason === 'unknown' ? 404 : 409;
        return res.status(status).json({ error: SHARE_FAILURES[copied.reason] ?? CREATE_FAILURES[copied.reason], reason: copied.reason });
      }
      return res.json({ success: true, playlist: copied.playlist, added: copied.added, skipped: copied.skipped });
    }
    if (!isPlaylistUrl(url)) return res.status(400).json({ error: 'Paste a playlist link or a share code.' });
    const node = getUsableNode(client);
    if (!node) return res.status(503).json({ error: 'No Lavalink node available' });

    let result;
    try {
      result = await node.search({ query: url }, getDashboardRequester(req, client));
    } catch (error) {
      console.warn('[Library] Import failed:', error.message);
      return res.status(502).json({ error: 'Could not load that link.' });
    }
    const tracks = result?.tracks ?? [];
    if (tracks.length === 0) return res.status(404).json({ error: 'No tracks found at that link.' });

    const created = library.createPlaylistWithFreeName(userIdOf(req), req.body?.name || result?.playlist?.name || 'Imported', tracks);
    if (!created.ok) return res.status(created.reason === 'limit' ? 409 : 400).json({ error: CREATE_FAILURES[created.reason], reason: created.reason });
    return res.json({ success: true, playlist: created.playlist, added: created.added, skipped: created.skipped });
  });

  return router;
}

module.exports = { createLibraryRouter, publicEntry, isPlaylistUrl };
