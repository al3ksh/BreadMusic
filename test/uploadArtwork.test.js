const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const express = require('express');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-covers-'));
process.env.BREAD_DATA_DIR = directory;
process.env.SESSION_SECRET = 'test-cover-secret';
process.env.WEB_URL = 'https://bread.example.test';
process.env.UPLOAD_STORAGE_LIMIT_MB = '256';
const { prepareUploadArtwork, storeUploadArtwork, runExtraction } = require('../src/music/uploadArtwork');
const { artworkPath, groupUploadFiles, uploadArtworkUrl, verifyArtworkUrl } = require('../src/music/uploadArtworkUrls');
const { createUploadRouter } = require('../src/routes/uploads');
const { createSignedUploadUrl, hasValidUploadSignature } = require('../src/music/uploadUrls');
const { resolveArtwork } = require('../src/music/embeds');

test.after(() => {
  require('../src/state/sqliteStore').closeDatabases();
  fs.rmSync(directory, { recursive: true, force: true });
});

function uint32(value) { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; }
function atom(type, ...data) {
  const content = Buffer.concat(data);
  return Buffer.concat([uint32(content.length + 8), Buffer.from(type, 'latin1'), content]);
}
function mp3(pictures) {
  const frames = pictures.map(({ data, type = 3 }) => {
    const payload = Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([type, 0]), data]);
    return Buffer.concat([Buffer.from('APIC'), uint32(payload.length), Buffer.alloc(2), payload]);
  });
  const tag = Buffer.concat(frames);
  const length = tag.length;
  const header = Buffer.from([73, 68, 51, 3, 0, 0, (length >> 21) & 127, (length >> 14) & 127, (length >> 7) & 127, length & 127]);
  const audio = Buffer.alloc(417 * 4);
  for (let i = 0; i < 4; i++) Buffer.from([255, 251, 144, 0]).copy(audio, i * 417);
  return Buffer.concat([header, tag, audio]);
}
function flac(picture) {
  const info = Buffer.alloc(34);
  info.writeUInt16BE(4096, 0); info.writeUInt16BE(4096, 2);
  info[10] = 10; info[11] = 196; info[12] = 66; info[13] = 240;
  const mime = Buffer.from('image/png');
  const pic = Buffer.concat([uint32(3), uint32(mime.length), mime, uint32(0), uint32(800), uint32(400), uint32(24), uint32(0), uint32(picture.length), picture]);
  const picHeader = Buffer.alloc(4); picHeader[0] = 0x86; picHeader.writeUIntBE(pic.length, 1, 3);
  return Buffer.concat([Buffer.from('fLaC'), Buffer.from([0, 0, 0, 34]), info, picHeader, pic]);
}
function m4a(picture) {
  return Buffer.concat([
    atom('ftyp', Buffer.from('M4A '), uint32(0), Buffer.from('M4A isom')),
    atom('moov', atom('udta', atom('meta', uint32(0), atom('ilst', atom('covr', atom('data', uint32(14), uint32(0), picture)))))),
  ]);
}

test('extracts front-cover JPEG thumbnails from MP3, FLAC and M4A without modifying audio', async () => {
  const picture = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#27b079' } }).png().toBuffer();
  const back = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#ec2020' } }).png().toBuffer();
  for (const [extension, input] of [['mp3', mp3([{ data: back, type: 4 }, { data: picture }])], ['flac', flac(picture)], ['m4a', m4a(picture)]]) {
    const file = path.join(directory, `cover.${extension}`);
    fs.writeFileSync(file, input);
    const result = await prepareUploadArtwork(file);
    assert.equal(result?.hasCover, true, extension);
    const metadata = await sharp(result.data).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 512); assert.equal(metadata.height, 256);
    assert.equal(metadata.exif, undefined);
    assert.ok(result.data.length <= 256 * 1024);
    assert.deepEqual(fs.readFileSync(file), input);
    assert.equal(await storeUploadArtwork(file, result.data), true);
    assert.deepEqual(await prepareUploadArtwork(file), { cached: true, hasCover: true });
  }
});

