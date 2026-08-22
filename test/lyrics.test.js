const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanArtist,
  cleanTrackTitle,
  stripFeaturedArtists,
  stripBracketedContent,
  primaryArtistName,
  buildQueryVariants,
  isIsrc,
  trackToLyricsQuery,
  findLyrics,
  fetchJson,
  findActiveLyricIndex,
  LyricsProviderError,
  parseSyncedLyrics,
} = require('../src/music/lyrics');

test('lyrics query removes common YouTube metadata', () => {
  assert.equal(cleanArtist('Daft Punk - Topic'), 'Daft Punk');
  assert.equal(cleanTrackTitle('One More Time (Official Music Video)'), 'One More Time');
  assert.equal(cleanTrackTitle('Song [Lyrics]'), 'Song');
});

test('lyrics cleaning removes production credits, features and video markers', () => {
  assert.equal(cleanTrackTitle('Neon Nights (prod. by Max Martin)'), 'Neon Nights');
  assert.equal(cleanTrackTitle('Neon Nights - Prod. By Max Martin'), 'Neon Nights');
  assert.equal(cleanTrackTitle('Golden Hour [Official Audio]'), 'Golden Hour');
  assert.equal(cleanTrackTitle('Runaway - Official Visualizer'), 'Runaway');
  assert.equal(cleanTrackTitle('Dynamite (MV)'), 'Dynamite');
  assert.equal(cleanTrackTitle('Papercut (HD)'), 'Papercut');
  assert.equal(stripFeaturedArtists('Levitating feat. DaBaby'), 'Levitating');
  assert.equal(stripFeaturedArtists('Rain on Me (ft. Ariana Grande)'), 'Rain on Me');
  assert.equal(cleanArtist('Artist Name ft. Other Artist'), 'Artist Name');
  assert.equal(cleanArtist('Daft Punk VEVO'), 'Daft Punk');
});

test('lyrics cleaning keeps meaningful titles intact', () => {
  assert.equal(cleanTrackTitle('Simon & Garfunkel - The Boxer'), 'Simon & Garfunkel - The Boxer');
  assert.equal(primaryArtistName('Simon & Garfunkel'), 'Simon');
  assert.equal(primaryArtistName('Eminem feat. Rihanna'), 'Eminem');
});

test('isrc detection accepts valid codes only', () => {
  assert.equal(isIsrc('USUM71703861'), true);
  assert.equal(isIsrc('usum71703861'), true);
  assert.equal(isIsrc('dQw4w9WgXcQ'), false);
  assert.equal(isIsrc('TOO-SHORT'), false);
  assert.equal(isIsrc(''), false);
  assert.equal(isIsrc(null), false);
});

test('track metadata maps to lyrics query including ISRC', () => {
  assert.deepEqual(
    trackToLyricsQuery({
      info: {
        author: 'Artist',
        title: 'Track',
        duration: 123000,
        pluginInfo: { albumName: 'Album' },
      },
    }),
    { artist: 'Artist', title: 'Track', duration: 123000, album: 'Album', isrc: '' },
  );
  assert.deepEqual(
    trackToLyricsQuery({
      info: {
        author: 'Artist',
        title: 'Track',
        identifier: 'USUM71703861',
      },
    }),
    { artist: 'Artist', title: 'Track', duration: 0, album: '', isrc: 'USUM71703861' },
  );
  const youtube = trackToLyricsQuery({
    info: { author: 'Channel - Topic', title: 'Song', identifier: 'dQw4w9WgXcQ' },
  });
  assert.equal(youtube.isrc, '');
});

test('query variants cover cleaned, embedded and feature-stripped shapes', () => {
  const variants = buildQueryVariants({
    artist: 'Artist',
    title: 'Track (Official Video)',
    duration: 0,
    isrc: 'USUM71703861',
    isrcMetadata: [{ artist: 'Real Artist', title: 'Real Track' }],
  });
  assert.deepEqual(variants[0], { artist: 'Artist', title: 'Track' });
  assert.ok(variants.some((variant) => variant.artist === 'Real Artist' && variant.title === 'Real Track'));

  const embedded = buildQueryVariants({
    artist: 'Chill Radio - Topic',
    title: 'Lo-Fi Beats - Midnight Drive',
    duration: 0,
  });
  assert.ok(embedded.some((variant) => variant.artist === 'Lo-Fi Beats' && variant.title === 'Midnight Drive'));
});

test('findLyrics falls back to later variants after empty results', async () => {
  const originalFetch = global.fetch;
  let calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (url.includes('/get?')) {
      return { ok: false, status: 404, headers: { get: () => null } };
    }
    if (url.includes('/search?') && url.includes('track_name=Chill')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [{ id: 1, plainLyrics: 'found', trackName: 'Midnight Drive', artistName: 'Lo-Fi Beats' }],
      };
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
  };

  try {
    const lyrics = await findLyrics({ artist: 'Unknown Live', title: 'Midnight Drive - Chill Mix', duration: 0 });
    assert.equal(lyrics.plainLyrics, 'found');
    assert.ok(calls.length > 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('synced lyrics parse timestamps and resolve the active line', () => {
  const lines = parseSyncedLyrics('[00:01.00]First\n[00:03.50]Second\n[00:08.00]Third');
  assert.deepEqual(lines, [
    { time: 1000, text: 'First' },
    { time: 3500, text: 'Second' },
    { time: 8000, text: 'Third' },
  ]);
  assert.equal(findActiveLyricIndex(lines, 500), -1);
  assert.equal(findActiveLyricIndex(lines, 3499), 0);
  assert.equal(findActiveLyricIndex(lines, 3500), 1);
  assert.equal(findActiveLyricIndex(lines, 12000), 2);
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
