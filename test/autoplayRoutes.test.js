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
    channels: { cache: new Map() },
  };
  const current = { info: { identifier: 'abcdefghijk', title: 'Song', author: 'Artist' } };
  const player = {
    queue: { current, tracks: [] },
    voiceChannelId: 'voice',
    textChannelId: 'text',
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
      req.dashboardCapabilities = { canControlPlayer: options.privileged === true };
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
    dislikeTrack: (id, track) => {
      calls.push(['dislike', id, track]);
      return { disliked: true };
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
    handleAutoplay: async () => {},
  }));
  const server = app.listen(0);
  try {
    const post = async (action) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/guilds/${guildId}/player/${action}`, { method: 'POST' });
      return { status: response.status, body: await response.json() };
    };
    await callback({ post, calls, current, guildId });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('listeners in the bot channel can like the current track without DJ rights', async () => {
  await withPlayerRouter({}, async ({ post, calls, current, guildId }) => {
    const { status, body } = await post('autoplay_like');
    assert.equal(status, 200);
    assert.equal(body.liked, true);
    assert.deepEqual(calls[0], ['like', guildId, current]);
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

test('a dislike is recorded and then goes through the vote skip rules', async () => {
  await withPlayerRouter({}, async ({ post, calls }) => {
    const { status, body } = await post('autoplay_dislike');
    assert.equal(status, 200);
    assert.equal(body.message, 'Vote recorded');
    assert.equal(calls[0][0], 'dislike');
    assert.ok(calls.includes('voteSkip'));
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
