const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-autoplay-pool-'));

const pool = require('../src/music/autoplay/pool');
const {
  addManualSeed,
  autoplayEvents,
  clearAutoplayState,
  getAutoplayNext,
  handleAutoplay,
  recordAutoplaySkip,
  setAutoplay,
  setAutoplayMode,
  __testing,
} = require('../src/music/autoplay');
const { closeDatabases } = require('../src/state/sqliteStore');

test.after(() => {
  closeDatabases();
  fs.rmSync(process.env.BREAD_DATA_DIR, { recursive: true, force: true });
});

function track(title, author, identifier) {
  return {
    info: {
      title,
      author,
      identifier,
      uri: `https://www.youtube.com/watch?v=${identifier}`,
      duration: 200_000,
      sourceName: 'youtube',
    },
  };
}

function id(prefix, index) {
  return `${prefix}${String(index).padStart(11 - prefix.length, '0')}`;
}

function radioTracks(count = 12) {
  return Array.from({ length: count }, (_, index) => track(`Song ${index}`, `Artist ${index}`, id('r', index)));
}

function fakeNode(handler = (query) => ({ tracks: query.startsWith('https://') ? radioTracks() : [] })) {
  const node = {
    calls: [],
    connected: true,
    handler,
    async search({ query }) {
      node.calls.push(query);
      return node.handler(query);
    },
  };
  return node;
}

function setup(guildId, node = fakeNode()) {
  clearAutoplayState(guildId);
  setAutoplay(guildId, true);
  setAutoplayMode(guildId, 'classic');
  // clearAutoplayState blocks autoplay briefly after a disconnect; a fresh session starts unblocked.
  const seed = track('Seed Song', 'Seed Artist', 'seedseedsee');
  addManualSeed(guildId, seed);

  const queue = {
    tracks: [],
    current: seed,
    async add(next) { queue.tracks.push(next); },
  };
  const player = {
    guildId,
    node,
    queue,
    playing: true,
    paused: false,
    async play() {
      player.playing = true;
      queue.current = queue.tracks.shift();
    },
  };
  const client = { user: null, lavalink: { players: new Map([[guildId, player]]) } };
  return { player, client, node, seed };
}

function endCurrent(player) {
  const ended = player.queue.current;
  player.playing = false;
  player.queue.current = null;
  return ended;
}

test('prepared next is consumed without new searches', async () => {
  const { player, client, node, seed } = setup('pool-prepared');

  await __testing.prepareNext(player, seed, client);
  const prepared = getAutoplayNext('pool-prepared');
  assert.ok(prepared, 'a next track should be prepared');

  const callsBefore = node.calls.length;
  const ended = endCurrent(player);
  assert.equal(await handleAutoplay(player, ended, client), true);

  assert.equal(player.queue.current.info.identifier, prepared.identifier);
  assert.equal(player.queue.current.isAutoplay, true);
  assert.equal(node.calls.length, callsBefore);
  assert.equal(getAutoplayNext('pool-prepared'), null);
});

test('skip while building uses pool immediately', async () => {
  const { player, client, node, seed } = setup('pool-skip-fast');
  await __testing.prepareNext(player, seed, client);

  // Every later search hangs; the pick must not wait for it.
  node.handler = () => new Promise(() => {});
  const ended = endCurrent(player);
  assert.equal(await handleAutoplay(player, ended, client), true);

  const autoplayTrack = player.queue.current;
  recordAutoplaySkip('pool-skip-fast', autoplayTrack, { position: 5_000 });
  endCurrent(player);

  const startedAt = Date.now();
  assert.equal(await handleAutoplay(player, autoplayTrack, client), true);
  assert.ok(Date.now() - startedAt < 500, 'skip should pick from the existing pool');
  assert.notEqual(player.queue.current.info.identifier, autoplayTrack.info.identifier);
});

test('skip rejection re-picks next from pool', async () => {
  const { player, client, seed } = setup('pool-skip-repick');
  await __testing.prepareNext(player, seed, client);
  const prepared = getAutoplayNext('pool-skip-repick');

  const preparedTrack = { ...track(prepared.title, prepared.author, prepared.identifier), isAutoplay: true };
  recordAutoplaySkip('pool-skip-repick', preparedTrack, { position: 1_000 });

  const ended = endCurrent(player);
  assert.equal(await handleAutoplay(player, ended, client), true);
  assert.notEqual(player.queue.current.info.identifier, prepared.identifier);
});

