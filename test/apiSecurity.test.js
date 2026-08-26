const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-api-security-'));
process.env.BREAD_DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'api-security-test-secret';
process.env.WEB_URL = 'http://localhost:3000';

const { createApiServer, __testing } = require('../src/server');

const GUILD_ID = 'security-test-guild';

function makeClient() {
  return {
    on() {
      return this;
    },
    isReady() {
      return true;
    },
    ws: { status: 0, ping: 12 },
    guilds: { cache: new Map() },
    lavalink: {
      nodeManager: { nodes: new Map([['node', { connected: true }]]) },
      players: new Map(),
    },
  };
}

async function withServer(callback) {
  const server = createApiServer(makeClient()).listen(0);
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('protected API endpoints reject unauthenticated requests', async () => {
  await withServer(async (baseUrl) => {
    for (const url of [
      `/api/guilds/${GUILD_ID}/status`,
      `/api/guilds/${GUILD_ID}/queue?page=0`,
      `/api/guilds/${GUILD_ID}/player/events?page=0`,
      `/api/guilds/${GUILD_ID}/config`,
    ]) {
      const response = await fetch(`${baseUrl}${url}`);
      assert.equal(response.status, 401, url);
      assert.deepEqual(await response.json(), { error: 'Not authenticated' });
    }
  });
});

test('state-changing routes enforce trusted browser origins', async () => {
  await withServer(async (baseUrl) => {
    const missingOrigin = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    assert.equal(missingOrigin.status, 403);

    const foreignOrigin = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://example.invalid' },
    });
    assert.equal(foreignOrigin.status, 403);

    const trustedOrigin = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.equal(trustedOrigin.status, 200);
    assert.deepEqual(await trustedOrigin.json(), { success: true });
  });
});

test('Activity bearer identity takes precedence over an existing dashboard session', async () => {
  const sessionUser = { id: 'dashboard-user' };
  const activityUser = { id: 'activity-user' };
  const req = {
    session: { user: sessionUser },
    get(name) {
      return name.toLowerCase() === 'authorization' ? 'Bearer activity-token' : '';
    },
  };

  const auth = await __testing.resolveRequestAuth(req, async (token) => {
    assert.equal(token, 'activity-token');
    return activityUser;
  });
  assert.deepEqual(auth, { activityUser });
});

test('an invalid Activity bearer token never falls back to a dashboard session', async () => {
  const req = {
    session: { user: { id: 'dashboard-user' } },
    get(name) {
      return name.toLowerCase() === 'authorization' ? 'Bearer expired-token' : '';
    },
  };

  const auth = await __testing.resolveRequestAuth(req, async () => null);
  assert.deepEqual(auth, { error: 'Activity authentication expired' });
});
