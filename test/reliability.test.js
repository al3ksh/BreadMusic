const test = require('node:test');
const assert = require('node:assert/strict');
const { withGuildMutex } = require('../src/music/guildMutex');
const { registerVote, resetVotes, getVoteState } = require('../src/music/voteManager');
const { isTrackSeekable, isUnseekableTrackError } = require('../src/music/trackCapabilities');

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
  assert.equal(isUnseekableTrackError(new RangeError('Current Track is not seekable / a stream')), true);
  assert.equal(isUnseekableTrackError(new Error('other failure')), false);
});
