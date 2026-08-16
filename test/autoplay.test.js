const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addManualSeed,
  clearAutoplayState,
  recordAutoplaySkip,
  __testing,
} = require('../src/music/autoplay');

function track(title, author, identifier, overrides = {}) {
  return {
    info: {
      title,
      author,
      identifier,
      uri: `https://www.youtube.com/watch?v=${identifier}`,
      duration: 180_000,
      sourceName: 'youtube',
      ...overrides,
    },
  };
}

test('manual autoplay seeds accumulate and rotate instead of replacing each other', () => {
  const guildId = 'autoplay-manual-pool';
  clearAutoplayState(guildId);

  addManualSeed(guildId, track('Song A', 'Artist A', 'aaaaaaaaaaa'));
  addManualSeed(guildId, track('Song B', 'Artist B', 'bbbbbbbbbbb'));
  addManualSeed(guildId, track('Song C', 'Artist C', 'ccccccccccc'));

  assert.deepEqual(
    __testing.getManualSeedPool(guildId).map((entry) => entry.title),
    ['Song A', 'Song B', 'Song C'],
  );
  assert.deepEqual(
    __testing.selectManualSeeds(guildId).map((entry) => entry.title),
    ['Song C', 'Song B', 'Song A'],
  );
  assert.deepEqual(
    __testing.selectManualSeeds(guildId).map((entry) => entry.title),
    ['Song B', 'Song A', 'Song C'],
  );

  clearAutoplayState(guildId);
});

test('re-adding a manual track refreshes it without duplicating the profile', () => {
  const guildId = 'autoplay-manual-dedupe';
  clearAutoplayState(guildId);

  addManualSeed(guildId, track('Song A', 'Artist A', 'aaaaaaaaaaa'));
  addManualSeed(guildId, track('Song B', 'Artist B', 'bbbbbbbbbbb'));
  addManualSeed(guildId, track('Song A', 'Artist A', 'aaaaaaaaaaa'));

  assert.deepEqual(
    __testing.getManualSeedPool(guildId).map((entry) => entry.title),
    ['Song B', 'Song A'],
  );

  clearAutoplayState(guildId);
});

test('manual additions preserve autoplay skip feedback and ignore local uploads', () => {
  const guildId = 'autoplay-feedback';
  clearAutoplayState(guildId);

  const skipped = { ...track('Skipped Song', 'Skipped Artist', 'ddddddddddd'), isAutoplay: true };
  recordAutoplaySkip(guildId, skipped, { position: 5_000 });
  addManualSeed(guildId, track('Manual Song', 'Manual Artist', 'eeeeeeeeeee'));
  addManualSeed(guildId, track('Upload', 'Local Artist', '', {
    sourceName: 'localUpload',
    uri: 'http://localhost/api/uploads/file',
  }));

  assert.equal(__testing.wasRecentlySkipped(guildId, skipped), true);
  assert.deepEqual(
    __testing.getManualSeedPool(guildId).map((entry) => entry.title),
    ['Manual Song'],
  );

  clearAutoplayState(guildId);
});

test('search queries represent every active manual seed', () => {
  const guildId = 'autoplay-query-profile';
  clearAutoplayState(guildId);

  const tracks = [
    track('Song A', 'Artist A', 'aaaaaaaaaaa'),
    track('Song B', 'Artist B', 'bbbbbbbbbbb'),
    track('Song C', 'Artist C', 'ccccccccccc'),
  ];
  tracks.forEach((entry) => addManualSeed(guildId, entry));

  const selected = __testing.selectManualSeeds(guildId);
  const context = __testing.buildContext(guildId, { info: selected[0] }, tracks[2], selected);
  const queries = __testing.buildSearchQueries(context);
  const represented = new Set(queries.map((entry) => entry.anchorKey).filter(Boolean));

  assert.deepEqual(represented, new Set(selected.map((entry) => entry.key)));
  assert.equal(queries.length, 6);

  clearAutoplayState(guildId);
});

test('discovery queries exclude core artists and preserve distance metadata', () => {
  const context = {
    manualSeeds: [{ artist: 'Core Artist' }],
  };
  const queries = __testing.buildDiscoveryQueries([
    { name: 'Core Artist', distance: 'close' },
    { name: 'New Close Artist', distance: 'close' },
    { name: 'New Broad Artist', distance: 'broad' },
    { name: 'New Broad Artist', distance: 'medium' },
  ], context);

  assert.deepEqual(queries, [
    { query: 'New Close Artist official audio', artist: 'New Close Artist', distance: 'close' },
    { query: 'New Broad Artist official audio', artist: 'New Broad Artist', distance: 'broad' },
  ]);
});

test('AI selector is primary and local scoring remains the fallback', async () => {
  const candidates = [
    { normalized: { title: 'Local Pick' }, score: 90, rejected: false },
    { normalized: { title: 'AI Pick' }, score: 60, rejected: false },
  ];
  const context = {};

  const aiSelected = await __testing.selectCandidate(
    candidates,
    context,
    async () => candidates[1],
  );
  assert.equal(aiSelected, candidates[1]);

  candidates[1].rejected = true;
  const fallbackSelected = await __testing.selectCandidate(
    candidates,
    context,
    async () => null,
  );
  assert.equal(fallbackSelected.normalized.title, candidates[0].normalized.title);
});

