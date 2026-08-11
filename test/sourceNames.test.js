const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSourceName } = require('../src/music/sourceNames');

test('source names preserve explicit Lavalink metadata', () => {
  assert.equal(normalizeSourceName({ sourceName: 'youtube', uri: 'https://example.com' }), 'youtube');
  assert.equal(normalizeSourceName({ sourceName: 'localUpload' }), 'localUpload');
});

test('source names fall back to track URI', () => {
  assert.equal(normalizeSourceName({ uri: 'https://www.youtube.com/watch?v=test' }), 'youtube');
  assert.equal(normalizeSourceName({ uri: 'https://open.spotify.com/track/test' }), 'spotify');
  assert.equal(normalizeSourceName({ uri: '/api/uploads/guild/file.mp3' }), 'localUpload');
  assert.equal(normalizeSourceName({ uri: 'https://example.com/track' }), null);
});