test('stale epoch never queues', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const node = fakeNode(async (query) => {
    await gate;
    return { tracks: query.startsWith('https://') ? radioTracks() : [] };
  });
  const { player, client } = setup('pool-stale', node);

  const ended = endCurrent(player);
  const pending = handleAutoplay(player, ended, client);
  await new Promise((resolve) => setImmediate(resolve));
  clearAutoplayState('pool-stale');
  release();

  assert.equal(await pending, false);
  assert.equal(player.queue.tracks.length, 0);
  assert.equal(player.queue.current, null);
});

test('empty eligible pool triggers build then exhausted', async () => {
  const node = fakeNode(() => ({ tracks: [] }));
  const { player, client } = setup('pool-exhausted', node);
  const events = [];
  const listener = (guildId, detail) => events.push({ guildId, detail });
  autoplayEvents.on('exhausted', listener);

  try {
    const ended = endCurrent(player);
    assert.equal(await handleAutoplay(player, ended, client), false);
    assert.ok(node.calls.length > 0, 'a build should have been attempted');
    assert.deepEqual(events.map((entry) => entry.guildId), ['pool-exhausted']);
  } finally {
    autoplayEvents.off('exhausted', listener);
  }
});

test('manual seed clears the prepared track and marks the pool stale', async () => {
  const { player, client, node, seed } = setup('pool-manual-seed');
  await __testing.prepareNext(player, seed, client);
  assert.ok(getAutoplayNext('pool-manual-seed'));

  const changes = [];
  const listener = (guildId) => changes.push(guildId);
  autoplayEvents.on('next-changed', listener);
  try {
    addManualSeed('pool-manual-seed', track('New Seed', 'Other Artist', 'newseednews'));
  } finally {
    autoplayEvents.off('next-changed', listener);
  }

  assert.equal(getAutoplayNext('pool-manual-seed'), null);
  assert.deepEqual(changes, ['pool-manual-seed']);

  const callsBefore = node.calls.length;
  const ended = endCurrent(player);
  assert.equal(await handleAutoplay(player, ended, client), true);
  assert.ok(node.calls.length > callsBefore, 'a new profile should rebuild the pool');
});

test('pool merge dedupes by key and keeps the higher-priority source', () => {
  const guildId = 'pool-unit-merge';
  pool.clearPool(guildId);
  const shared = track('Shared', 'Artist', 'sharedshare');

  pool.mergeCandidates(guildId, [
    { track: shared, source: 'discovery', anchorKey: 'a', anchorRank: 2 },
  ], { profileKey: 'p', now: 1_000 });
  pool.mergeCandidates(guildId, [
    { track: shared, source: 'radio', anchorKey: 'b', anchorRank: 0 },
    { track: shared, source: 'search', anchorKey: 'c', anchorRank: 1 },
  ], { profileKey: 'p', now: 2_000 });

  const candidates = pool.getCandidates(guildId, 2_000);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'radio');
  assert.deepEqual([...candidates[0].anchorKeys].sort(), ['a', 'b', 'c']);
  assert.equal(candidates[0].anchorRank, 0);
});

test('pool entries expire after 20 minutes and the pool is capped', () => {
  const guildId = 'pool-unit-expiry';
  pool.clearPool(guildId);

  pool.mergeCandidates(guildId, [{ track: track('Old', 'Artist', 'oldoldoldol'), source: 'search' }], {
    profileKey: 'p',
    now: 0,
  });
  assert.equal(pool.getCandidates(guildId, pool.POOL_TTL_MS + 1).length, 0);

  const many = Array.from({ length: pool.MAX_POOL_SIZE + 30 }, (_, index) => ({
    track: track(`Song ${index}`, `Artist ${index}`, id('m', index)),
    source: 'search',
  }));
  pool.mergeCandidates(guildId, many, { profileKey: 'p', now: pool.POOL_TTL_MS + 2 });
  assert.equal(pool.getCandidates(guildId, pool.POOL_TTL_MS + 2).length, pool.MAX_POOL_SIZE);
});

test('a new profile replaces the old pool only once the rebuild has results', () => {
  const guildId = 'pool-unit-profile';
  pool.clearPool(guildId);

  pool.mergeCandidates(guildId, [{ track: track('Old', 'Artist', 'oldprofileo'), source: 'search' }], { profileKey: 'old' });
  pool.mergeCandidates(guildId, [], { profileKey: 'new' });
  assert.equal(pool.getCandidates(guildId).length, 1);

  pool.mergeCandidates(guildId, [{ track: track('New', 'Artist', 'newprofilen'), source: 'search' }], { profileKey: 'new' });
  assert.deepEqual(pool.getCandidates(guildId).map((entry) => entry.track.info.title), ['New']);
});
