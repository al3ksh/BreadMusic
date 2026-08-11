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
