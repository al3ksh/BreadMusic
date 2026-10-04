const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { classifyQuery, isOrigin, originLabel, originOf, tagOrigin } = require('../src/music/trackOrigin');
const { buildOriginSvg, toRows } = require('../src/music/originRenderer');

test('classifyQuery tells links from text searches', () => {
  assert.equal(classifyQuery('https://open.spotify.com/track/abc'), 'spotify');
  assert.equal(classifyQuery('spotify:track:abc'), 'spotify');
  assert.equal(classifyQuery('https://www.youtube.com/watch?v=abc'), 'youtube');
  assert.equal(classifyQuery('https://youtu.be/abc'), 'youtube');
  assert.equal(classifyQuery('https://music.youtube.com/watch?v=abc'), 'youtube');
  assert.equal(classifyQuery('https://soundcloud.com/a/b'), 'soundcloud');
  assert.equal(classifyQuery('https://example.com/song.mp3'), 'link');
  assert.equal(classifyQuery('daft punk one more time'), 'search');
  assert.equal(classifyQuery(''), 'search');
});

test('tagOrigin keeps the first origin a track was given', () => {
  const tracks = [{ origin: 'history' }, {}];
  assert.equal(tagOrigin(tracks, 'search'), tracks);
  assert.deepEqual(tracks.map((track) => track.origin), ['history', 'search']);
  const single = tagOrigin({}, 'library');
  assert.equal(single.origin, 'library');
});

test('originOf falls back to autoplay and uploads for untagged plays', () => {
  assert.equal(originOf({ origin: 'spotify' }), 'spotify');
  assert.equal(originOf({ origin: 'bogus', autoplay: true }), 'autoplay');
  assert.equal(originOf({ source: 'localUpload' }), 'upload');
  assert.equal(originOf({ source: 'youtube' }), null);
  assert.equal(isOrigin('bogus'), false);
  assert.equal(originLabel(null), 'Not tracked');
});

test('origin insights count tagged plays and report older ones as untracked', () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-origins-'));
  let closeDatabases = () => {};
  process.chdir(tempDir);

  try {
    const { recordTrackPlay, getOriginInsights } = require('../src/state/analyticsStore');
    ({ closeDatabases } = require('../src/state/sqliteStore'));
    const play = (id, extra, userId = 'user-1') => recordTrackPlay('guild-origins', {
      info: { identifier: id, title: id, author: 'Artist', uri: `https://example.test/${id}`, duration: 1000, sourceName: 'youtube' },
      requester: { id: userId, username: userId, bot: false },
      ...extra,
    });
    play('a', { origin: 'spotify' });
    play('b', { origin: 'spotify' });
    play('c', { origin: 'search' }, 'user-2');
    play('d', { isAutoplay: true });
    play('e', {});

    const server = getOriginInsights('guild-origins', { range: 'all' });
    assert.equal(server.total, 5);
    assert.equal(server.tracked, 4);
    assert.equal(server.untracked, 1);
    assert.deepEqual(server.origins.map((entry) => [entry.origin, entry.count]), [['spotify', 2], ['autoplay', 1], ['search', 1]]);
    assert.equal(server.origins[0].share, 0.5);

    const member = getOriginInsights('guild-origins', { range: '7d', userId: 'user-2' });
    assert.equal(member.userId, 'user-2');
    assert.deepEqual(member.origins.map((entry) => entry.origin), ['search']);
  } finally {
    closeDatabases();
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('origin image folds the long tail and escapes names', () => {
  const origins = ['spotify', 'youtube', 'search', 'upload', 'library', 'history', 'autoplay', 'soundcloud', 'link']
    .map((origin) => ({ origin, count: 1, share: 1 / 9 }));
  const rows = toRows(origins);
  assert.equal(rows.length, 7);
  assert.equal(rows.at(-1).label, 'Everything else');
  assert.equal(rows.at(-1).count, 3);

  const svg = buildOriginSvg({
    title: 'Where the music came from',
    subject: 'Bread & <Friends>',
    rangeLabel: 'Last 7 days',
    insights: { userId: null, total: 9, tracked: 9, untracked: 0, origins, detailedHistoryDays: 35 },
  });
  assert.match(svg, /Spotify link/);
  assert.match(svg, /Everything else/);
  assert.match(svg, /Bread &amp; &lt;Friends&gt;/);
  assert.match(svg, /Top input: Spotify link/);
  assert.match(svg, /LAST 7 DAYS/);
});
