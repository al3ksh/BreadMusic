const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-library-routes-'));

const library = require('../src/music/library');
const { createLibraryRouter, isPlaylistUrl } = require('../src/routes/library');
const { createPlayerRouter } = require('../src/routes/player');
const { closeDatabases } = require('../src/state/sqliteStore');

test.after(() => {
  closeDatabases();
  fs.rmSync(process.env.BREAD_DATA_DIR, { recursive: true, force: true });
});

const guildId = 'library-guild';

function track(title, identifier, extra = {}) {
  return {
    encoded: `enc-${identifier}`,
    info: { title, author: 'Bread Band', identifier, uri: `https://www.youtube.com/watch?v=${identifier}`, duration: 180_000, sourceName: 'youtube' },
    ...extra,
  };
}

let userCounter = 0;

async function withApp(options, callback) {
  const userId = `route-user-${++userCounter}`;
  const calls = [];
  const player = {
    queue: {
      current: options.current === undefined ? track('Now', 'now00000001') : options.current,
      tracks: options.queue ?? [],
      async add(tracks) { this.tracks.push(...tracks); },
    },
    voiceChannelId: 'voice',
    textChannelId: 'text',
    playing: true,
    paused: false,
    async play() { calls.push('play'); },
  };
  const guild = {
    members: { me: { voice: { channelId: 'voice' } } },
    channels: { cache: new Map([['voice', { name: 'General', isVoiceBased: () => true }], ['elsewhere', { name: 'Other', isVoiceBased: () => true }]]) },
  };
  const client = {
    guilds: { cache: new Map([[guildId, guild]]) },
    lavalink: { players: new Map([[guildId, player]]) },
    musicUI: { refresh: async () => {} },
  };
  const next = (_req, _res, proceed) => proceed();
  const requirePlayerAccess = (req, _res, proceed) => {
    req.guildMember = { voice: { channelId: options.memberChannel ?? 'voice' } };
    req.dashboardCapabilities = { canControlPlayer: options.privileged === true, canQueue: options.canQueue !== false };
    proceed();
  };
  const getRequestUser = () => ({ id: userId });
  const getDashboardRequester = () => ({ id: userId, username: 'tester' });
  const node = {
    async search({ query }) {
      calls.push(['search', query]);
      return options.searchResult ?? { loadType: 'empty', tracks: [] };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(createLibraryRouter({
    client,
    library,
    requireAuth: next,
    requirePlayerAccess,
    requireTrustedOrigin: next,
    requireDashboardActionRateLimit: next,
    getRequestUser,
    getDashboardRequester,
    getUsableNode: () => node,
  }));
  app.use(createPlayerRouter({
    client,
    library,
    requireAuth: next,
    requirePlayerAccess,
    requireTrustedOrigin: next,
    requireDashboardActionRateLimit: next,
    acquireGuildMutex: async () => () => {},
    broadcastPlayerUpdate: () => {},
    getConfig: () => ({}),
    resolvePlayerTextChannelId: () => 'text',
    savePlayerState: async () => {},
    getDashboardRequester,
    getRequestUser,
    addManualSeed: (_guildId, seed) => calls.push(['seed', seed.info.title]),
    clearAutoplayPrefetch: () => {},
    likeTrack: () => ({ liked: options.guildLiked ?? true }),
  }));

  const server = app.listen(0);
  const url = (suffix) => `http://127.0.0.1:${server.address().port}/api/guilds/${guildId}${suffix}`;
  const request = async (method, suffix, body) => {
    const response = await fetch(url(suffix), {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await callback({ get: (suffix) => request('GET', suffix), post: (suffix, body = {}) => request('POST', suffix, body), userId, player, calls });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('playlists are saved from the queue and never leak encoded tracks', async () => {
  await withApp({ queue: [track('Next', 'next0000001')] }, async ({ get, post }) => {
    const created = await post('/library/playlists', { name: 'Evening', from: 'queue' });
    assert.equal(created.status, 200);
    assert.equal(created.body.added, 2);

    const duplicate = await post('/library/playlists', { name: 'evening', from: 'empty' });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.reason, 'exists');

    const snapshot = await get('/library');
    assert.equal(snapshot.body.playlists[0].trackCount, 2);
    const detail = await get(`/library/playlists/${created.body.playlist.id}`);
    assert.deepEqual(detail.body.tracks.map((entry) => entry.title), ['Now', 'Next']);
    assert.equal(detail.body.tracks[0].encoded, undefined);
  });
});

test('the current track is added to a playlist, removed and the playlist deleted', async () => {
  await withApp({}, async ({ post, get }) => {
    const { body } = await post('/library/playlists', { name: 'Keep', from: 'empty' });
    const id = body.playlist.id;
    assert.equal((await post(`/library/playlists/${id}/add`, { from: 'current' })).body.added, 1);
    assert.equal((await post(`/library/playlists/${id}/add`, { from: 'current' })).body.added, 0);
    const removed = await post(`/library/playlists/${id}/remove`, { index: 0 });
    assert.equal(removed.body.playlist.trackCount, 0);
    assert.equal((await post(`/library/playlists/${id}/remove`, { index: 0 })).status, 404);
    assert.equal((await post(`/library/playlists/${id}/delete`)).status, 200);
    assert.equal((await get(`/library/playlists/${id}`)).status, 404);
  });
});

test('saving with nothing playing is a readable 409', async () => {
  await withApp({ current: null }, async ({ post }) => {
    const result = await post('/library/playlists', { name: 'Empty', from: 'current' });
    assert.equal(result.status, 409);
    assert.match(result.body.error, /Nothing is playing/);
  });
});

test('imports load the link through Lavalink and pick a free name', async () => {
  const searchResult = { loadType: 'playlist', playlist: { name: 'Road Mix' }, tracks: [track('R1', 'r1'), track('R2', 'r2')] };
  await withApp({ searchResult }, async ({ post, calls }) => {
    const first = await post('/library/import', { url: 'https://open.spotify.com/playlist/abc' });
    assert.equal(first.status, 200);
    assert.equal(first.body.playlist.name, 'Road Mix');
    assert.equal(first.body.added, 2);
    assert.deepEqual(calls[0], ['search', 'https://open.spotify.com/playlist/abc']);

    const second = await post('/library/import', { url: 'https://open.spotify.com/playlist/abc' });
    assert.equal(second.body.playlist.name, 'Road Mix (2)');
    assert.equal((await post('/library/import', { url: 'not a link' })).status, 400);
  });
  await withApp({}, async ({ post }) => {
    assert.equal((await post('/library/import', { url: 'https://youtube.com/playlist?list=x' })).status, 404);
  });
});

test('history links are liked and added to playlists through Lavalink', async () => {
  const searchResult = { loadType: 'track', tracks: [track('Old song', 'old00000001')] };
  await withApp({ searchResult }, async ({ post, get, userId, calls }) => {
    const liked = await post('/library/liked/add', { uri: 'https://www.youtube.com/watch?v=old00000001' });
    assert.equal(liked.status, 200);
    assert.equal(liked.body.title, 'Old song');
    assert.deepEqual(calls[0], ['search', 'https://www.youtube.com/watch?v=old00000001']);
    assert.deepEqual((await get('/library')).body.liked.map((entry) => entry.title), ['Old song']);

    library.createPlaylist(userId, 'Later', []);
    const added = await post('/library/playlists/later/add', { from: 'uri', uri: 'https://www.youtube.com/watch?v=old00000001' });
    assert.equal(added.status, 200);
    assert.equal(added.body.added, 1);
    assert.equal((await post('/library/liked/add', { uri: 'local upload' })).status, 400);
  });
  await withApp({}, async ({ post }) => {
    assert.equal((await post('/library/liked/add', { uri: 'https://www.youtube.com/watch?v=gone' })).status, 404);
  });
});

test('the library player action queues a playlist for listeners with queue rights', async () => {
  await withApp({}, async ({ post, userId, player, calls }) => {
    library.createPlaylist(userId, 'Set', [track('S1', 's1'), track('S2', 's2')]);
    const result = await post('/player/library', { playlistId: 'set' });
    assert.equal(result.status, 200);
    assert.equal(result.body.count, 2);
    assert.deepEqual(player.queue.tracks.map((entry) => entry.encoded), ['enc-s1', 'enc-s2']);
    assert.equal(player.queue.tracks[0].requester.id, userId);
    assert.deepEqual(calls.filter((call) => call[0] === 'seed').map((call) => call[1]), ['S1', 'S2']);
    assert.equal((await post('/player/library', { playlistId: 'nope' })).status, 404);
  });
  await withApp({ canQueue: false }, async ({ post }) => {
    assert.equal((await post('/player/library', { playlistId: 'liked' })).status, 403);
  });
  await withApp({ memberChannel: 'elsewhere' }, async ({ post, userId }) => {
    library.setLiked(userId, track('L', 'l1'), true);
    assert.equal((await post('/player/library', { playlistId: 'liked' })).status, 409);
  });
});

test('liked tracks play before autoplay suggestions', async () => {
  const autoplayTrack = { ...track('Auto', 'auto0000001'), isAutoplay: true };
  await withApp({ queue: [autoplayTrack] }, async ({ post, userId, player }) => {
    library.setLiked(userId, track('L1', 'l1'), true);
    assert.equal((await post('/player/library', { playlistId: 'liked' })).status, 200);
    assert.deepEqual(player.queue.tracks.map((entry) => entry.info.title), ['L1', 'Auto']);
  });
});

test('the badge like syncs into the listener Liked list', async () => {
  await withApp({ guildLiked: true }, async ({ post, get, userId }) => {
    assert.equal((await post('/player/autoplay_like')).status, 200);
    assert.deepEqual((await get('/library')).body.liked.map((entry) => entry.title), ['Now']);
    assert.equal(library.isLiked(userId, track('Now', 'now00000001')), true);
  });
});

test('playlist links must be http(s)', () => {
  assert.equal(isPlaylistUrl('https://soundcloud.com/a/sets/b'), true);
  assert.equal(isPlaylistUrl('javascript:alert(1)'), false);
  assert.equal(isPlaylistUrl(42), false);
});

test('a shared playlist is copied by another listener through the import box', async () => {
  let code;
  await withApp({ queue: [track('Next', 'next0000001')] }, async ({ post }) => {
    const created = await post('/library/playlists', { name: 'Shared mix', from: 'queue' });
    const shared = await post(`/library/playlists/${created.body.playlist.id}/share`);
    assert.equal(shared.status, 200);
    code = shared.body.code;
    assert.equal(shared.body.playlist.shareCode, code);
    assert.equal((await post('/library/import', { url: code })).body.reason, 'own');
    assert.equal((await post('/library/playlists/missing/share')).status, 404);
  });
  await withApp({}, async ({ get, post, calls }) => {
    const copied = await post('/library/import', { url: ` ${code.toLowerCase()} ` });
    assert.equal(copied.status, 200);
    assert.equal(copied.body.added, 2);
    assert.equal(copied.body.playlist.name, 'Shared mix');
    assert.equal(calls.some((call) => call[0] === 'search'), false);
    assert.equal((await get('/library')).body.playlists[0].shareCode, null);
    assert.equal((await post('/library/import', { url: 'ZZZZZZZZ' })).status, 404);
    assert.equal((await post('/library/import', { url: 'nope' })).body.error, 'Paste a playlist link or a share code.');
  });
});
