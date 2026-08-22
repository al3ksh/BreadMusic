const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaybackRecovery } = require('../src/music/playbackRecovery');

test('playback recovery skips a stuck track when queue has another track', async () => {
  const events = [];
  const recover = createPlaybackRecovery({
    recoverySet: new Set(),
    isPlayerStopping: () => false,
    sendPlaybackError: () => events.push('notice'),
    handleAutoplay: async () => false,
    clearVoiceTrackStatus: async () => events.push('clear'),
    refreshPlayer: async () => events.push('refresh'),
    scheduleIdleLeave: () => events.push('idle'),
    broadcastPlayerUpdate: (guildId) => events.push(`broadcast:${guildId}`),
  });
  const player = {
    guildId: 'guild',
    queue: { tracks: [{}] },
    skip: async () => events.push('skip'),
  };

  assert.equal(await recover({ player, track: {}, payload: {}, label: 'TrackStuck' }), true);
  assert.deepEqual(events, ['notice', 'skip', 'broadcast:guild']);
});

test('playback recovery starts autoplay when a failed track was last in queue', async () => {
  const events = [];
  const recover = createPlaybackRecovery({
    recoverySet: new Set(),
    isPlayerStopping: () => false,
    sendPlaybackError: () => events.push('notice'),
    handleAutoplay: async () => false,
    clearVoiceTrackStatus: async () => events.push('clear'),
    refreshPlayer: async () => events.push('refresh'),
    scheduleIdleLeave: () => events.push('idle'),
    broadcastPlayerUpdate: (guildId) => events.push(`broadcast:${guildId}`),
  });
  const player = {
    guildId: 'guild',
    queue: { tracks: [] },
    stopPlaying: async () => events.push('stop'),
  };

  assert.equal(await recover({ player, track: {}, payload: {}, label: 'TrackStuck' }), true);
  assert.deepEqual(events, ['notice', 'stop', 'clear', 'refresh', 'idle', 'broadcast:guild']);
});

test('playback recovery suspends autoplay before stopping a failed final track', async () => {
  const events = [];
  const recover = createPlaybackRecovery({
    recoverySet: new Set(),
    isPlayerStopping: () => false,
    suspendAutoplay: (guildId) => events.push(`suspend:${guildId}`),
    sendPlaybackError: () => events.push('notice'),
    handleAutoplay: async () => {
      events.push('autoplay');
      return false;
    },
    clearVoiceTrackStatus: async () => events.push('clear'),
    refreshPlayer: async () => events.push('refresh'),
    scheduleIdleLeave: () => events.push('idle'),
    broadcastPlayerUpdate: (guildId) => events.push(`broadcast:${guildId}`),
  });
  const player = {
    guildId: 'guild',
    queue: { tracks: [] },
    stopPlaying: async () => events.push('stop'),
  };

  assert.equal(await recover({ player, track: {}, payload: {}, label: 'TrackError' }), true);
  assert.deepEqual(events, [
    'suspend:guild',
    'notice',
    'stop',
    'autoplay',
    'clear',
    'refresh',
    'idle',
    'broadcast:guild',
  ]);
});

const baseDeps = () => ({
  recoverySet: new Set(),
  isPlayerStopping: () => false,
  sendPlaybackError: () => {},
  handleAutoplay: async () => false,
  clearVoiceTrackStatus: async () => {},
  refreshPlayer: async () => {},
  scheduleIdleLeave: () => {},
  broadcastPlayerUpdate: () => {},
});

test('plays a replacement immediately when the queue is empty', async () => {
  const events = [];
  const recover = createPlaybackRecovery({
    ...baseDeps(),
    sendPlaybackError: () => events.push('notice'),
    findReplacement: async () => ({ info: { identifier: 'mirror' } }),
    notifyReplacement: async () => events.push('notify'),
  });
  const player = {
    guildId: 'guild',
    playing: false,
    paused: false,
    queue: {
      tracks: [],
      add: async (track, index) => events.push(`add:${index ?? 'end'}:${track.info.identifier}`),
    },
    play: async () => events.push('play'),
    stopPlaying: async () => events.push('stop'),
  };

  assert.equal(await recover({ player, track: { info: {} }, payload: {} }), true);
  assert.deepEqual(events, ['notice', 'add:end:mirror', 'notify', 'play']);
});

test('inserts a replacement at the head of the queue and skips to it', async () => {
  const events = [];
  const recover = createPlaybackRecovery({
    ...baseDeps(),
    sendPlaybackError: () => events.push('notice'),
    findReplacement: async () => ({ info: { identifier: 'mirror' } }),
    notifyReplacement: async () => events.push('notify'),
  });
  const player = {
    guildId: 'guild',
    playing: false,
    paused: false,
    queue: {
      tracks: [{ info: { identifier: 'next-up' } }],
      add: async (track, index) => events.push(`add:${index}:${track.info.identifier}`),
    },
    skip: async () => events.push('skip'),
    stopPlaying: async () => events.push('stop'),
  };

  assert.equal(await recover({ player, track: { info: {} }, payload: {} }), true);
  assert.deepEqual(events, ['notice', 'add:0:mirror', 'notify', 'skip']);
});

test('falls back to the legacy path when no replacement is found', async () => {
  const events = [];
  const recover = createPlaybackRecovery({
    ...baseDeps(),
    sendPlaybackError: () => events.push('notice'),
    findReplacement: async () => null,
    handleAutoplay: async () => {
      events.push('autoplay');
      return false;
    },
  });
  const player = {
    guildId: 'guild',
    queue: { tracks: [] },
    stopPlaying: async () => events.push('stop'),
  };

  assert.equal(await recover({ player, track: {}, payload: {} }), true);
  assert.deepEqual(events, ['notice', 'stop', 'autoplay']);
});

test('a failing replacement lookup does not break recovery', async () => {
  const events = [];
  const recover = createPlaybackRecovery({
    ...baseDeps(),
    sendPlaybackError: () => events.push('notice'),
    findReplacement: async () => {
      throw new Error('search down');
    },
  });
  const player = {
    guildId: 'guild',
    queue: { tracks: [{}] },
    skip: async () => events.push('skip'),
  };

  assert.equal(await recover({ player, track: {}, payload: {} }), true);
  assert.deepEqual(events, ['notice', 'skip']);
});
