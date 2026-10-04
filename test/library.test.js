const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-library-'));

const library = require('../src/music/library');
const { closeDatabases } = require('../src/state/sqliteStore');

test.after(() => {
  closeDatabases();
  fs.rmSync(process.env.BREAD_DATA_DIR, { recursive: true, force: true });
});

function track(title, identifier, extra = {}) {
  return {
    encoded: `enc-${identifier}`,
    info: {
      title,
      author: 'Bread Band',
      identifier,
      uri: `https://www.youtube.com/watch?v=${identifier}`,
      duration: 200_000,
      sourceName: 'youtube',
      ...extra,
    },
  };
}

let userCounter = 0;
const nextUser = () => `user-${++userCounter}`;

test('likes toggle per user and survive a restart', () => {
  const alice = nextUser();
  const bob = nextUser();
  assert.deepEqual(library.toggleLiked(alice, track('One', 'aaaaaaaaaa1')), { liked: true });
  library.toggleLiked(alice, track('Two', 'aaaaaaaaaa2'));
  assert.equal(library.isLiked(alice, track('One', 'aaaaaaaaaa1')), true);
  assert.equal(library.isLiked(bob, track('One', 'aaaaaaaaaa1')), false);

  library.flush();
  library.__testing.resetForTesting();

  assert.deepEqual(library.listLiked(alice).map((entry) => entry.title), ['Two', 'One']);
  assert.deepEqual(library.toggleLiked(alice, track('One', 'aaaaaaaaaa1')), { liked: false });
  assert.deepEqual(library.listLiked(alice).map((entry) => entry.title), ['Two']);
  assert.equal(library.removeLiked(alice, 'id:aaaaaaaaaa2'), true);
  assert.deepEqual(library.listLiked(alice), []);
});

test('uploads, streams and tracks without encoded data cannot be saved', () => {
  const user = nextUser();
  assert.equal(library.toggleLiked(user, track('Live', 'live0000001', { isStream: true })), null);
  assert.equal(library.toggleLiked(user, track('Upload', 'up', { uri: 'https://bread.test/api/uploads/x.mp3' })), null);
  assert.equal(library.toggleLiked(user, { info: track('Raw', 'raw00000001').info }), null);
  assert.deepEqual(library.listLiked(user), []);
});

test('setLiked is idempotent and the liked list is capped', () => {
  const user = nextUser();
  library.setLiked(user, track('Same', 'same0000001'), true);
  library.setLiked(user, track('Same', 'same0000001'), true);
  assert.equal(library.listLiked(user).length, 1);

  for (let index = 0; index < library.LIBRARY_LIMITS.liked + 5; index += 1) {
    library.setLiked(user, track(`Song ${index}`, `cap${index}`), true, index);
  }
  const liked = library.listLiked(user);
  assert.equal(liked.length, library.LIBRARY_LIMITS.liked);
  assert.equal(liked[0].title, `Song ${library.LIBRARY_LIMITS.liked + 4}`);
});

test('playlists are created, found by name, extended without duplicates and deleted', () => {
  const user = nextUser();
  const created = library.createPlaylist(user, '  Road   trip ', [track('A', 'a'), track('B', 'b'), track('A', 'a')], 1);
  assert.equal(created.ok, true);
  assert.equal(created.playlist.name, 'Road trip');
  assert.equal(created.added, 2);
  assert.equal(created.skipped, 1);

  assert.deepEqual(library.createPlaylist(user, 'road TRIP'), { ok: false, reason: 'exists' });
  assert.deepEqual(library.createPlaylist(user, '   '), { ok: false, reason: 'name' });

  const added = library.addToPlaylist(user, 'ROAD TRIP', [track('B', 'b'), track('C', 'c')], 2);
  assert.equal(added.added, 1);
  assert.equal(added.playlist.trackCount, 3);
  assert.equal(added.playlist.duration, 600_000);

  const playlist = library.getPlaylist(user, created.playlist.id);
  assert.deepEqual(playlist.tracks.map((entry) => entry.title), ['A', 'B', 'C']);
  assert.equal(library.removeFromPlaylist(user, created.playlist.id, 1), true);
  assert.equal(library.removeFromPlaylist(user, created.playlist.id, 9), false);
  assert.deepEqual(library.getPlaylist(user, 'road trip').tracks.map((entry) => entry.title), ['A', 'C']);

  assert.equal(library.getPlaylist(nextUser(), created.playlist.id), null);
  assert.equal(library.deletePlaylist(user, 'Road trip'), true);
  assert.deepEqual(library.listPlaylists(user), []);
});

