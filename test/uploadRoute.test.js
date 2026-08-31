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

const express = require('express');
const { createPlayerRouter } = require('../src/routes/player');

async function withUploadPlayer(options, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-upload-player-'));
  const calls = [];
  const guildId = 'upload-guild';
  const member = { voice: { channelId: 'voice', ...options.memberVoice } };
  const guild = {
    members: { me: { voice: { channelId: options.connected ? 'voice' : null } } },
    channels: { cache: new Map(['voice', 'other'].map((id) => [id, { isVoiceBased: () => true }])) },
  };
  const player = {
    queue: { current: options.current ? { encoded: 'existing-track' } : null, tracks: [] },
    playing: options.playing ?? false,
    paused: options.paused ?? false,
    voiceChannelId: 'voice',
    connect: async () => { calls.push('connect'); },
    disconnect: async () => { calls.push('disconnect'); },
    play: async () => { calls.push('play'); },
  };
  const next = (_req, _res, proceed) => proceed();
  const client = {
    guilds: { cache: new Map([[guildId, guild]]) },
    lavalink: {
      players: new Map(options.existing ? [[guildId, player]] : []),
      createPlayer(config) {
        calls.push('create');
        assert.equal(config.voiceChannelId, 'voice');
        assert.equal(config.volume, 42);
        return player;
      },
    },
    musicUI: { refresh: async () => { calls.push('refresh'); } },
  };
  const app = express();
  app.use(createPlayerRouter({
    client,
    requireAuth(req, _res, proceed) {
      if (options.activity !== false) req.activityUser = { id: 'user' };
      proceed();
    },
    requirePlayerAccess(req, _res, proceed) {
      req.guildMember = member;
      req.dashboardCapabilities = {
        canControlPlayer: options.canControl !== false,
        canUpload: options.canUpload !== false,
      };
      proceed();
    },
    requireTrustedOrigin: next,
    requireDashboardActionRateLimit: next,
    acquireGuildMutex: async () => () => { calls.push('unlock'); },
    broadcastPlayerUpdate: () => { calls.push('broadcast'); },
    getConfig: () => ({ defaultVolume: 42 }),
    resolvePlayerTextChannelId: () => 'text',
    sanitizeUploadName: (name) => path.basename(name),
    decodeUploadHeader: decodeURIComponent,
    isAllowedAudioUpload: (ext) => ext === '.mp3',
    uploadDir: directory,
    audioUploadDirectory: directory,
    uploadMaxBytes: 100,
    activeUploadTempPaths: new Set(),
    streamUploadToFile: async (req, tempPath) => {
      calls.push('stream');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      await fs.promises.writeFile(tempPath, data);
      if (options.leaveDuringUpload) member.voice.channelId = null;
      return { path: tempPath, size: data.length, uploadId: 'a'.repeat(64) };
    },
    isPathInside: () => true,
    acquireUploadQuotaMutex: async () => () => {},
    cleanupExpiredAudioUploads: async () => {},
    fileExists: async () => false,
    safeDeleteFile: async (file) => {
      if (file) await fs.promises.rm(file, { force: true });
    },
    makeRoomForAudioUpload: async () => true,
    renameFileWithRetry: fs.promises.rename,
    createSignedUploadUrl: () => 'http://uploads.test/signed.mp3',
    getUploadPlaybackBaseUrl: () => 'http://uploads.test',
    getDashboardRequester: () => ({ id: 'user' }),
    getUsableNode: () => ({ search: async () => {
      calls.push('resolve');
      return { tracks: options.invalidAudio ? [] : [{ encoded: 'uploaded-track', info: { title: 'Upload' } }] };
    } }),
    isUnknownTrackAuthor: () => true,
    addManualTrackToQueue: async (target, track) => {
      calls.push('queue');
      target.queue.tracks.push(track);
    },
    audioUploadTtlMs: 86400000,
    audioUploadQuotaBytes: 1024,
    savePlayerState: async () => { calls.push('save'); },
    waitForPlayerVoice: async () => { calls.push('voiceReady'); return true; },
    activityVoiceReconnectDelayMs: 0,
    hydratePlayer: async () => { calls.push('restore'); },
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/guilds/${guildId}/player/upload`, {
      method: 'POST',
      headers: { 'X-File-Name': options.fileName || 'demo.mp3', 'Content-Type': 'audio/mpeg' },
      body: Buffer.from('test-audio'),
    });
    await callback({ response, body: await response.json(), calls, player });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('Activity upload summons an absent bot and starts playback after loading audio', async () => {
  await withUploadPlayer({}, async ({ response, body, calls, player }) => {
    assert.equal(response.status, 200);
    assert.equal(body.started, true);
    assert.deepEqual(calls.filter((call) => !['unlock', 'broadcast'].includes(call)),
      ['stream', 'resolve', 'create', 'connect', 'voiceReady', 'restore', 'queue', 'play', 'refresh', 'save']);
    assert.equal(player.queue.tracks[0].info.sourceName, 'localUpload');
  });
});

test('Activity upload reconnects an existing idle player before starting', async () => {
  await withUploadPlayer({ existing: true }, async ({ response, body, calls }) => {
    assert.equal(response.status, 200);
    assert.equal(body.started, true);
    assert.ok(calls.indexOf('connect') < calls.indexOf('play'));
    assert.ok(calls.includes('voiceReady'));
    assert.ok(!calls.includes('create'));
  });
});

test('Activity upload queues without interrupting playing or paused audio', async () => {
  for (const paused of [false, true]) {
    await withUploadPlayer({ existing: true, connected: true, current: true, playing: !paused, paused },
      async ({ response, body, calls }) => {
        assert.equal(response.status, 200);
        assert.equal(body.started, false);
        assert.ok(calls.includes('queue'));
        assert.ok(!calls.includes('play'));
        assert.ok(!calls.includes('connect'));
      });
  }
});

test('Activity upload starts an empty queue despite a stale playing flag', async () => {
  await withUploadPlayer({ existing: true, playing: true }, async ({ body, calls }) => {
    assert.equal(body.started, true);
    assert.ok(calls.includes('play'));
  });
});

test('upload respects Activity controls independently of dashboard upload access', async () => {
  await withUploadPlayer({ canControl: false }, async ({ response, calls }) => {
    assert.equal(response.status, 403);
    assert.ok(!calls.includes('stream'));
  });
  await withUploadPlayer({ canUpload: false }, async ({ response }) => {
    assert.equal(response.status, 200);
  });
  await withUploadPlayer({ activity: false, canUpload: false }, async ({ response }) => {
    assert.equal(response.status, 403);
  });
});

test('Activity upload requires voice and cannot move a bot from another channel', async () => {
  for (const options of [{ memberVoice: { channelId: null } }, { connected: true, memberVoice: { channelId: 'other' } }]) {
    await withUploadPlayer(options, async ({ response, calls }) => {
      assert.equal(response.status, options.connected ? 409 : 403);
      assert.ok(!calls.includes('stream'));
      assert.ok(!calls.includes('connect'));
    });
  }
});

test('invalid audio and leaving during upload never summon or queue the bot', async () => {
  for (const options of [{ fileName: 'demo.exe' }, { invalidAudio: true }, { leaveDuringUpload: true }]) {
    await withUploadPlayer(options, async ({ response, calls }) => {
      assert.ok(response.status >= 400);
      assert.ok(!calls.includes('create'));
      assert.ok(!calls.includes('queue'));
    });
  }
});

test('dashboard upload still supports a connected bot without the requester in voice', async () => {
  await withUploadPlayer({ activity: false, existing: true, connected: true, memberVoice: { channelId: null } },
    async ({ response, calls }) => {
      assert.equal(response.status, 200);
      assert.ok(calls.includes('play'));
      assert.ok(!calls.includes('connect'));
    });
});