test('no cover, invalid pictures, SVG, oversized images and corrupt files safely fall back', async () => {
  const tooLarge = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const candidates = [mp3([]), mp3([{ data: Buffer.from('bad') }]), mp3([{ data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }]), mp3([{ data: tooLarge }]), mp3([{ data: Buffer.alloc(6 * 1024 * 1024) }]), Buffer.from('not audio')];
  for (const [index, input] of candidates.entries()) {
    const file = path.join(directory, `no-cover-${index}.mp3`);
    fs.writeFileSync(file, input);
    const result = await prepareUploadArtwork(file);
    assert.equal(result?.hasCover, false, String(index));
    await storeUploadArtwork(file, result.data);
    assert.deepEqual(await prepareUploadArtwork(file), { cached: true, hasCover: false });
  }
});

test('single process has no backlog, coalesces duplicates, and really terminates on timeout', async () => {
  const file = path.join(directory, 'concurrent.mp3');
  const other = path.join(directory, 'busy.mp3');
  fs.writeFileSync(file, mp3([])); fs.writeFileSync(other, mp3([]));
  const first = prepareUploadArtwork(file);
  const duplicate = prepareUploadArtwork(file);
  const busy = prepareUploadArtwork(other);
  assert.deepEqual(await first, await duplicate);
  assert.equal(await busy, null);
  const start = Date.now();
  assert.equal(await runExtraction(file, { timeoutMs: 1 }), null);
  assert.ok(Date.now() - start < 2000);
  assert.equal((await prepareUploadArtwork(other)).hasCover, false);
});

test('quota groups derivative bytes with audio and keeps the parent expiry/protection identity', () => {
  const audio = path.join(directory, 'group.mp3');
  const files = groupUploadFiles([
    { path: audio, size: 100, mtimeMs: 2000 },
    { path: artworkPath(audio), size: 30, mtimeMs: 1 },
    { path: artworkPath(path.join(directory, 'gone.flac')), size: 40, mtimeMs: 1000 },
  ]);
  assert.equal(files.length, 2);
  assert.deepEqual(files[0], { path: audio, size: 130, mtimeMs: 2000 });
  assert.equal(files[1].orphan, true);
});

