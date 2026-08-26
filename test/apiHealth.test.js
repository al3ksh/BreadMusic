const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-api-health-'));
process.env.BREAD_DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'api-health-test-secret';
process.env.WEB_URL = 'http://localhost:3000';

const { createApiServer } = require('../src/server');

function makeClient({ ready = true, connectedNodes = 1 } = {}) {
  const nodes = new Map();
  for (let index = 0; index < connectedNodes; index += 1) {
    nodes.set(`node-${index}`, { connected: true });
  }

  return {
    on() {
      return this;
    },
    isReady() {
      return ready;
    },
    ws: { status: ready ? 0 : 6, ping: 42 },
    guilds: { cache: new Map() },
    lavalink: {
      nodeManager: { nodes },
      players: new Map(),
    },
  };
}

async function withServer(client, callback) {
  const server = createApiServer(client).listen(0);
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('healthz reports ready dependencies and security headers', async () => {
  await withServer(makeClient(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/healthz`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.discord.ok, true);
    assert.equal(payload.lavalink.connectedNodes, 1);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  });
});

test('healthz returns service unavailable while a dependency is down', async () => {
  await withServer(makeClient({ ready: false, connectedNodes: 0 }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/healthz`);
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.equal(payload.discord.ok, false);
    assert.equal(payload.lavalink.ok, false);
  });
});
