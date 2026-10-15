const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createActivityRouter } = require('../src/routes/activity');
const { isAllowedActivityArtworkHost } = require('../src/api/playerSnapshot');
const { createFixedWindowRateLimiter } = require('../src/utils/rateLimit');

const ENV_KEYS = ['ACTIVITY_ENABLED', 'ACTIVITY_DEBUG_FAILURE', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
function resetEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.DISCORD_CLIENT_ID = 'activity-client';
  process.env.DISCORD_CLIENT_SECRET = 'activity-secret';
}
test.beforeEach(resetEnv);
test.after(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

// Answers the Activity code exchange like Discord would.
async function fakeDiscord() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const exchanges = [];
  app.post('/oauth2/token', (req, res) => {
    exchanges.push(req.body);
    if (req.body.code !== 'good-code') return res.status(400).json({ error: 'invalid_grant' });
    res.json({ access_token: 'activity-access', expires_in: 3600, refresh_token: 'never-sent-to-the-client' });
  });
  return { ...(await listen(app)), exchanges };
}

async function withActivityApp({ discordApi = 'http://127.0.0.1:9', artworkMax = 10, tokenMax = 10, artworkMaxBytes = 1024 } = {}, callback) {
  const app = express();
  app.use(express.json());
  app.use(createActivityRouter({
    discordApi,
    artworkMaxBytes,
    artworkRateLimit: createFixedWindowRateLimiter({ windowMs: 60_000, max: artworkMax }),
    tokenRateLimit: createFixedWindowRateLimiter({ windowMs: 60_000, max: tokenMax }),
    isAllowedArtworkHost: isAllowedActivityArtworkHost,
  }));
  const { server, url } = await listen(app);
  const request = (pathname, init) => fetch(`${url}${pathname}`, init);
  const exchange = (body) => request('/api/activity/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    await callback({ request, exchange });
  } finally {
    server.close();
  }
}

