const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createPlayerRouter } = require('../src/routes/player');
const { CommandError } = require('../src/utils/commandError');

const guildId = 'control-guild';

function track(title) {
  return { encoded: `enc-${title}`, info: { title, author: 'Band', identifier: title, uri: `https://youtu.be/${title}`, duration: 180_000, isSeekable: true, sourceName: 'youtube' } };
}

function fakePlayer(calls, { queue = [], current = track('Now') } = {}) {
  return {
    guildId,
    voiceChannelId: 'voice',
    textChannelId: 'text',
    playing: true,
    paused: false,
    position: 12_000,
    repeatMode: 'off',
    volume: 60,
    queue: {
      current,
      tracks: queue,
      previous: [],
      async shiftPrevious() { return this.previous.shift() ?? null; },
      async shuffle() { calls.push('shuffle'); this.tracks.reverse(); },
    },
    filterManager: {
      filters: {},
      data: {},
      equalizerBands: [],
      async applyPlayerFilters() { calls.push('filters'); },
    },
    async pause() { this.paused = true; calls.push('pause'); },
    async resume() { this.paused = false; calls.push('resume'); },
    async skip() { calls.push('skip'); },
    async stopPlaying(...args) { calls.push(['stopPlaying', ...args]); },
    async destroy(reason) { calls.push(['destroy', reason]); },
    async setRepeatMode(mode) { this.repeatMode = mode; },
    async setVolume(volume) { this.volume = volume; },
    async play(options) { calls.push(['play', options.clientTrack.info.title]); },
  };
}