const ref = { guildId: 'guild1', uploadId: 'a'.repeat(64), extension: '.mp3' };
test('cover URLs are stable within the hour, renewable, public for Discord and scoped to one resource', () => {
  const now = Math.floor(Date.now() / 3600000) * 3600000 + 1000;
  const relative = uploadArtworkUrl(ref, { now });
  assert.equal(relative, uploadArtworkUrl(ref, { now: now + 1000 }));
  assert.notEqual(relative, uploadArtworkUrl(ref, { now: now + 3600000 }));
  const url = new URL(relative, process.env.WEB_URL);
  assert.equal(verifyArtworkUrl(ref, Object.fromEntries(url.searchParams)), true);
  assert.equal(verifyArtworkUrl({ ...ref, guildId: 'guild2' }, Object.fromEntries(url.searchParams)), false);
  assert.equal(verifyArtworkUrl(ref, { ...Object.fromEntries(url.searchParams), expires: 1 }), false);
  assert.equal(uploadArtworkUrl({ ...ref, extension: '/../x' }), null);
  assert.match(resolveArtwork({ info: { uploadArtwork: ref } }), /^https:\/\/bread\.example\.test\/api\/uploads\//);
  process.env.WEB_URL = 'http://bot:3001';
  assert.equal(resolveArtwork({ info: { uploadArtwork: ref } }), null);
  process.env.WEB_URL = 'https://bread.example.test';
});

test('signed cover endpoint rejects audio signatures, traversal, expiry and absent covers', async () => {
  const dir = path.join(directory, ref.guildId); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ref.uploadId}.mp3`); fs.writeFileSync(file, mp3([]));
  const cover = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#27b079' } }).jpeg().toBuffer();
  await storeUploadArtwork(file, cover);
  const app = express();
  app.use(createUploadRouter({ uploadDir: directory, audioExtensions: new Set(['.mp3']), hasValidUploadSignature,
    isSafeId: (id) => /^[a-zA-Z0-9_-]+$/.test(id), isPathInside: (file, dir) => path.resolve(file).startsWith(`${path.resolve(dir)}${path.sep}`), getAudioContentType: () => 'audio/mpeg' }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const relative = uploadArtworkUrl(ref);
    const response = await fetch(base + relative);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), cover);
    const audio = new URL(createSignedUploadUrl({ baseUrl: base, ...ref, fileName: 'audio.mp3' }));
    const pathname = relative.split('?')[0];
    assert.equal((await fetch(base + pathname)).status, 403);
    assert.equal((await fetch(base + pathname + audio.search)).status, 403);
    assert.equal((await fetch(base + relative.replace('guild1', 'guild2'))).status, 403);
    assert.equal((await fetch(base + relative.replace(/expires=\d+/, 'expires=1'))).status, 403);
    assert.notEqual((await fetch(base + relative.replace('guild1', '..%2Foutside'))).status, 200);
    await storeUploadArtwork(file, Buffer.alloc(0));
    assert.equal((await fetch(base + relative)).status, 404);
    await storeUploadArtwork(file, cover); fs.unlinkSync(file);
    assert.equal((await fetch(base + relative)).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('persistent local tracks restore a fresh signed cover and old entries still work', async () => {
  const { refreshLocalUploadTrack } = require('../src/state/queueStore');
  const file = path.join(directory, 'restored.mp3'); fs.writeFileSync(file, mp3([]));
  await storeUploadArtwork(file, Buffer.from('test-cover'));
  const entry = { encoded: 'old', info: { title: 'Local song', uploadArtwork: ref, artworkUrl: 'https://expired.example/cover' },
    localUpload: { guildId: ref.guildId, uploadId: ref.uploadId, fileName: 'restored.mp3', filePath: file } };
  const node = { search: async () => ({ tracks: [{ encoded: 'new', info: {} }] }) };
  const restored = await refreshLocalUploadTrack(node, entry, {});
  assert.deepEqual(restored.info.uploadArtwork, ref);
  assert.match(restored.info.artworkUrl, /signature=/);
  fs.unlinkSync(artworkPath(file));
  const missing = await refreshLocalUploadTrack(node, entry, {});
  assert.equal(missing.info.artworkUrl, null);
  assert.equal(missing.info.uploadArtwork, null);
});

test('cleanup and quota protect active and stored audio-cover pairs, evict together and remove orphans', async () => {
  const { __testing: { cleanupExpiredAudioUploads, makeRoomForAudioUpload } } = require('../src/server');
  const { setConfig } = require('../src/state/guildConfig');
  const { savePlayerState, clearStoredQueue, flushQueueStore } = require('../src/state/queueStore');
  const dir = path.join(directory, 'uploads', 'protected-guild'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${'b'.repeat(64)}.mp3`);
  const writePair = () => {
    fs.writeFileSync(file, Buffer.alloc(100)); fs.writeFileSync(artworkPath(file), Buffer.alloc(60));
  };
  writePair();
  const old = new Date(Date.now() - 48 * 3600000);
  fs.utimesSync(file, old, old); fs.utimesSync(artworkPath(file), old, old);
  const current = { encoded: 'test', info: {}, localUpload: { filePath: file } };
  const client = { lavalink: { players: new Map([['protected-guild', { queue: { current, tracks: [] } }]]) } };
  await cleanupExpiredAudioUploads(client);
  assert.ok(fs.existsSync(file)); assert.ok(fs.existsSync(artworkPath(file)));
  assert.equal(await makeRoomForAudioUpload(256 * 1024 * 1024 - 100, client), false);
  setConfig('protected-guild', { persistentQueue: true });
  await savePlayerState({ guildId: 'protected-guild', queue: { current: null, tracks: [], previous: [current] } });
  client.lavalink.players.clear();
  await cleanupExpiredAudioUploads(client);
  assert.ok(fs.existsSync(file)); assert.ok(fs.existsSync(artworkPath(file)));
  assert.equal(await makeRoomForAudioUpload(256 * 1024 * 1024 - 100, client), false);
  clearStoredQueue('protected-guild');
  await cleanupExpiredAudioUploads(client);
  assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(artworkPath(file)), false);
  writePair();
  assert.equal(await makeRoomForAudioUpload(256 * 1024 * 1024 - 100, client), true);
  assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(artworkPath(file)), false);
  fs.writeFileSync(artworkPath(file), Buffer.alloc(60));
  await cleanupExpiredAudioUploads(client);
  assert.equal(fs.existsSync(artworkPath(file)), false);
  await flushQueueStore();
  // Let the existing config store's debounced write finish before closing SQLite.
  await new Promise((resolve) => setTimeout(resolve, 1100));
});
