const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createPublicRouter } = require('../src/routes/public');
const { createGuildStatusRouter } = require('../src/routes/guildStatus');

async function withApp(router, callback) {
  const app = express();
  app.use(router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback((pathname) => fetch(`${url}${pathname}`, { redirect: 'manual' }));
  } finally {
    server.close();
  }
}

const passThrough = (_req, _res, next) => next();

test('stats count members across guilds, busy players and a readable uptime', async () => {
  const client = {
    guilds: { cache: new Map([['a', { memberCount: 10 }], ['b', { memberCount: 5 }], ['c', {}]]) },
    lavalink: { players: new Map([['a', { playing: true }], ['b', { paused: true }], ['c', {}]]) },
    uptime: 2 * 86400000 + 3 * 3600000 + 4 * 60000,
  };
  await withApp(createPublicRouter({ client }), async (get) => {
    assert.deepEqual(await (await get('/api/stats')).json(), { guilds: 3, users: 15, players: 2, uptime: '2d 3h 4m' });

    client.uptime = undefined;
    client.lavalink = undefined;
    assert.deepEqual(await (await get('/api/stats')).json(), { guilds: 3, users: 15, players: 0, uptime: '0m' });
  });
});

test('bot info answers 503 until the Discord login finishes', async () => {
  const original = process.env.DISCORD_CLIENT_ID;
  process.env.DISCORD_CLIENT_ID = 'client-1';
  const client = { user: null };
  try {
    await withApp(createPublicRouter({ client }), async (get) => {
      assert.equal((await get('/api/bot-info')).status, 503);

      client.user = { id: '1', username: 'bread', globalName: null, avatarURL: ({ size }) => `https://cdn/a.png?size=${size}` };
      assert.deepEqual(await (await get('/api/bot-info')).json(), {
        id: '1', name: 'bread', displayName: 'bread', avatar: 'https://cdn/a.png?size=256', clientId: 'client-1',
      });
    });
  } finally {
    if (original === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = original;
  }
});

test('the invite link asks for voice and messaging permissions but not admin', async () => {
  await withApp(createPublicRouter({ client: {} }), async (get) => {
    const response = await get('/api/invite');
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin + location.pathname, 'https://discord.com/oauth2/authorize');
    assert.equal(location.searchParams.get('scope'), 'bot applications.commands');
    const permissions = BigInt(location.searchParams.get('permissions'));
    assert.equal(permissions & (1n << 3n), 0n, 'no Administrator');
    assert.equal(permissions & (1n << 5n), 0n, 'no Manage Server');
    assert.notEqual(permissions & (1n << 20n), 0n, 'Connect');
    assert.notEqual(permissions & (1n << 21n), 0n, 'Speak');
  });
});

function statusClient({ ready = true, nodes = [], player = null, channels = new Map() } = {}) {
  return {
    isReady: () => ready,
    ws: { status: 0, ping: 41.6 },
    guilds: { cache: new Map([['g1', { channels: { cache: channels } }]]) },
    lavalink: {
      players: new Map(player ? [['g1', player]] : []),
      nodeManager: { nodes: new Map(nodes.map((connected, index) => [String(index), { connected }])) },
    },
  };
}

function statusRouter(client, { config = {}, insights = [] } = {}) {
  return createGuildStatusRouter({
    client,
    requireAuth: passThrough,
    requireGuildAccess: passThrough,
    getConfig: () => config,
    getGuildInsights: (guildId, options) => {
      insights.push({ guildId, ...options });
      return { ok: true };
    },
    isUsableTextChannel: (channel) => channel.sendable,
  });
}

test('health reports Discord, Lavalink, the player and the configured player channel', async () => {
  const channels = new Map([['c1', { name: 'music', sendable: false }]]);
  const client = statusClient({ nodes: [true, false], player: { voiceChannelId: 'v1' }, channels });
  await withApp(statusRouter(client, { config: { playerTextChannelId: 'c1' } }), async (get) => {
    const health = await (await get('/api/guilds/g1/health')).json();
    assert.equal(health.api.ok, true);
    assert.deepEqual(health.discord, { ok: true, wsStatusCode: 0, ping: 42 });
    assert.deepEqual(health.lavalink, { ok: true, connectedNodes: 1, totalNodes: 2 });
    assert.deepEqual(health.player, { exists: true, connected: true });
    assert.deepEqual(health.playerMessageChannel, { configured: true, channelId: 'c1', channelName: 'music', sendable: false });
  });
});

test('health stays readable when nothing is connected or configured', async () => {
  const client = statusClient({ ready: false });
  client.ws = undefined;
  await withApp(statusRouter(client), async (get) => {
    const health = await (await get('/api/guilds/g1/health')).json();
    assert.deepEqual(health.discord, { ok: false, wsStatusCode: null, ping: null });
    assert.deepEqual(health.lavalink, { ok: false, connectedNodes: 0, totalNodes: 0 });
    assert.deepEqual(health.player, { exists: false, connected: false });
    assert.deepEqual(health.playerMessageChannel, { configured: false, channelId: null, channelName: null, sendable: null });
  });

  await withApp(statusRouter(statusClient(), { config: { playerTextChannelId: 'deleted' } }), async (get) => {
    const health = await (await get('/api/guilds/g1/health')).json();
    assert.deepEqual(health.playerMessageChannel, { configured: true, channelId: 'deleted', channelName: null, sendable: false });
  });
});

test('insights clamp the limit and fall back to the full range', async () => {
  const insights = [];
  await withApp(statusRouter(statusClient(), { insights }), async (get) => {
    await get('/api/guilds/g1/insights');
    await get('/api/guilds/g1/insights?limit=500&range=7d');
    await get('/api/guilds/g1/insights?limit=-3&range=forever');
    await get('/api/guilds/g1/insights?limit=abc&range=24h');
  });
  assert.deepEqual(insights, [
    { guildId: 'g1', limit: 5, range: 'all' },
    { guildId: 'g1', limit: 25, range: '7d' },
    { guildId: 'g1', limit: 1, range: 'all' },
    { guildId: 'g1', limit: 5, range: '24h' },
  ]);
});
