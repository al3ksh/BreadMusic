const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPlaybackFallback,
  sourceOf,
  buildMirrorQueries,
} = require('../src/music/playbackFallback');

test('source detection maps URIs to known sources', () => {
  assert.equal(sourceOf({ info: { uri: 'https://www.youtube.com/watch?v=abc' } }), 'youtube');
  assert.equal(sourceOf({ info: { uri: 'https://youtu.be/abc' } }), 'youtube');
  assert.equal(sourceOf({ info: { uri: 'https://soundcloud.com/artist/song' } }), 'soundcloud');
  assert.equal(sourceOf({ info: { uri: 'https://open.spotify.com/track/xyz' } }), 'spotify');
  assert.equal(sourceOf({ localUpload: { uploadId: '1' }, info: {} }), 'upload');
  assert.equal(sourceOf({ info: { uri: 'https://example.com/a.mp3' } }), 'other');
});

test('mirror queries clean titles and dedupe', () => {
  assert.deepEqual(
    buildMirrorQueries({ info: { title: 'Song (Official Video)', author: 'Artist - Topic' } }),
    ['Artist Song', 'Song'],
  );
  assert.deepEqual(buildMirrorQueries({ info: { title: 'Solo Song' } }), ['Solo Song']);
});

function makeTrack(identifier, duration, uri) {
  return {
    info: {
      identifier,
      duration,
      title: 'Test Song',
      author: 'Test Artist',
      uri: uri ?? `https://www.youtube.com/watch?v=${identifier}`,
    },
  };
}

test('replacement search tries mirror sources and skips the failed identifier', async () => {
  const searches = [];
  const fallback = createPlaybackFallback({
    search: async (query) => {
      searches.push(query);
      if (query.startsWith('ytmsearch:')) {
        return {
          loadType: 'search',
          tracks: [makeTrack('failed-id', 180000)],
        };
      }
      return {
        loadType: 'search',
        tracks: [
          makeTrack('sc-1', 240000),
          makeTrack('sc-2', 182000),
        ],
      };
    },
  });

  const replacement = await fallback.findReplacementTrack({
    player: { guildId: 'guild' },
    track: makeTrack('failed-id', 180000),
  });

  assert.equal(replacement.info.identifier, 'sc-2');
  assert.ok(searches.some((query) => query.startsWith('ytmsearch:')));
  assert.ok(searches.some((query) => query.startsWith('scsearch:')));
});

test('duration tolerance filters out distant candidates', async () => {
  const fallback = createPlaybackFallback({
    search: async () => ({
      loadType: 'search',
      tracks: [
        makeTrack('short-remix', 45000),
        makeTrack('live-version', 181000),
      ],
    }),
  });

  const replacement = await fallback.findReplacementTrack({
    player: { guildId: 'guild' },
    track: makeTrack('orig', 180000),
  });
  assert.equal(replacement.info.identifier, 'live-version');
});

test('circuit breaker stops searching after repeated failures', async () => {
  let searchCalls = 0;
  let clock = 1000;
  const fallback = createPlaybackFallback({
    search: async () => {
      searchCalls += 1;
      return { loadType: 'search', tracks: [] };
    },
    maxAttempts: 2,
    now: () => clock,
  });
  const player = { guildId: 'guild' };
  const track = makeTrack('orig', 0);

  await fallback.findReplacementTrack({ player, track });
  const searchesPerCycle = searchCalls;
  assert.ok(searchesPerCycle > 0);

  await fallback.findReplacementTrack({ player, track });
  assert.equal(searchCalls, searchesPerCycle * 2);
  assert.equal(fallback.shouldAttemptFallback('guild'), false);

  await fallback.findReplacementTrack({ player, track });
  assert.equal(searchCalls, searchesPerCycle * 2);

  clock += 11 * 60 * 1000;
  assert.equal(fallback.shouldAttemptFallback('guild'), true);
});

test('findReplacementTrack returns null without a searchable track', async () => {
  const fallback = createPlaybackFallback({
    search: async () => ({ loadType: 'search', tracks: [] }),
  });
  assert.equal(await fallback.findReplacementTrack({ player: { guildId: 'g' }, track: {} }), null);
  assert.equal(await fallback.findReplacementTrack({ player: null, track: makeTrack('x', 0) }), null);
});
