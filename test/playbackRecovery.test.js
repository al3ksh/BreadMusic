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
