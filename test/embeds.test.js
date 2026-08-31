const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTrackEmbed, buildNowPlayingEmbed } = require('../src/music/embeds');

function makeTrack(overrides = {}) {
  return {
    info: {
      title: 'Bubbletea',
      author: 'Quebonafide',
      uri: 'https://www.youtube.com/watch?v=track123',
      duration: 180000,
      sourceName: 'youtube',
      ...overrides.info,
    },
    ...overrides,
  };
}

test('regular track titles remain clickable', () => {
  const embed = buildTrackEmbed(makeTrack(), { username: 'alex' }, 'voice').toJSON();

  assert.equal(embed.description, '[Bubbletea](https://www.youtube.com/watch?v=track123)');
});

test('local upload titles are plain text in queue and now playing embeds', () => {
  const localTrack = makeTrack({
    info: {
      title: 'private-song.flac',
      author: 'Local upload',
      uri: 'http://bot:3001/api/uploads/guild/upload/private-song.flac?expires=1&signature=redacted',
      sourceName: 'localUpload',
      isLocalUpload: true,
    },
    localUpload: { guildId: 'guild', uploadId: 'upload', fileName: 'private-song.flac' },
    requester: { username: 'alex' },
  });

  const addedEmbed = buildTrackEmbed(localTrack, { username: 'alex' }, 'voice').toJSON();
  const nowPlayingEmbed = buildNowPlayingEmbed({ position: 0, volume: 60, repeatMode: 'off' }, localTrack).toJSON();

  assert.equal(addedEmbed.description, 'private-song.flac');
  assert.match(nowPlayingEmbed.description, /^Local upload - private-song\.flac\n/);
  assert.doesNotMatch(nowPlayingEmbed.description, /\]\(http:\/\/bot:3001/);
});