// The artwork proxy only fetches https hosts, so upstream calls are answered in-process.
async function withUpstream(handler, callback) {
  const realFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    upstreamCalls.push({ url, init });
    return handler(url, init);
  };
  try {
    await callback(upstreamCalls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const artworkPath = (url) => `/api/activity/artwork?url=${encodeURIComponent(url)}`;

test('the activity config reports whether it is on and only known debug failures', async () => {
  await withActivityApp({}, async ({ request }) => {
    assert.deepEqual(await (await request('/api/activity/config')).json(), { enabled: true, clientId: 'activity-client', debugFailure: null });

    process.env.ACTIVITY_ENABLED = 'false';
    process.env.ACTIVITY_DEBUG_FAILURE = ' voice ';
    assert.deepEqual(await (await request('/api/activity/config')).json(), { enabled: false, clientId: 'activity-client', debugFailure: 'voice' });

    process.env.ACTIVITY_DEBUG_FAILURE = '<script>';
    assert.equal((await (await request('/api/activity/config')).json()).debugFailure, null);
  });
});

test('the code exchange returns only the access token and its lifetime', async () => {
  const discord = await fakeDiscord();
  try {
    await withActivityApp({ discordApi: discord.url }, async ({ exchange }) => {
      const response = await exchange({ code: '  good-code  ' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { access_token: 'activity-access', expires_in: 3600 });
      assert.deepEqual(discord.exchanges[0], {
        client_id: 'activity-client',
        client_secret: 'activity-secret',
        grant_type: 'authorization_code',
        code: 'good-code',
      });

      const refused = await exchange({ code: 'bad-code' });
      assert.equal(refused.status, 401);
    });
  } finally {
    discord.server.close();
  }
});

test('the code exchange rejects missing or oversized codes before calling Discord', async () => {
  const discord = await fakeDiscord();
  try {
    await withActivityApp({ discordApi: discord.url }, async ({ exchange, request }) => {
      for (const body of [{}, { code: '   ' }, { code: 42 }, { code: 'x'.repeat(513) }]) {
        assert.equal((await exchange(body)).status, 400, JSON.stringify(body).slice(0, 40));
      }
      assert.equal((await request('/api/activity/token', { method: 'POST' })).status, 400, 'no body at all');
      assert.deepEqual(discord.exchanges, []);
    });
  } finally {
    discord.server.close();
  }
});

test('the code exchange is off when the Activity is disabled and rate limited per client', async () => {
  await withActivityApp({ tokenMax: 2 }, async ({ exchange }) => {
    process.env.ACTIVITY_ENABLED = 'false';
    assert.equal((await exchange({ code: 'good-code' })).status, 404);
    process.env.ACTIVITY_ENABLED = 'true';

    assert.equal((await exchange({})).status, 400);
    assert.equal((await exchange({})).status, 400);
    const limited = await exchange({});
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});

test('an unreachable Discord gives a 502 instead of hanging the Activity', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await withActivityApp({ discordApi: 'http://127.0.0.1:9' }, async ({ exchange }) => {
      assert.equal((await exchange({ code: 'good-code' })).status, 502);
    });
  } finally {
    console.error = originalError;
  }
});

test('the artwork proxy only fetches https images from known hosts', async () => {
  await withUpstream(() => new Response('img'), async (upstreamCalls) => {
    await withActivityApp({}, async ({ request }) => {
      assert.equal((await request(artworkPath('not a url'))).status, 400);
      assert.equal((await request('/api/activity/artwork')).status, 400);
      for (const url of [
        'http://i.ytimg.com/vi/x/hq.jpg',
        'https://evil.example/x.jpg',
        'https://i.ytimg.com.evil.example/x.jpg',
        'https://127.0.0.1/x.jpg',
      ]) {
        assert.equal((await request(artworkPath(url))).status, 403, url);
      }
    });
    assert.deepEqual(upstreamCalls, []);
  });
});

test('the artwork proxy serves raster images with a long cache and refuses redirects', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  await withUpstream(() => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }), async (upstreamCalls) => {
    await withActivityApp({}, async ({ request }) => {
      const response = await request(artworkPath('https://i.ytimg.com/vi/abc/hqdefault.jpg'));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      assert.match(response.headers.get('cache-control'), /max-age=86400/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    });
    assert.equal(upstreamCalls[0].init.redirect, 'error');
  });
});

test('the artwork proxy refuses svg, failed and oversized upstream answers', async () => {
  const answers = {
    'https://i.ytimg.com/svg.jpg': () => new Response('<svg onload="alert(1)"/>', { headers: { 'content-type': 'image/svg+xml' } }),
    'https://i.ytimg.com/html.jpg': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    'https://i.ytimg.com/missing.jpg': () => new Response('nope', { status: 404, headers: { 'content-type': 'image/png' } }),
    'https://i.ytimg.com/declared.jpg': () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': '5000' } }),
    'https://i.ytimg.com/actual.jpg': () => new Response(Buffer.alloc(2048), { headers: { 'content-type': 'image/png' } }),
    'https://i.ytimg.com/down.jpg': () => { throw new Error('socket hang up'); },
  };
  const expected = { svg: 404, html: 404, missing: 404, declared: 413, actual: 413, down: 502 };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await withUpstream((url) => answers[url](), async () => {
      await withActivityApp({ artworkMaxBytes: 1024 }, async ({ request }) => {
        for (const [name, status] of Object.entries(expected)) {
          const response = await request(artworkPath(`https://i.ytimg.com/${name}.jpg`));
          assert.equal(response.status, status, name);
          assert.match(response.headers.get('content-type'), /application\/json/, `${name} never echoes the upstream body`);
        }
      });
    });
  } finally {
    console.warn = originalWarn;
  }
});

test('the artwork proxy is rate limited per client', async () => {
  await withActivityApp({ artworkMax: 2 }, async ({ request }) => {
    assert.equal((await request(artworkPath('nope'))).status, 400);
    assert.equal((await request(artworkPath('nope'))).status, 400);
    const limited = await request(artworkPath('nope'));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});
