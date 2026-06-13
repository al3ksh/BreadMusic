const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanArtist,
  cleanTrackTitle,
  trackToLyricsQuery,
  fetchJson,
  LyricsProviderError,
} = require('../src/music/lyrics');

test('lyrics query removes common YouTube metadata', () => {
  assert.equal(cleanArtist('Daft Punk - Topic'), 'Daft Punk');
  assert.equal(cleanTrackTitle('One More Time (Official Music Video)'), 'One More Time');
  assert.equal(cleanTrackTitle('Song [Lyrics]'), 'Song');
});

test('track metadata maps to lyrics query', () => {
  assert.deepEqual(
    trackToLyricsQuery({
      info: {
        author: 'Artist',
        title: 'Track',
        duration: 123000,
        pluginInfo: { albumName: 'Album' },
      },
    }),
    { artist: 'Artist', title: 'Track', duration: 123000, album: 'Album' },
  );
});

test('lyrics requests retry transient aborts', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new DOMException('aborted', 'AbortError');
    return {
      ok: true,
      status: 200,
      json: async () => ({ plainLyrics: 'lyrics' }),
      headers: { get: () => null },
    };
  };

  try {
    const result = await fetchJson('https://example.test', { attempts: 2, timeoutMs: 1000 });
    assert.equal(result.plainLyrics, 'lyrics');
    assert.equal(attempts, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('lyrics requests expose a controlled provider error after retries', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new DOMException('aborted', 'AbortError');
  };

  try {
    await assert.rejects(
      fetchJson('https://example.test', { attempts: 1, timeoutMs: 1000 }),
      LyricsProviderError,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
