const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSearchService, validateQuery } = require('./service.cjs');
const track = { info: { title: 'Actual track', author: 'An artist', length: 120000, uri: 'https://www.youtube.com/watch?v=example', sourceName: 'youtube', isSeekable: true, isStream: false, artworkUrl: 'https://i.ytimg.com/vi/example/hqdefault.jpg' } };
test('search accepts only supported HTTPS providers and safe search prefixes', () => {
  assert.equal(validateQuery('some artist'), 'ytsearch:some artist');
  assert.equal(validateQuery('scsearch:artist'), 'scsearch:artist');
  assert.equal(validateQuery('https://youtu.be/example'), 'https://youtu.be/example');
  for (const value of ['http://127.0.0.1', 'file:///etc/passwd', 'https://youtube.com.evil.test/a', 'https://user:pass@youtube.com/a', 'https://youtube.com:8443/a', 'spsearch:artist', 'https://open.spotify.com/track/x', 'x', 'x'.repeat(201), null, 'hello\nthere']) assert.throws(() => validateQuery(value));
});
test('real presenters receive metadata, cache works, no encoded track is exposed', async () => {
  let calls = 0;
  const service = createSearchService({ request: async url => { calls++; assert.match(url, /\/v4\/loadtracks\?identifier=ytsearch/); return Response.json({ loadType: 'search', data: [track] }); } });
  const result = await service.search('an artist');
  assert.equal(result.tracks[0].duration, '2:00');
  assert.match(result.tracks[0].embeds.added.description, /Actual track/);
  assert.match(result.tracks[0].artwork, /^\/demo\/api\/artwork\?id=[a-f0-9]{32}$/);
  assert.equal(result.tracks[0].encoded, undefined);
  assert.deepEqual(await service.search('an artist'), result); assert.equal(calls, 1);
});
test('playlist limit, unknown artwork and source failures are handled', async () => {
  const service = createSearchService({ request: async () => Response.json({ loadType: 'playlist', data: { info: { name: 'Playlist' }, tracks: Array(60).fill(track) } }) });
  const result = await service.search('https://youtube.com/playlist?list=example');
  assert.equal(result.tracks.length, 50); assert.equal(result.playlist.total, 60); assert.equal(result.playlist.truncated, true);
  await assert.rejects(service.artwork('unknown'), /not found/);
  const broken = createSearchService({ request: async () => Response.json({ loadType: 'error' }) });
  await assert.rejects(broken.search('some artist'), /source could not/);
});
test('rate limiting also applies to cached requests and resets', async () => {
  let now = 0;
  const service = createSearchService({ now: () => now, request: async () => Response.json({ loadType: 'empty' }) });
  for (let i = 0; i < 30; i++) await service.search('query');
  await assert.rejects(service.search('query'), error => error.status === 429);
  now = 60001; assert.deepEqual((await service.search('query')).tracks, []);
});
test('arbitrary remote artwork is never accepted', async () => {
  const service = createSearchService({ request: async () => Response.json({ loadType: 'search', data: [{ info: { ...track.info, artworkUrl: 'http://localhost/private' } }] }) });
  const result = await service.search('query');
  assert.equal(result.tracks[0].artwork, undefined);
  assert.equal(result.tracks[0].embeds.added.thumbnail, undefined);
});

test('artwork is cached with a bounded lifetime and rejects large payloads', async () => {
  let now = 0; let images = 0;
  const service = createSearchService({ now: () => now, request: async url => {
    if (url.includes('/v4/loadtracks')) return Response.json({ loadType: 'search', data: [track] });
    images++; return new Response(Buffer.alloc(20), { headers: { 'content-type': 'image/png' } });
  } });
  const result = await service.search('query');
  const id = new URL(result.tracks[0].artwork, 'https://bread.example').searchParams.get('id');
  await service.artwork(id); await service.artwork(id); assert.equal(images, 1);
  now = 300001; await service.artwork(id); assert.equal(images, 2);
  const huge = createSearchService({ request: async url => url.includes('/v4/loadtracks') ? Response.json({ loadType: 'search', data: [track] }) : new Response(Buffer.alloc(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }) });
  await huge.search('query'); await assert.rejects(huge.artwork(id), /too large/);
});

test('huge provider playlists are rejected before JSON parsing', async () => {
  const service = createSearchService({ request: async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)) });
  await assert.rejects(service.search('query'), /response too large/);
});
