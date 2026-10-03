const test = require('node:test');
const assert = require('node:assert/strict');
const {
  searchTracks,
  collectCandidates,
  toMusicQuery,
  searchSource,
} = require('../src/music/autoplay/sources');

function track(title, author, identifier) {
  return { info: { title, author, identifier, duration: 180_000 } };
}

function fakeNode(handler) {
  const calls = [];
  return {
    calls,
    connected: true,
    async search({ query }) {
      calls.push(query);
      return handler(query);
    },
  };
}

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('ytmsearch empty falls back to ytsearch', async () => {
  const node = fakeNode((query) => ({
    tracks: query.startsWith('ytmsearch:') ? [] : [track('Video', 'Channel', 'vvvvvvvvvvv')],
  }));

  const tracks = await searchTracks(node, 'x');

  assert.deepEqual(node.calls, ['ytmsearch:x', 'ytsearch:x']);
  assert.equal(tracks[0].info.title, 'Video');
});

test('ytmsearch error falls back to ytsearch', async () => {
  const node = fakeNode((query) => {
    if (query.startsWith('ytmsearch:')) throw new Error('boom');
    return { tracks: [track('Video', 'Channel', 'vvvvvvvvvvv')] };
  });

  const tracks = await searchTracks(node, 'x', { fallbackQuery: 'x official audio' });

  assert.deepEqual(node.calls, ['ytmsearch:x', 'ytsearch:x official audio']);
  assert.equal(tracks.length, 1);
});

test('music results are used directly without a video search', async () => {
  const node = fakeNode(() => ({ tracks: [track('Song', 'Artist', 'sssssssssss')] }));

  await searchTracks(node, 'x');

  assert.deepEqual(node.calls, ['ytmsearch:x']);
});

test('disconnected node yields no candidates', async () => {
  const node = fakeNode(() => ({ tracks: [track('Song', 'Artist', 'sssssssssss')] }));
  node.connected = false;

  assert.deepEqual(await searchTracks(node, 'x'), []);
  assert.deepEqual(node.calls, []);
});

test('collectCandidates drops sources past budget', async () => {
  const startedAt = Date.now();
  const result = await collectCandidates([
    { name: 'fast', run: () => delay(10, [{ source: 'fast' }]) },
    { name: 'slow', run: () => delay(200, [{ source: 'slow' }]) },
  ], { budgetMs: 50 });

  assert.deepEqual(result.map((entry) => entry.source), ['fast']);
  assert.ok(Date.now() - startedAt < 150);
});

test('collectCandidates isolates failures', async () => {
  const result = await collectCandidates([
    { name: 'broken', run: async () => { throw new Error('nope'); } },
    { name: 'ok', run: async () => [{ source: 'ok' }] },
  ], { budgetMs: 100 });

  assert.deepEqual(result.map((entry) => entry.source), ['ok']);
});

test('music queries drop video-search phrasing', () => {
  assert.equal(toMusicQuery('deftones change radio'), 'deftones change');
  assert.equal(toMusicQuery('deftones radio mix'), 'deftones');
  assert.equal(toMusicQuery('deftones official audio'), 'deftones');
});

test('search source collapses duplicate music queries but keeps every anchor', async () => {
  const anchor = { key: 'id:aaaaaaaaaaa', artist: 'deftones', title: 'Change', cleanTitle: 'Change', duration: 180_000 };
  const context = {
    activeSeeds: [anchor],
    primary: anchor,
    recent: [],
    seedArtist: 'deftones',
  };
  const node = fakeNode(() => ({ tracks: [track('Song', 'Deftones', 'sssssssssss')] }));

  const candidates = await searchSource({ node, context }).run();

  assert.deepEqual(node.calls.sort(), ['ytmsearch:deftones', 'ytmsearch:deftones Change']);
  assert.ok(candidates.every((entry) => entry.anchorKey === anchor.key));
});