test('playlist count is limited', () => {
  const user = nextUser();
  for (let index = 0; index < library.LIBRARY_LIMITS.playlists; index += 1) {
    assert.equal(library.createPlaylist(user, `List ${index}`).ok, true);
  }
  assert.deepEqual(library.createPlaylist(user, 'One too many'), { ok: false, reason: 'limit' });
});

test('resolvePlayable returns liked or playlist entries that turn back into tracks', () => {
  const user = nextUser();
  library.setLiked(user, track('Fav', 'fav00000001'), true);
  library.createPlaylist(user, 'Mix', [track('M1', 'm1'), track('M2', 'm2')]);

  assert.deepEqual(library.resolvePlayable(user, library.LIKED_ID).tracks.map((entry) => entry.title), ['Fav']);
  const mix = library.resolvePlayable(user, 'mix');
  assert.equal(mix.name, 'Mix');
  const rebuilt = library.entryToTrack(mix.tracks[0], { id: user });
  assert.equal(rebuilt.encoded, 'enc-m1');
  assert.equal(rebuilt.info.identifier, 'm1');
  assert.equal(rebuilt.requester.id, user);
  assert.equal(library.resolvePlayable(user, 'missing'), null);
});

test('shuffled keeps every item', () => {
  const items = [1, 2, 3, 4, 5];
  const result = library.shuffled(items, () => 0);
  assert.deepEqual([...result].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5]);
});

test('share codes copy a playlist to another user and can be revoked', () => {
  const owner = nextUser();
  const friend = nextUser();
  library.createPlaylist(owner, 'Party', [track('P1', 'pppppppppp1'), track('P2', 'pppppppppp2')]);
  assert.deepEqual(library.setPlaylistShared(owner, 'missing'), { ok: false, reason: 'missing' });

  const shared = library.setPlaylistShared(owner, 'party');
  assert.match(shared.code, /^[A-HJ-KM-NP-Z2-9]{8}$/);
  assert.equal(library.setPlaylistShared(owner, 'Party').code, shared.code);
  assert.equal(library.listPlaylists(owner)[0].shareCode, shared.code);
  assert.equal(library.parseShareCode(`${shared.code.slice(0, 4).toLowerCase()}-${shared.code.slice(4)}`), shared.code);
  assert.equal(library.parseShareCode('https://example.com'), null);

  assert.deepEqual(library.importShared(owner, shared.code), { ok: false, reason: 'own' });
  const copied = library.importShared(friend, shared.code);
  assert.equal(copied.ok, true);
  assert.equal(copied.added, 2);
  assert.equal(copied.playlist.shareCode, null);
  assert.deepEqual(library.getPlaylist(friend, 'Party').tracks.map((entry) => entry.encoded), ['enc-pppppppppp1', 'enc-pppppppppp2']);
  assert.equal(library.importShared(friend, shared.code).playlist.name, 'Party (2)');

  // The copy is independent of later edits, and a revoked code stops working.
  library.removeFromPlaylist(owner, 'Party', 0);
  assert.equal(library.getPlaylist(friend, 'Party').trackCount, 2);
  assert.equal(library.setPlaylistShared(owner, 'Party', false).code, null);
  assert.deepEqual(library.importShared(friend, shared.code), { ok: false, reason: 'unknown' });
});

test('saved radio stations: newest first, toggled off, capped', () => {
  const station = (id, name = id) => ({ id, source: 'radio-browser', name, url: 'http://secret/stream', tags: ['pop'], favicon: 'http://insecure/icon.png' });
  assert.equal(library.saveStation('station-user', { id: '' }).reason, 'invalid');
  assert.deepEqual(library.saveStation('station-user', station('a', 'Alpha'), 1), { ok: true, saved: true });
  library.saveStation('station-user', station('garden:b', 'Beta'), 2);
  const [first, second] = library.listStations('station-user');
  assert.equal(first.id, 'garden:b');
  assert.equal(second.name, 'Alpha');
  assert.equal(second.url, undefined, 'the stream link is resolved again at play time');
  assert.equal(second.favicon, '');
  assert.equal(library.isStationSaved('station-user', 'a'), true);
  assert.equal(library.getLibrarySnapshot('station-user').stations.length, 2);

  assert.equal(library.removeStation('station-user', 'a'), true);
  assert.equal(library.removeStation('station-user', 'a'), false);
  assert.equal(library.isStationSaved('station-user', 'a'), false);

  for (let i = 0; i < library.LIBRARY_LIMITS.stations - 1; i += 1) library.saveStation('station-user', station(`s${i}`));
  assert.equal(library.saveStation('station-user', station('one-too-many')).reason, 'limit');
  assert.equal(library.saveStation('station-user', station('garden:b', 'Beta again')).ok, true, 'saving again only refreshes it');
});
