const assert = require('node:assert/strict');
const test = require('node:test');

const previousSigningSecret = process.env.UPLOAD_SIGNING_SECRET;
const previousSessionSecret = process.env.SESSION_SECRET;
process.env.UPLOAD_SIGNING_SECRET = 'test-upload-signing-secret';
delete process.env.SESSION_SECRET;

const {
  buildUploadPath,
  createSignedUploadUrl,
  hasValidUploadSignature,
} = require('../src/music/uploadUrls');
const { refreshLocalUploadTrack } = require('../src/state/queueStore');

test.after(() => {
  if (previousSigningSecret === undefined) delete process.env.UPLOAD_SIGNING_SECRET;
  else process.env.UPLOAD_SIGNING_SECRET = previousSigningSecret;
  if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSessionSecret;
});

test('signed upload URLs use a canonical encoded path and validate', () => {
  const url = createSignedUploadUrl({
    baseUrl: 'http://bot:3001/',
    guildId: 'guild-1',
    uploadId: 'abc123',
    fileName: 'my track.flac',
    expiresAt: 2_000_000_000_000,
  });
  const parsed = new URL(url);

  assert.equal(parsed.origin, 'http://bot:3001');
  assert.equal(parsed.pathname, buildUploadPath({
    guildId: 'guild-1',
    uploadId: 'abc123',
    fileName: 'my track.flac',
  }));
  assert.equal(hasValidUploadSignature({
    guildId: 'guild-1',
    uploadId: 'abc123',
    fileName: 'my track.flac',
    expires: parsed.searchParams.get('expires'),
    signature: parsed.searchParams.get('signature'),
    now: 1_900_000_000_000,
  }), true);
});

test('signed upload URLs reject tampering and expiry', () => {
  const url = createSignedUploadUrl({
    baseUrl: 'http://bot:3001',
    guildId: 'guild-1',
    uploadId: 'abc123',
    fileName: 'track.mp3',
    expiresAt: 2_000_000_000_000,
  });
  const parsed = new URL(url);
  const signature = parsed.searchParams.get('signature');
  const expires = parsed.searchParams.get('expires');

  assert.equal(hasValidUploadSignature({
    guildId: 'guild-2',
    uploadId: 'abc123',
    fileName: 'track.mp3',
    expires,
    signature,
    now: 1_900_000_000_000,
  }), false);
  assert.equal(hasValidUploadSignature({
    guildId: 'guild-1',
    uploadId: 'abc123',
    fileName: 'track.mp3',
    expires,
    signature,
    now: 2_000_000_000_000,
  }), false);
});

test('persistent local uploads are reloaded through a fresh signed URL', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bread-upload-refresh-'));
  const filePath = path.join(tempDir, 'track.mp3');
  await fs.writeFile(filePath, 'test audio');

  let requestedUrl;
  const node = {
    async search({ query }) {
      requestedUrl = query;
      return {
        tracks: [{
          encoded: 'fresh-encoded-track',
          info: { title: 'Loaded from disk', duration: 1234 },
        }],
      };
    },
  };
  const entry = {
    info: { title: 'Persisted title', author: 'Persisted author', uri: 'expired-url' },
    requester: { id: 'user-1', username: 'tester' },
    localUpload: {
      guildId: 'guild-1',
      uploadId: 'upload-1',
      fileName: 'track.mp3',
      filePath,
    },
  };

  try {
    const refreshed = await refreshLocalUploadTrack(node, entry, { id: 'bot' });
    const parsed = new URL(requestedUrl);

    assert.equal(refreshed.encoded, 'fresh-encoded-track');
    assert.equal(refreshed.info.title, 'Persisted title');
    assert.equal(refreshed.info.author, 'Persisted author');
    assert.equal(refreshed.info.sourceName, 'localUpload');
    assert.equal(refreshed.info.uri, requestedUrl);
    assert.equal(hasValidUploadSignature({
      guildId: 'guild-1',
      uploadId: 'upload-1',
      fileName: 'track.mp3',
      expires: parsed.searchParams.get('expires'),
      signature: parsed.searchParams.get('signature'),
    }), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
