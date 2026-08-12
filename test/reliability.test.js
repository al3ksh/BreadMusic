const test = require('node:test');
const assert = require('node:assert/strict');
const { withGuildMutex } = require('../src/music/guildMutex');
const { registerVote, resetVotes, getVoteState } = require('../src/music/voteManager');
const {
  isTrackSeekable,
  getTrackCapabilityMetadata,
  isUnseekableTrackError,
  getMirrorSource,
  isMirrorTrack,
  seekTrack,
} = require('../src/music/trackCapabilities');

test('guild mutex serializes concurrent player operations', async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = withGuildMutex('reliability-test', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = withGuildMutex('reliability-test', async () => {
    events.push('second');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second']);
});

test('vote state is pruned for listeners and isolated per track', () => {
  resetVotes('reliability-test');
  const listeners = new Set(['alice', 'bob']);

  assert.equal(registerVote('reliability-test', 'alice', listeners, 'track-a'), 1);
  assert.equal(registerVote('reliability-test', 'bob', listeners, 'track-a'), 2);
  assert.equal(registerVote('reliability-test', 'alice', new Set(['alice']), 'track-a'), 1);
  assert.deepEqual([...getVoteState('reliability-test', new Set(['alice']), 'track-a').userIds], ['alice']);
  assert.equal(registerVote('reliability-test', 'bob', listeners, 'track-b'), 1);
  assert.equal(getVoteState('reliability-test', listeners, 'track-a'), null);

  resetVotes('reliability-test');
});

test('seekability follows Lavalink track metadata', () => {
  assert.equal(isTrackSeekable({ info: { isSeekable: true, isStream: false } }), true);
  assert.equal(isTrackSeekable({ info: { isSeekable: false, isStream: false } }), false);
  assert.equal(isTrackSeekable({ info: { isSeekable: true, isStream: true } }), false);
  assert.equal(isTrackSeekable({ info: { sourceName: 'spotify', isSeekable: false, isStream: false, duration: 198000 } }), true);
  assert.equal(isTrackSeekable({ info: { sourceName: 'applemusic', isSeekable: false, isStream: false, duration: 198000 } }), true);
  assert.equal(isTrackSeekable({ info: { sourceName: 'tidal', isSeekable: false, isStream: false, duration: 198000 } }), true);
  assert.equal(isTrackSeekable({ info: { sourceName: 'spotify', isSeekable: false, isStream: false, duration: 0 } }), false);
  assert.equal(isTrackSeekable({ info: { sourceName: 'spotify', isSeekable: false, isStream: true, duration: 198000 } }), false);
  assert.deepEqual(
    getTrackCapabilityMetadata({ info: { sourceName: 'youtube', isSeekable: true, isStream: false } }),
    { seekable: true, isStream: false },
  );
  assert.deepEqual(
    getTrackCapabilityMetadata({ info: { sourceName: 'youtube', isSeekable: false, isStream: true } }),
    { seekable: false, isStream: true },
  );
  assert.equal(getMirrorSource({ info: { sourceName: 'apple-music' } }), 'apple-music');
  assert.equal(isMirrorTrack({ info: { sourceName: 'spotify', isSeekable: false, isStream: false, duration: 198000 } }), true);
  assert.equal(isMirrorTrack({ info: { sourceName: 'tidal', isSeekable: false, isStream: false, duration: 198000 } }), true);
  assert.equal(isMirrorTrack({ info: { sourceName: 'deezer', isSeekable: false, isStream: false, duration: 198000 } }), false);
  assert.equal(isMirrorTrack({ info: { sourceName: 'spotify', isSeekable: false, isStream: true, duration: 198000 } }), false);
  assert.equal(isUnseekableTrackError(new RangeError('Current Track is not seekable / a stream')), true);
  assert.equal(isUnseekableTrackError(new Error('other failure')), false);
});

test('mirror sources seek through Lavalink despite conservative source metadata', async () => {
  const updates = [];
  let regularSeekCalled = false;
  const player = {
    guildId: 'seek-test',
    queue: { current: { info: { sourceName: 'spotify', isSeekable: false, isStream: false, duration: 180000 } } },
    node: { updatePlayer: async (payload) => updates.push(payload) },
    seek: async () => { regularSeekCalled = true; },
    triggerPlayerClientUpdate: () => {},
  };

  await seekTrack(player, 999999);

  assert.equal(regularSeekCalled, false);
  assert.equal(player.lastPosition, 180000);
  assert.deepEqual(updates, [{ guildId: 'seek-test', playerOptions: { position: 180000 } }]);
});

test('Apple Music and Tidal mirrors use the same safe seek path', async () => {
  for (const sourceName of ['applemusic', 'tidal']) {
    const updates = [];
    const player = {
      guildId: `seek-${sourceName}`,
      queue: { current: { info: { sourceName, isSeekable: false, isStream: false, duration: 180000 } } },
      node: { updatePlayer: async (payload) => updates.push(payload) },
      seek: async () => { throw new Error('regular seek path should not be used'); },
      triggerPlayerClientUpdate: () => {},
    };

    await seekTrack(player, 42000);
    assert.deepEqual(updates, [{ guildId: `seek-${sourceName}`, playerOptions: { position: 42000 } }]);
  }
});

test('regular tracks keep using the Lavalink client seek path', async () => {
  let seekPosition = null;
  const player = {
    queue: { current: { info: { sourceName: 'youtube', isSeekable: true, isStream: false, duration: 180000 } } },
    seek: async (position) => { seekPosition = position; },
  };

  await seekTrack(player, 42000);
  assert.equal(seekPosition, 42000);
});