async function withPlayerApp(options, callback) {
  const calls = [];
  const player = options.noPlayer ? null : fakePlayer(calls, options);
  const guild = {
    members: { me: { voice: { channelId: options.botChannel === undefined ? 'voice' : options.botChannel } } },
    channels: { cache: new Map([['voice', { name: 'General', isVoiceBased: () => true }]]) },
  };
  const client = {
    guilds: { cache: new Map([[guildId, guild]]) },
    lavalink: { players: new Map(player ? [[guildId, player]] : []) },
    musicUI: { refresh: async () => {}, clear: async () => { calls.push('ui-clear'); } },
  };
  const config = { maxVolume: 150, autoplay: false, ...options.config };
  const next = (_req, _res, proceed) => proceed();

  const app = express();
  app.use(express.json());
  app.use(createPlayerRouter({
    client,
    requireAuth: next,
    requirePlayerAccess: (req, _res, proceed) => {
      req.guildMember = { voice: { channelId: options.memberChannel === undefined ? 'voice' : options.memberChannel } };
      req.dashboardCapabilities = { canControlPlayer: options.privileged !== false, canQueue: options.canQueue === true };
      proceed();
    },
    requireTrustedOrigin: next,
    requireDashboardActionRateLimit: next,
    acquireGuildMutex: async () => () => calls.push('released'),
    broadcastPlayerUpdate: () => {},
    getConfig: () => config,
    resolvePlayerTextChannelId: () => 'text',
    savePlayerState: async () => { calls.push('saved'); },
    getRequestUser: () => ({ id: 'user-1' }),
    getDashboardRequester: () => ({ id: 'user-1' }),
    clearAutoplayState: () => calls.push('autoplay-cleared'),
    markPlayerStopping: () => calls.push('stopping'),
    clearVoiceTrackStatus: async () => {},
    recordAutoplaySkip: () => calls.push('skip-recorded'),
    clearVoteSkip: async () => {},
    handleAutoplay: async (_player, last) => calls.push(['autoplay', last.info.title]),
    handleSkipRequest: async () => ({ skipped: false, message: 'Vote counted', vote: { votes: 1, needed: 2 } }),
    setAutoplay: (_guildId, enabled) => { config.autoplay = enabled; },
    isTrackSeekable: (current) => current?.info?.isSeekable === true,
    seekTrack: options.seekTrack ?? (async (_player, position) => calls.push(['seek', position])),
    isUnseekableTrackError: (error) => error.message === 'not seekable',
    ...options.deps,
  }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/guilds/${guildId}/player`;
  const post = async (action, body, init = {}) => {
    const response = await fetch(`${base}/${action}`, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      ...init,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await callback({ post, player, calls, config });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('members without control can only vote to skip and give autoplay feedback', async () => {
  await withPlayerApp({ privileged: false }, async ({ post, calls }) => {
    assert.equal((await post('pause', {})).status, 403);
    assert.equal((await post('volume', { volume: 50 })).status, 403);

    const vote = await post('skip', {});
    assert.equal(vote.status, 200);
    assert.deepEqual(vote.body, { success: true, skipped: false, message: 'Vote counted', voteSkip: { votes: 1, needed: 2 } });
    assert.ok(!calls.includes('skip'), 'a vote does not skip on its own');
  });

  await withPlayerApp({ privileged: false, canQueue: true }, async ({ post }) => {
    assert.equal((await post('stop', {})).status, 403);
    const jump = await post('library_track', { mode: 'now', key: 'x' });
    assert.equal(jump.status, 403);
    assert.match(jump.body.error, /DJ role/);
  });

  await withPlayerApp({ privileged: false, memberChannel: 'elsewhere' }, async ({ post }) => {
    const away = await post('skip', {});
    assert.equal(away.status, 403);
    assert.match(away.body.error, /same voice channel/);
  });
});

test('unknown actions and object prototype names are refused', async () => {
  await withPlayerApp({}, async ({ post, calls }) => {
    for (const action of ['explode', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const response = await post(action, {});
      assert.equal(response.status, 400, action);
      assert.match(response.body.error, /Unknown action/);
    }
    assert.equal(calls.filter((call) => call === 'released').length, 5, 'the guild lock is always released');
  });
});

test('actions without a player answer 404', async () => {
  await withPlayerApp({ noPlayer: true }, async ({ post }) => {
    assert.equal((await post('pause', {})).status, 404);
  });
});

test('actions sent without a JSON body are refused as bad input, not crashed on', async () => {
  await withPlayerApp({ queue: [track('A'), track('B')] }, async ({ post }) => {
    for (const action of ['volume', 'remove', 'seek', 'move', 'search']) {
      const response = await post(action, undefined);
      assert.equal(response.status, 400, action);
    }
    assert.equal((await post('pause', undefined)).status, 200);
  });
});

test('pause, resume and toggle only change what needs changing, then save', async () => {
  await withPlayerApp({}, async ({ post, player, calls }) => {
    await post('resume', {});
    assert.ok(!calls.includes('resume'), 'resume on a playing player is a no-op');
    await post('pause', {});
    await post('pause', {});
    assert.equal(calls.filter((call) => call === 'pause').length, 1);
    await post('toggle', {});
    assert.equal(player.paused, false);
    await post('toggle', {});
    assert.equal(player.paused, true);
    assert.ok(calls.includes('saved'));
  });
});

test('loop cycles off, track, queue and back', async () => {
  await withPlayerApp({}, async ({ post }) => {
    const modes = [];
    for (let index = 0; index < 4; index += 1) modes.push((await post('loop', {})).body.repeatMode);
    assert.deepEqual(modes, ['track', 'queue', 'off', 'track']);
  });
});

test('volume is validated and capped at the server maximum', async () => {
  await withPlayerApp({}, async ({ post, player }) => {
    assert.deepEqual((await post('volume', { volume: 90 })).body, { success: true, volume: 90 });
    assert.deepEqual((await post('volume', { volume: 400 })).body, { success: true, volume: 150 });
    assert.equal(player.volume, 150);
    for (const volume of [-1, 501, 'loud', null]) {
      assert.equal((await post('volume', { volume })).status, 400, String(volume));
    }
  });
});

test('remove and move check their indexes against the queue', async () => {
  await withPlayerApp({ queue: ['A', 'B', 'C', 'D'].map(track) }, async ({ post, player }) => {
    const titles = () => player.queue.tracks.map((item) => item.info.title);
    assert.equal((await post('move', { from: 0, to: 4 })).status, 400);
    assert.equal((await post('move', { from: -1, to: 0 })).status, 400);
    await post('move', { from: 3, to: 0 });
    assert.deepEqual(titles(), ['D', 'A', 'B', 'C']);

    assert.equal((await post('remove', { start: 2, end: 1 })).status, 400);
    assert.equal((await post('remove', { start: 0, end: 4 })).status, 400);
    assert.deepEqual((await post('remove', { start: 1, end: 2 })).body, { success: true, removed: 2 });
    assert.deepEqual(titles(), ['D', 'C']);
    assert.deepEqual((await post('remove', { start: 0 })).body, { success: true, removed: 1 });
    assert.deepEqual(titles(), ['C']);

    assert.deepEqual((await post('clearqueue', {})).body, { success: true, removed: 1 });
    assert.deepEqual(titles(), []);
  });
});

test('seek refuses bad positions and tracks that cannot seek', async () => {
  await withPlayerApp({}, async ({ post, calls }) => {
    assert.equal((await post('seek', { position: -5 })).status, 400);
    assert.deepEqual((await post('seek', { position: 30_000 })).body, { success: true, position: 30_000 });
    assert.deepEqual(calls.find((call) => call[0] === 'seek'), ['seek', 30_000]);
  });

  await withPlayerApp({ current: { ...track('Live'), info: { ...track('Live').info, isSeekable: false } } }, async ({ post }) => {
    assert.equal((await post('seek', { position: 1000 })).status, 409);
  });

  await withPlayerApp({ seekTrack: async () => { throw new Error('not seekable'); } }, async ({ post }) => {
    assert.equal((await post('seek', { position: 1000 })).status, 409);
  });
});

test('skipping the last track hands over to autoplay when it is on', async () => {
  await withPlayerApp({ config: { autoplay: true } }, async ({ post, calls }) => {
    await post('skip', {});
    assert.ok(calls.includes('skip-recorded'));
    assert.deepEqual(calls.find((call) => call[0] === 'stopPlaying'), ['stopPlaying', false, false]);
    assert.deepEqual(calls.find((call) => call[0] === 'autoplay'), ['autoplay', 'Now']);
  });

  await withPlayerApp({ queue: [track('Next')] }, async ({ post, calls }) => {
    await post('skip', {});
    assert.ok(calls.includes('skip'));
    assert.ok(!calls.some((call) => call[0] === 'autoplay'));
  });
});

test('back plays the previous track or says there is none', async () => {
  await withPlayerApp({}, async ({ post, player, calls }) => {
    assert.equal((await post('back', {})).status, 404);
    player.queue.previous.push(track('Before'));
    assert.equal((await post('back', {})).status, 200);
    assert.deepEqual(calls.find((call) => call[0] === 'play'), ['play', 'Before']);
  });
});

test('stop empties the queue, destroys the player and clears the message', async () => {
  await withPlayerApp({ queue: [track('A')] }, async ({ post, player, calls }) => {
    assert.deepEqual((await post('stop', {})).body, { success: true, stopped: true });
    assert.deepEqual(player.queue.tracks, []);
    assert.ok(calls.includes('autoplay-cleared'));
    assert.ok(calls.includes('stopping'));
    assert.deepEqual(calls.find((call) => call[0] === 'destroy'), ['destroy', 'Stopped via dashboard']);
    assert.ok(calls.includes('ui-clear'));
  });
});

test('filters and sound settings validate the preset', async () => {
  await withPlayerApp({}, async ({ post }) => {
    assert.equal((await post('filter', {})).status, 400);
    assert.equal((await post('filter', { preset: 'chipmunk' })).status, 400);
    const applied = await post('filter', { preset: 'Nightcore' });
    assert.equal(applied.body.filter, 'nightcore');
    const cleared = await post('filter', { preset: 'off' });
    assert.equal(cleared.body.filter, null);

    assert.equal((await post('sound', { sound: [1, 2] })).status, 400);
    assert.equal((await post('sound', { sound: { preset: 'chipmunk' } })).status, 400);
    const sound = await post('sound', { sound: { preset: 'bassboost', speed: 9 } });
    assert.equal(sound.body.filter, 'bassboost');
    assert.ok(sound.body.sound.speed < 9, 'speed is clamped');
  });
});

test('autoplay follows an explicit value or flips the current one', async () => {
  await withPlayerApp({}, async ({ post, config }) => {
    assert.equal((await post('autoplay', {})).body.autoplay, true);
    assert.equal((await post('autoplay', {})).body.autoplay, false);
    assert.equal((await post('autoplay', { enabled: false })).body.autoplay, false);
    assert.equal(config.autoplay, false);
  });
});

test('a command error becomes a 409 and other failures a 500, both releasing the lock', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await withPlayerApp({ seekTrack: async () => { throw new CommandError('Busy right now'); } }, async ({ post, calls }) => {
      assert.deepEqual(await post('seek', { position: 1 }), { status: 409, body: { error: 'Busy right now' } });
      assert.ok(calls.includes('released'));
    });
    await withPlayerApp({ seekTrack: async () => { throw new Error('lavalink went away'); } }, async ({ post, calls }) => {
      const failed = await post('seek', { position: 1 });
      assert.equal(failed.status, 500);
      assert.ok(calls.includes('released'));
    });
  } finally {
    console.error = originalError;
  }
});
