const test = require('node:test');
const assert = require('node:assert/strict');
const { createLastfmClient, BREAKER_MS, CACHE_TTL_MS } = require('../src/music/autoplay/lastfm');
const { lastfmSource, buildLastfmSuggestions, lastfmSeedQuery } = require('../src/music/autoplay/sources');
const { scoreCandidate } = require('../src/music/autoplay/scoring');
const { normalizeTrack } = require('../src/music/autoplay/normalize');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function similarTracks(...entries) {
  return {
    similartracks: {
      track: entries.map(([artist, name, match]) => ({ name, match: String(match), artist: { name: artist } })),
    },
  };
}

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    const params = Object.fromEntries(new URL(url).searchParams);
    calls.push(params);
    return handler(params);
  };
  return { calls, fetchImpl };
}

function clock(start = 1_000_000) {
  let value = start;
  const now = () => value;
  now.advance = (ms) => { value += ms; };
  return now;
}

test('disabled without an API key', async () => {
  const { calls, fetchImpl } = fakeFetch(() => jsonResponse(similarTracks()));
  const client = createLastfmClient({ apiKey: '', fetchImpl });
  assert.equal(client.isEnabled(), false);
  assert.deepEqual(client.getStatus(), { enabled: false, available: false, retryAt: null });
  assert.deepEqual(await client.getSimilarTracks({ artist: 'A', title: 'B' }), []);
  assert.equal(calls.length, 0);
});

test('parses similar tracks sorted by match and caches them', async () => {
  const now = clock();
  const { calls, fetchImpl } = fakeFetch(() => jsonResponse(similarTracks(
    ['Papa Roach', 'Last Resort', 0.4],
    ['Slipknot', 'Duality', 1],
    ['', 'Broken', 0.9],
  )));
  const client = createLastfmClient({ apiKey: 'k', fetchImpl, now });

  const first = await client.getSimilarTracks({ artist: 'Linkin Park', title: 'Lost' });
  assert.deepEqual(first, [
    { title: 'Duality', artist: 'Slipknot', match: 1 },
    { title: 'Last Resort', artist: 'Papa Roach', match: 0.4 },
  ]);
  assert.equal(calls[0].method, 'track.getSimilar');
  assert.equal(calls[0].artist, 'Linkin Park');
  assert.equal(calls[0].track, 'Lost');

  await client.getSimilarTracks({ artist: 'linkin park', title: 'LOST' });
  assert.equal(calls.length, 1, 'same seed is served from the cache');

  now.advance(CACHE_TTL_MS + 1);
  await client.getSimilarTracks({ artist: 'Linkin Park', title: 'Lost' });
  assert.equal(calls.length, 2, 'cache expires after 6 hours');
});

test('an unknown track is a cached empty result, not a breaker trip', async () => {
  const { calls, fetchImpl } = fakeFetch(() => jsonResponse({ error: 6, message: 'Track not found' }, 404));
  const client = createLastfmClient({ apiKey: 'k', fetchImpl });
  assert.deepEqual(await client.getSimilarTracks({ artist: 'Nobody', title: 'Nothing' }), []);
  assert.deepEqual(await client.getSimilarTracks({ artist: 'Nobody', title: 'Nothing' }), []);
  assert.equal(calls.length, 1);
  assert.equal(client.getStatus().available, true);
});

test('429 and 5xx open a five minute breaker', async () => {
  for (const failure of [jsonResponse({}, 429), jsonResponse({}, 503), jsonResponse({ error: 29, message: 'Rate limit' })]) {
    const now = clock();
    let fail = true;
    const { calls, fetchImpl } = fakeFetch(() => (fail ? failure : jsonResponse(similarTracks(['B', 'Song', 0.5]))));
    const client = createLastfmClient({ apiKey: 'k', fetchImpl, now });

    assert.deepEqual(await client.getSimilarTracks({ artist: 'A', title: 'One' }), []);
    assert.equal(client.getStatus().available, false);
    assert.equal(client.getStatus().retryAt, now() + BREAKER_MS);

    fail = false;
    assert.deepEqual(await client.getSimilarTracks({ artist: 'A', title: 'Two' }), []);
    assert.equal(calls.length, 1, 'no requests while the breaker is open');

    now.advance(BREAKER_MS + 1);
    assert.equal((await client.getSimilarTracks({ artist: 'A', title: 'Two' })).length, 1);
    assert.equal(client.getStatus().available, true);
  }
});

test('network errors and timeouts return nothing without opening the breaker', async () => {
  const client = createLastfmClient({ apiKey: 'k', fetchImpl: async () => { throw new Error('aborted'); } });
  assert.deepEqual(await client.getSimilarArtists('A'), []);
  assert.equal(client.getStatus().available, true);
});

function seed(title, author, identifier) {
  return normalizeTrack({ info: { title, author, identifier, uri: `https://youtu.be/${identifier}`, duration: 200_000 } });
}

function fakeClient({ tracks = {}, artists = {} } = {}) {
  return {
    isEnabled: () => true,
    // Last.fm autocorrects case, so the fake ignores it too.
    getSimilarTracks: async ({ artist, title }) => tracks[`${artist}|${title}`.toLowerCase()] ?? [],
    getSimilarArtists: async (artist) => artists[artist.toLowerCase()] ?? [],
  };
}

