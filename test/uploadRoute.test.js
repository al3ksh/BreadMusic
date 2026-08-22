const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-upload-route-'));
process.env.BREAD_DATA_DIR = testDataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'upload-route-session-secret';
process.env.UPLOAD_SIGNING_SECRET = 'upload-route-signing-secret';
process.env.WEB_URL = 'http://localhost:3000';

const { createApiServer } = require('../src/server');
const { createSignedUploadUrl } = require('../src/music/uploadUrls');

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
  const guildId = 'upload-test-guild';
  const uploadId = 'a'.repeat(64);
  const fileName = 'demo.mp3';
  const directory = path.join(testDataDir, 'uploads', guildId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${uploadId}.mp3`), Buffer.from('audio-test'));

  const server = createApiServer(makeClient()).listen(0);
  try {
    const address = server.address();
    const signed = new URL(createSignedUploadUrl({
      baseUrl: `http://127.0.0.1:${address.port}`,
      guildId,
      uploadId,
      fileName,
    }));
    await callback({ baseUrl: `http://127.0.0.1:${address.port}`, signed });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('upload endpoint rejects missing, invalid, modified, and expired signatures', async () => {
  await withServer(async ({ baseUrl, signed }) => {
    const endpoint = `${baseUrl}${signed.pathname}`;

    assert.equal((await fetch(endpoint)).status, 403);
    assert.equal((await fetch(`${endpoint}?expires=${signed.searchParams.get('expires')}&signature=${'0'.repeat(64)}`)).status, 403);
    assert.equal((await fetch(`${baseUrl}${signed.pathname.replace('demo.mp3', 'renamed.mp3')}${signed.search}`)).status, 403);

    const expired = new URL(signed);
    expired.searchParams.set('expires', String(Math.floor(Date.now() / 1000) - 1));
    assert.equal((await fetch(expired)).status, 403);
  });
});

test('upload endpoint serves an existing file with a valid signature', async () => {
  await withServer(async ({ signed }) => {
    const response = await fetch(signed);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'audio-test');
  });
});
