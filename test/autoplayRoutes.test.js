const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPlayerRouter } = require('../src/routes/player');

async function withPlayerRouter(options, callback) {
  const calls = [];
  const guildId = 'feedback-guild';
  const member = { voice: { channelId: options.memberChannel ?? 'voice' } };
  const guild = {
    members: { me: { voice: { channelId: 'voice' } } },
    channels: { cache: new Map([['voice', { name: 'Voice', isVoiceBased: () => true }]]) },
  };
  const current = { info: { identifier: 'abcdefghijk', title: 'Song', author: 'Artist' } };
  const player = {
    queue: { current, tracks: [] },
    voiceChannelId: 'voice',
    textChannelId: 'text',
    playing: true,
    play: async () => { calls.push('play'); },
    skip: async () => { calls.push('skipTrack'); },
  };
  const next = (_req, _res, proceed) => proceed();
  const client = {
    guilds: { cache: new Map([[guildId, guild]]) },
    lavalink: { players: new Map([[guildId, player]]) },
    musicUI: { refresh: async () => { calls.push('refresh'); } },
  };
  const app = express();
  app.use(express.json());
  app.use(createPlayerRouter({
    client,
    requireAuth: next,
    requirePlayerAccess(req, _res, proceed) {
      req.guildMember = member;
      req.dashboardCapabilities = { canControlPlayer: options.privileged === true, canQueue: options.canQueue === true };
      proceed();
    },
    requireTrustedOrigin: next,
    requireDashboardActionRateLimit: next,
    acquireGuildMutex: async () => () => {},
    broadcastPlayerUpdate: () => {},
    getConfig: () => ({ autoplay: true }),
    resolvePlayerTextChannelId: () => 'text',
    savePlayerState: async () => {},
    likeTrack: (id, track) => {
      calls.push(['like', id, track]);
      return options.likeResult === undefined ? { liked: true } : options.likeResult;
    },
    dislikeTrack: (id, userId, track) => {
      calls.push(['dislike', id, userId, track]);
      return { disliked: true };
    },
    undislikeTrack: (userId, track) => {
      calls.push(['undislike', userId, track]);
      return options.undislikeResult ?? null;
    },
    library: {
      resolvePlayable: (_userId, id) => (id === 'liked'
        ? { name: 'Liked', tracks: [{ key: 'yt:saved', title: 'Saved', author: 'Someone' }] }
        : null),
      entryToTrack: (entry, requester) => ({ encoded: 'blob', info: { title: entry.title, author: entry.author }, requester }),
      toggleLiked: (userId, track) => {
        calls.push(['libraryLike', userId, track]);
        return options.libraryResult === undefined ? { liked: true } : options.libraryResult;
      },
    },
    rerollNext: async () => {
      calls.push('reroll');
      return options.rerollResult ?? { ok: true };
    },
    recordAutoplaySkip: () => calls.push('recordSkip'),
    clearVoteSkip: async () => {},
    handleSkipRequest: async () => {
      calls.push('voteSkip');
      return { skipped: false, message: 'Vote recorded', vote: { votes: 1, required: 2 } };
    },
    getRequestUser: () => ({ id: 'user' }),
    getDashboardRequester: () => ({ id: 'user' }),
    addManualSeed: () => {},
    handleAutoplay: async () => {},
  }));
  const server = app.listen(0);
  try {
    const post = async (action, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/guilds/${guildId}/player/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      return { status: response.status, body: await response.json() };
    };
    await callback({ post, calls, current, guildId, player });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('listeners in the bot channel can like the current track without DJ rights', async () => {
  await withPlayerRouter({}, async ({ post, calls, current, guildId }) => {
    const { status, body } = await post('autoplay_like');
    assert.equal(status, 200);
    assert.equal(body.liked, true);
    assert.deepEqual(calls[0], ['like', 'user', current]);
    assert.ok(calls.includes('refresh'));
  });
});

test('autoplay feedback is refused outside the bot voice channel, DJ actions stay DJ-only', async () => {
  await withPlayerRouter({ memberChannel: 'elsewhere' }, async ({ post, calls }) => {
    assert.equal((await post('autoplay_like')).status, 403);
    assert.equal((await post('autoplay_reroll')).status, 403);
    assert.equal(calls.length, 0);
  });
  await withPlayerRouter({}, async ({ post }) => {
    assert.equal((await post('autoplay')).status, 403);
  });
});

test('a dislike is recorded without skipping the track', async () => {
  await withPlayerRouter({}, async ({ post, calls, guildId }) => {
    const { status, body } = await post('autoplay_dislike');
    assert.equal(status, 200);
    assert.equal(body.disliked, true);
    assert.deepEqual(calls[1].slice(0, 3), ['dislike', guildId, 'user']);
    assert.ok(!calls.includes('voteSkip'));
  });
});

test('pressing dislike again takes the dislike back', async () => {
  await withPlayerRouter({ undislikeResult: { disliked: false } }, async ({ post, calls }) => {
    const { status, body } = await post('autoplay_dislike');
    assert.equal(status, 200);
    assert.equal(body.disliked, false);
    assert.ok(!calls.some((call) => call[0] === 'dislike'));
  });
});

test('the heart saves the current track to the listener library without DJ rights', async () => {
  await withPlayerRouter({}, async ({ post, calls, current }) => {
    const { status, body } = await post('library_like');
    assert.equal(status, 200);
    assert.equal(body.liked, true);
    assert.deepEqual(calls[0], ['libraryLike', 'user', current]);
  });
  await withPlayerRouter({ libraryResult: null }, async ({ post }) => {
    assert.equal((await post('library_like')).status, 409);
  });
  await withPlayerRouter({ memberChannel: 'elsewhere' }, async ({ post }) => {
    assert.equal((await post('library_like')).status, 403);
  });
});

test('play next stays DJ-only', async () => {
  await withPlayerRouter({}, async ({ post }) => {
    assert.equal((await post('playnext')).status, 403);
  });
});

test('reroll and like failures come back as readable 409s', async () => {
  await withPlayerRouter({ rerollResult: { ok: false, reason: 'cooldown' }, likeResult: null }, async ({ post }) => {
    const reroll = await post('autoplay_reroll');
    assert.equal(reroll.status, 409);
    assert.equal(reroll.body.reason, 'cooldown');
    assert.match(reroll.body.error, /second/);
    assert.equal((await post('autoplay_like')).status, 409);
  });
});

test('a single Library track can be queued by anyone who may queue, play next and now stay DJ-only', async () => {
  const pick = { playlistId: 'liked', key: 'yt:saved' };
  await withPlayerRouter({ canQueue: true }, async ({ post }) => {
    assert.equal((await post('library_track', { ...pick, mode: 'next' })).status, 403);
    assert.equal((await post('library_track', { ...pick, mode: 'now' })).status, 403);
  });
  await withPlayerRouter({ privileged: true }, async ({ post, player }) => {
    player.queue.tracks.push({ info: { title: 'Waiting' } });
    assert.equal((await post('library_track', { ...pick, key: 'yt:missing', mode: 'next' })).status, 404);
    const { status, body } = await post('library_track', { ...pick, mode: 'next' });
    assert.equal(status, 200);
    assert.equal(body.mode, 'next');
    assert.equal(player.queue.tracks[0].info.title, 'Saved');
    assert.equal(player.queue.tracks[0].origin, 'library');
  });
});