function context(activeSeeds, extra = {}) {
  return {
    activeSeeds,
    recent: [],
    taste: { dislikedArtistCounts: new Map() },
    ...extra,
  };
}

test('suggestions interleave both seeds, cap each artist and skip seed artists, disliked and recent', async () => {
  const first = seed('Lost', 'Linkin Park', 'lplplplplp1');
  const second = seed('Chop Suey', 'System Of A Down', 'soadsoadso1');
  const client = fakeClient({
    tracks: {
      'linkin park|lost': [
        { artist: 'Linkin Park', title: 'Numb', match: 1 },
        { artist: 'Papa Roach', title: 'Last Resort', match: 1 },
        { artist: 'Papa Roach', title: 'Scars', match: 0.9 },
        { artist: 'Papa Roach', title: 'Getting Away With Murder', match: 0.8 },
        { artist: 'Nickelback', title: 'Photograph', match: 0.7 },
        { artist: 'Staind', title: 'Outside', match: 0.6 },
      ],
      'system of a down|chop suey': [
        { artist: 'Slipknot', title: 'Duality', match: 1 },
        { artist: 'Korn', title: 'Freak On A Leash', match: 0.9 },
      ],
    },
  });
  const recent = [seed('Outside', 'Staind', 'stainds0001')];
  const ctx = context([first, second], {
    recent,
    taste: { dislikedArtistCounts: new Map([['nickelback', 1]]) },
  });

  const picked = await buildLastfmSuggestions(client, ctx);
  assert.deepEqual(picked.map((entry) => `${entry.artist} - ${entry.title}`), [
    'Papa Roach - Last Resort',
    'Slipknot - Duality',
    'Papa Roach - Scars',
    'Korn - Freak On A Leash',
  ]);
  assert.equal(picked[1].anchorKey, second.key);
  assert.equal(picked[1].anchorRank, 1);
});

test('a seed Last.fm does not know falls back to similar artists', async () => {
  const client = fakeClient({ artists: { obscure: [{ name: 'Neighbour', match: 0.5 }] } });
  const picked = await buildLastfmSuggestions(client, context([seed('Unknown Song', 'Obscure', 'obscure0001')]));
  assert.deepEqual(picked, [{ artist: 'Neighbour', title: null, match: 0.4, anchorKey: picked[0].anchorKey, anchorRank: 0 }]);
});

test('lastfm source resolves suggestions through music search and drops wrong matches', async () => {
  const queries = [];
  const node = {
    connected: true,
    async search({ query }) {
      queries.push(query);
      if (query === 'ytmsearch:Slipknot Duality') {
        return { tracks: [{ info: { title: 'Duality', author: 'Slipknot', identifier: 'duality0001', duration: 250_000 } }] };
      }
      return { tracks: [{ info: { title: 'Totally Different', author: 'Someone', identifier: 'differ00001', duration: 200_000 } }] };
    },
  };
  const client = fakeClient({
    tracks: { 'linkin park|lost': [{ artist: 'Slipknot', title: 'Duality', match: 0.75 }, { artist: 'Korn', title: 'Blind', match: 0.5 }] },
  });

  const source = lastfmSource({ node, requester: null, context: context([seed('Lost', 'Linkin Park', 'lplplplplp1')]), client });
  const candidates = await source.run();

  assert.deepEqual(queries.sort(), ['ytmsearch:Korn Blind', 'ytmsearch:Slipknot Duality']);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'lastfm');
  assert.equal(candidates[0].lastfmMatch, 0.75);
  assert.equal(candidates[0].track.info.identifier, 'duality0001');
});

test('lastfm source is silent when the client is disabled', async () => {
  const node = { connected: true, search: async () => { throw new Error('should not search'); } };
  const source = lastfmSource({ node, context: context([seed('Lost', 'Linkin Park', 'lplplplplp1')]), client: { isEnabled: () => false } });
  assert.deepEqual(await source.run(), []);
});

test('the lastfm bonus grows with the match', () => {
  const candidate = (lastfmMatch) => ({
    track: { info: { identifier: 'k1', title: 'Duality', author: 'Slipknot', duration: 200_000 } },
    normalized: normalizeTrack({ info: { identifier: 'k1', title: 'Duality', author: 'Slipknot', duration: 200_000 } }),
    source: 'lastfm',
    sourceIndex: 0,
    anchorKeys: new Set(),
    anchorRank: 0,
    lastfmMatch,
  });
  const ctx = { manualSeeds: [], activeSeeds: [], recent: [], skipped: [], seedArtist: 'linkin park' };
  const weak = scoreCandidate(candidate(0), ctx).score;
  const strong = scoreCandidate(candidate(1), ctx).score;
  assert.equal(strong - weak, 12);
});

test('seed queries use real names and strip upload decorations', () => {
  const query = (title, author) => lastfmSeedQuery(seed(title, author, 'qqqqqqqqqqq'));
  assert.deepEqual(query('Dawid Podsiadło - Małomiasteczkowy (Official Video)', 'DawidPodsiadloVEVO'), { artist: 'Dawid Podsiadło', title: 'Małomiasteczkowy' });
  assert.deepEqual(query('Lost [Official Music Video] - Linkin Park', 'Linkin Park'), { artist: 'Linkin Park', title: 'Lost' });
  assert.deepEqual(query('Numb', 'Linkin Park - Topic'), { artist: 'Linkin Park', title: 'Numb' });
});
