const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPlaybackErrorEmbed,
  buildReplacementEmbed,
  classifyPlaybackError,
  describeSearchFailure,
} = require('../src/music/playbackErrors');
const { applyPreferredSource, isSpotifyUrl, isSupportedUrl, isYouTubeHost } = require('../src/music/searchUtils');
const { createSelection, getSelection, deleteSelection } = require('../src/state/searchCache');

test('playback errors are sorted into the reason the listener sees', () => {
  const cases = [
    [{ exception: { message: 'Sign in to confirm your age' } }, 'age_restricted'],
    [{ exception: { message: 'This video is private' } }, 'private'],
    [{ exception: { cause: 'The uploader has not made this video available in your country' } }, 'region_blocked'],
    [{ exception: { message: "Sign in to confirm you're not a bot" } }, 'authentication_required'],
    [{ error: { message: 'Video unavailable' } }, 'unavailable'],
    [{ message: 'Track stuck' }, 'timeout'],
    [{ error: 'HTTP 403' }, 'forbidden'],
    [{ exception: { message: 'Something odd' } }, 'source_error'],
    [undefined, 'source_error'],
  ];
  for (const [payload, code] of cases) {
    assert.equal(classifyPlaybackError(payload).code, code, JSON.stringify(payload));
  }
});

test('a failed search says not found unless the source reported an error', () => {
  assert.equal(describeSearchFailure({ loadType: 'empty' }).code, 'not_found');
  assert.equal(describeSearchFailure(null).code, 'not_found');
  assert.equal(describeSearchFailure({ loadType: 'error', exception: { message: 'This video is private' } }).code, 'private');
});

test('error and replacement embeds name the tracks involved', () => {
  const failed = { info: { title: 'Gone', author: 'Band', uri: 'https://youtu.be/x' } };
  const { embed, classification } = buildPlaybackErrorEmbed(failed, { exception: { message: 'Video unavailable' } });
  assert.equal(classification.code, 'unavailable');
  assert.equal(embed.data.fields[0].value, '[Band - Gone](https://youtu.be/x)');

  const upload = { localUpload: { fileName: 'demo.mp3' } };
  const replacement = buildReplacementEmbed(failed, upload);
  assert.deepEqual(replacement.data.fields.map((field) => field.value), ['[Band - Gone](https://youtu.be/x)', 'demo.mp3']);
  assert.equal(buildReplacementEmbed(null, null).data.fields[0].value, 'Unknown track');
});

test('plain queries get the server preferred search prefix, links and prefixed queries pass through', () => {
  assert.equal(applyPreferredSource('  daft punk  '), 'ytsearch:daft punk');
  assert.equal(applyPreferredSource('daft punk', { preferredSource: 'spotify' }), 'spsearch:daft punk');
  assert.equal(applyPreferredSource('daft punk', { preferredSource: 'SoundCloud' }), 'scsearch:daft punk');
  assert.equal(applyPreferredSource('daft punk', { preferredSource: 'spsearch' }), 'spsearch:daft punk');
  assert.equal(applyPreferredSource('daft punk', { preferredSource: 'myspace' }), 'ytsearch:daft punk');
  assert.equal(applyPreferredSource('daft punk', {}, 'scsearch'), 'scsearch:daft punk');
  assert.equal(applyPreferredSource('https://youtu.be/abc', { preferredSource: 'spotify' }), 'https://youtu.be/abc');
  assert.equal(applyPreferredSource('scsearch:lofi', { preferredSource: 'spotify' }), 'scsearch:lofi');
  assert.equal(applyPreferredSource('   '), '');
});

test('only known music hosts count as supported links', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=x',
    'https://music.youtube.com/watch?v=x',
    'https://youtu.be/x',
    'https://open.spotify.com/track/x',
    'https://soundcloud.com/a/b',
    'https://on.soundcloud.com/x',
    'https://artist.bandcamp.com/track/x',
  ]) {
    assert.equal(isSupportedUrl(url), true, url);
  }
  for (const url of ['https://youtube.com.evil.example/x', 'https://notyoutube.com/x', 'not a url', 'https://example.com']) {
    assert.equal(isSupportedUrl(url), false, url);
  }
  assert.equal(isSpotifyUrl('https://open.spotify.com/album/x'), true);
  assert.equal(isSpotifyUrl('https://spotify.com.example/x'), false);
  assert.equal(isSpotifyUrl('nope'), false);
  assert.equal(isYouTubeHost('M.YouTube.com'), true);
  assert.equal(isYouTubeHost(), false);
});

test('search selections expire and can be dropped early', async () => {
  const tracks = [{ info: { title: 'A' } }];
  const id = createSelection(tracks, 'user', 'guild');
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.deepEqual(getSelection(id), { tracks, userId: 'user', guildId: 'guild', expiresAt: getSelection(id).expiresAt });

  deleteSelection(id);
  assert.equal(getSelection(id), null);

  const short = createSelection(tracks, 'user', 'guild', -1);
  assert.equal(getSelection(short), null);
  assert.equal(getSelection('unknown'), null);
});