test('AI retrieval candidates cannot leak into the original local fallback', async () => {
  const oldPool = [
    { normalized: { title: 'Original Pick' }, score: 60, rejected: false },
  ];
  const expandedPool = [
    ...oldPool,
    { normalized: { title: 'AI Discovery' }, score: 100, rejected: false },
  ];

  const selected = await __testing.selectCandidate(
    expandedPool,
    {},
    async () => null,
    oldPool,
  );

  assert.equal(selected.normalized.title, 'Original Pick');
});

test('manual seed artists remain the autoplay core without becoming one-shot picks', () => {
  const seed = {
    key: 'seed',
    title: 'Seed Song',
    cleanTitle: 'Seed Song',
    artist: 'Core Artist',
    author: 'Core Artist',
    duration: 180_000,
  };
  const context = {
    guildId: 'core-test',
    manualSeeds: [seed],
    activeSeeds: [seed],
    seed,
    primary: seed,
    last: { ...seed, key: 'last', title: 'Last Song', cleanTitle: 'Last Song' },
    recent: [],
    skipped: [],
    seedArtist: seed.artist,
  };
  const makeCandidate = (key, artist) => ({
    track: { info: { identifier: key, title: `${key} song`, author: artist, duration: 180_000 } },
    normalized: {
      key,
      title: `${key} song`,
      cleanTitle: `${key} song`,
      artist,
      artistKey: artist.toLowerCase(),
      author: artist,
      authorKey: artist.toLowerCase(),
      duration: 180_000,
      haystack: `${key} song ${artist}`.toLowerCase(),
    },
    source: 'search',
    sourceIndex: 0,
    anchorKeys: new Set(),
    anchorRank: 0,
  });

  const initialCore = __testing.scoreCandidate(makeCandidate('core-next', 'Core Artist'), context);
  const initialDiscovery = __testing.scoreCandidate(makeCandidate('discovery', 'Related Artist'), context);

  context.recent = [{ ...seed, key: 'older-core', title: 'Older Song', cleanTitle: 'Older Song' }];
  const balancedCore = __testing.scoreCandidate(makeCandidate('core-next', 'Core Artist'), context);
  const balancedDiscovery = __testing.scoreCandidate(makeCandidate('discovery', 'Related Artist'), context);

  assert.equal(initialCore.rejected, false);
  assert.equal(initialDiscovery.rejected, false);
  assert.ok(initialCore.score > initialDiscovery.score);
  assert.ok(Math.abs(balancedCore.score - balancedDiscovery.score) <= 2);
});

test('autoplay rejects a third consecutive track by the same artist', () => {
  const seed = {
    key: 'seed', title: 'Seed', cleanTitle: 'Seed', artist: 'Core Artist', author: 'Core Artist', duration: 180_000,
  };
  const context = {
    guildId: 'streak-test',
    manualSeeds: [seed],
    activeSeeds: [seed],
    seed,
    primary: seed,
    last: { ...seed, key: 'last', title: 'Last', cleanTitle: 'Last' },
    recent: [
      { ...seed, key: 'one', title: 'One', cleanTitle: 'One' },
      { ...seed, key: 'two', title: 'Two', cleanTitle: 'Two' },
    ],
    skipped: [],
    seedArtist: seed.artist,
  };
  const candidate = {
    track: { info: { identifier: 'three', title: 'Three', author: 'Core Artist', duration: 180_000 } },
    normalized: {
      key: 'three', title: 'Three', cleanTitle: 'Three', artist: 'Core Artist', artistKey: 'core artist',
      author: 'Core Artist', authorKey: 'core artist', duration: 180_000, haystack: 'three core artist',
    },
    source: 'search', sourceIndex: 0, anchorKeys: new Set(), anchorRank: 0,
  };

  const result = __testing.scoreCandidate(candidate, context);

  assert.equal(result.rejected, true);
  assert.equal(result.reason, 'artist streak limit');
});

test('autoplay rejects blend and mashup variants before either selector sees them', () => {
  const seed = {
    key: 'seed', title: 'Seed', cleanTitle: 'Seed', artist: 'Core Artist', author: 'Core Artist', duration: 180_000,
  };
  const context = {
    guildId: 'quality-test', manualSeeds: [seed], activeSeeds: [seed], seed, primary: seed,
    last: { ...seed, key: 'last' }, recent: [], skipped: [], seedArtist: seed.artist,
  };
  const candidate = {
    track: { info: { title: 'Popular Song Mashup', author: 'Other Artist', duration: 180_000 } },
    normalized: {
      key: 'mashup', title: 'Popular Song Mashup', cleanTitle: 'Popular Song Mashup',
      artist: 'Other Artist', artistKey: 'other artist', author: 'Other Artist', authorKey: 'other artist',
      duration: 180_000, haystack: 'popular song mashup other artist',
    },
    source: 'discovery', sourceIndex: 0, anchorKeys: new Set(), anchorRank: 0,
  };

  const result = __testing.scoreCandidate(candidate, context);

  assert.equal(result.rejected, true);
  assert.equal(result.reason, 'blocked title pattern');
});
