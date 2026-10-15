const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');

const { createAuthRouter } = require('../src/routes/auth');

const ENV_KEYS = ['WEB_URL', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
process.env.WEB_URL = 'https://bread.test';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';

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

// Answers the OAuth token exchange and /users/@me like Discord would.
async function fakeDiscord({ tokenStatus = 200 } = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const exchanges = [];
  app.post('/oauth2/token', (req, res) => {
    exchanges.push(req.body);
    if (tokenStatus !== 200) return res.status(tokenStatus).json({ error: 'invalid_grant' });
    res.json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 });
  });
  app.get('/users/@me', (req, res) => {
    if (req.headers.authorization !== 'Bearer access-1') return res.status(401).end();
    res.json({ id: '42', username: 'baker', discriminator: '0', avatar: null, global_name: 'Baker' });
  });
  const { server, url } = await listen(app);
  return { server, url, exchanges };
}

async function withAuthApp({ discord, refreshAccessToken = async () => null }, callback) {
  const app = express();
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false, name: 'bread.sid' }));
  // Lets a test plant session state the way an earlier request would have.
  app.post('/test/session', express.json(), (req, res) => {
    Object.assign(req.session, req.body);
    req.session.save(() => res.json({ ok: true }));
  });
  app.use(createAuthRouter({
    discordApi: discord?.url || 'http://127.0.0.1:9',
    scopes: 'identify guilds',
    requireAuth: (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'Not authenticated' })),
    requireTrustedOrigin: (_req, _res, next) => next(),
    refreshAccessToken,
  }));
  const { server, url } = await listen(app);

  let cookie = '';
  const request = async (pathname, options = {}) => {
    const response = await fetch(`${url}${pathname}`, {
      redirect: 'manual',
      ...options,
      headers: { ...(options.headers || {}), ...(cookie ? { cookie } : {}) },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  };

  try {
    await callback({ request, cookie: () => cookie });
  } finally {
    server.close();
    discord?.server.close();
  }
}

async function startLogin(request) {
  const response = await request('/api/auth/discord');
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  return { location, state: location.searchParams.get('state') };
}

test('login sends the user to Discord with a fresh state and the callback url', async () => {
  await withAuthApp({}, async ({ request }) => {
    const { location, state } = await startLogin(request);
    assert.equal(location.origin + location.pathname, 'https://discord.com/oauth2/authorize');
    assert.equal(location.searchParams.get('client_id'), 'test-client-id');
    assert.equal(location.searchParams.get('redirect_uri'), 'https://bread.test/api/auth/callback');
    assert.equal(location.searchParams.get('scope'), 'identify guilds');
    assert.match(state, /^[0-9a-f]{48}$/);

    const again = await startLogin(request);
    assert.notEqual(again.state, state);
  });
});

test('the callback refuses a missing, forged or reused state', async () => {
  const discord = await fakeDiscord();
  await withAuthApp({ discord }, async ({ request }) => {
    const noLogin = await request('/api/auth/callback?code=abc&state=whatever');
    assert.equal(noLogin.headers.get('location'), '/?error=invalid_state');

    const { state } = await startLogin(request);
    const forged = await request(`/api/auth/callback?code=abc&state=${'0'.repeat(48)}`);
    assert.equal(forged.headers.get('location'), '/?error=invalid_state');

    // The forged attempt used up the stored state, so the real one no longer works either.
    const reused = await request(`/api/auth/callback?code=abc&state=${state}`);
    assert.equal(reused.headers.get('location'), '/?error=invalid_state');
    assert.deepEqual(discord.exchanges, [], 'no code was ever sent to Discord');
  });
});

test('a valid callback signs the user in under a new session id and hides the tokens', async () => {
  const discord = await fakeDiscord();
  await withAuthApp({ discord }, async ({ request, cookie }) => {
    const { state } = await startLogin(request);
    const preLoginCookie = cookie();

    const callback = await request(`/api/auth/callback?code=the-code&state=${state}`);
    assert.equal(callback.headers.get('location'), '/dashboard');
    assert.notEqual(cookie(), preLoginCookie, 'the session id rotates on login');
    assert.equal(discord.exchanges[0].code, 'the-code');
    assert.equal(discord.exchanges[0].redirect_uri, 'https://bread.test/api/auth/callback');

    const me = await request('/api/me');
    assert.deepEqual(await me.json(), { id: '42', username: 'baker', discriminator: '0', avatar: null, global_name: 'Baker' });

    const replay = await request(`/api/auth/callback?code=the-code&state=${state}`);
    assert.equal(replay.headers.get('location'), '/?error=invalid_state');
  });
});

test('a declined consent or a failed token exchange lands back on the home page with a reason', async () => {
  const discord = await fakeDiscord({ tokenStatus: 400 });
  const originalError = console.error;
  console.error = () => {};
  try {
    await withAuthApp({ discord }, async ({ request }) => {
      let { state } = await startLogin(request);
      const declined = await request(`/api/auth/callback?error=access_denied&state=${state}`);
      assert.equal(declined.headers.get('location'), '/?error=access_denied');

      ({ state } = await startLogin(request));
      const noCode = await request(`/api/auth/callback?state=${state}`);
      assert.equal(noCode.headers.get('location'), '/?error=no_code');

      ({ state } = await startLogin(request));
      const failed = await request(`/api/auth/callback?code=bad&state=${state}`);
      assert.equal(failed.headers.get('location'), '/?error=token_failed');

      assert.equal((await request('/api/me')).status, 401);
    });
  } finally {
    console.error = originalError;
  }
});

test('/api/me refreshes an expired token and keeps the user signed in', async () => {
  const refreshed = [];
  await withAuthApp({
    refreshAccessToken: async (token) => {
      refreshed.push(token);
      return { access_token: 'access-2', expires_in: 3600 };
    },
  }, async ({ request }) => {
    await request('/test/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: { id: '7', username: 'old', refreshToken: 'refresh-7', tokenExpires: Date.now() - 1000 } }),
    });
    const me = await request('/api/me');
    assert.equal(me.status, 200);
    assert.equal((await me.json()).id, '7');
    assert.deepEqual(refreshed, ['refresh-7']);

    await request('/api/me');
    assert.equal(refreshed.length, 1, 'the new expiry was saved, so no second refresh');
  });
});

test('logout only works as a POST and ends the session', async () => {
  await withAuthApp({}, async ({ request }) => {
    await request('/test/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: { id: '7', tokenExpires: Date.now() + 60_000 } }),
    });
    assert.equal((await request('/api/auth/logout')).status, 405);
    assert.equal((await request('/api/me')).status, 200);

    const logout = await request('/api/auth/logout', { method: 'POST' });
    assert.deepEqual(await logout.json(), { success: true });
    assert.equal((await request('/api/me')).status, 401);
  });
});
