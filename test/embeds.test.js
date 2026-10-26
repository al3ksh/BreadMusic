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

test('radio streams show Live instead of a duration and no progress bar', () => {
  const radioTrack = makeTrack({
    info: { title: 'RMF FM', author: 'Radio', uri: 'http://stream.example/rmf', duration: 9223372036854775807, sourceName: 'http', isStream: true },
    radioStation: { id: 'station-1', source: 'radio-browser' },
    requester: { username: 'alex' },
  });

  const embed = buildNowPlayingEmbed({ position: 754000, volume: 60, repeatMode: 'off' }, radioTrack).toJSON();
  const field = (name) => embed.fields.find((entry) => entry.name.includes(name))?.value;

  assert.equal(embed.title, 'Now Playing · Radio');
  assert.equal(embed.description, '[Radio - RMF FM](http://stream.example/rmf)\n🔴 Live');
  assert.equal(field('Duration'), 'Live');
  assert.equal(field('Source'), 'Radio');
});

test('a station that reports its song shows it above the Live line', () => {
  const radioTrack = makeTrack({
    info: { title: 'RMF FM', author: 'Radio', uri: 'http://stream.example/rmf', duration: 0, sourceName: 'http', isStream: true },
    radioStation: { id: 'station-1', source: 'radio-browser', nowPlaying: 'Evanescence - Bring Me To Life' },
    requester: { username: 'alex' },
  });

  const embed = buildNowPlayingEmbed({ position: 0, volume: 60, repeatMode: 'off' }, radioTrack).toJSON();
  assert.equal(embed.description, '[Radio - RMF FM](http://stream.example/rmf)\n🎵 **Evanescence - Bring Me To Life**\n🔴 Live');
});

test('a plain live stream is labelled Live, not Autoplay', () => {
  const liveTrack = makeTrack({ info: { title: 'Lofi stream', duration: 0, isStream: true } });

  const embed = buildNowPlayingEmbed({ guildId: 'g', position: 0, volume: 60, repeatMode: 'off' }, liveTrack).toJSON();

  assert.equal(embed.title, 'Now Playing · Live');
  assert.equal(buildTrackEmbed(liveTrack, { username: 'alex' }, 'voice').toJSON().fields[1].value, 'Live');
});
