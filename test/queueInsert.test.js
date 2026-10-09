const test = require('node:test');
const assert = require('node:assert/strict');
const { queueRequestedTracks, fitQueueLimit, takeDuplicateWarning } = require('../src/music/queueInsert');

function track(requester, title, extra = {}) {
  return { info: { title }, requester: { id: requester }, ...extra };
}

function createPlayer(current, tracks = []) {
  return {
    guildId: 'queue-guild',
    queue: {
      current,
      tracks,
      add: async (input) => { tracks.push(...(Array.isArray(input) ? input : [input])); },
    },
  };
}

const titles = (player) => player.queue.tracks.map((entry) => entry.info.title);

test('without the fair queue requested tracks append ahead of autoplay picks', async () => {
  const player = createPlayer(track('a', 'now'), [track('a', 'a1'), track('bot', 'auto', { isAutoplay: true })]);
  await queueRequestedTracks(player, [track('b', 'b1'), track('b', 'b2')], { fair: false });
  assert.deepEqual(titles(player), ['a1', 'b1', 'b2', 'auto']);

  const plain = createPlayer(null, [track('a', 'a1')]);
  await queueRequestedTracks(plain, track('b', 'b1'), { fair: false });
  assert.deepEqual(titles(plain), ['a1', 'b1']);
});

test('the fair queue alternates requesters', async () => {
  const player = createPlayer(null, []);
  await queueRequestedTracks(player, [track('a', 'a1'), track('a', 'a2'), track('a', 'a3')], { fair: true });
  await queueRequestedTracks(player, [track('b', 'b1'), track('b', 'b2')], { fair: true });
  await queueRequestedTracks(player, track('c', 'c1'), { fair: true });
  assert.deepEqual(titles(player), ['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
});

test('the playing track counts as its requester\'s turn', async () => {
  const player = createPlayer(track('a', 'now'), [track('a', 'a1')]);
  await queueRequestedTracks(player, track('b', 'b1'), { fair: true });
  assert.deepEqual(titles(player), ['b1', 'a1']);
});

test('the fair queue keeps arrival order within a turn and stays ahead of autoplay', async () => {
  const player = createPlayer(null, [track('a', 'a1'), track('b', 'b1'), track('bot', 'auto', { isAutoplay: true })]);
  await queueRequestedTracks(player, track('a', 'a2'), { fair: true });
  await queueRequestedTracks(player, track('c', 'c1'), { fair: true });
  assert.deepEqual(titles(player), ['a1', 'b1', 'c1', 'a2', 'auto']);
});

const listener = { permissions: { has: () => false }, roles: { cache: { has: () => false } } };
const admin = { permissions: { has: () => true }, roles: { cache: { has: () => false } } };

test('the per-person limit is off by default and trims to the room left', () => {
  const player = createPlayer(track('a', 'now'), [track('a', 'a1'), track('bot', 'auto', { isAutoplay: true })]);
  const adding = [track('a', 'a2'), track('a', 'a3'), track('a', 'a4')];
  assert.equal(fitQueueLimit(player, adding, { userId: 'a', member: listener, config: { maxQueuedPerUser: 0 } }).tracks.length, 3);

  // The playing track and autoplay picks do not count, so a1 leaves room for two more.
  const fitted = fitQueueLimit(player, adding, { userId: 'a', member: listener, config: { maxQueuedPerUser: 3 } });
  assert.deepEqual(fitted.tracks.map((entry) => entry.info.title), ['a2', 'a3']);
  assert.equal(fitted.skipped, 1);
});

test('the per-person limit refuses when full and never applies to DJs', () => {
  const player = createPlayer(null, [track('a', 'a1'), track('a', 'a2')]);
  const config = { maxQueuedPerUser: 2, djRoleId: null };
  assert.throws(() => fitQueueLimit(player, [track('a', 'a3')], { userId: 'a', member: listener, config }), /already have 2 tracks waiting/);
  assert.equal(fitQueueLimit(player, [track('b', 'b1')], { userId: 'b', member: listener, config }).tracks.length, 1);
  assert.equal(fitQueueLimit(player, [track('a', 'a3')], { userId: 'a', member: admin, config }).tracks.length, 1);
});

test('a copy already in the queue is flagged once, then allowed', () => {
  const song = (requester) => track(requester, 'Song', { info: { title: 'Song', uri: 'https://example.com/song' } });
  const player = createPlayer(track('a', 'now'), [track('a', 'other'), song('a')]);
  assert.equal(takeDuplicateWarning(player, song('b'), 'b'), 'Song is already in the queue at #2. Add it again to queue a second copy.');
  assert.equal(takeDuplicateWarning(player, song('b'), 'b'), null);
  assert.equal(takeDuplicateWarning(player, track('b', 'fresh', { info: { title: 'fresh', uri: 'https://example.com/fresh' } }), 'b'), null);
});

test('play next goes to the front, ahead of turns and autoplay', async () => {
  const player = createPlayer(track('a', 'now'), [track('a', 'a1'), track('b', 'b1'), track('bot', 'auto', { isAutoplay: true })]);
  await queueRequestedTracks(player, track('a', 'a2'), { fair: true, next: true });
  assert.deepEqual(titles(player), ['a2', 'a1', 'b1', 'auto']);
});
