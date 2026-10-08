const test = require('node:test');
const assert = require('node:assert/strict');
const { queueRequestedTracks } = require('../src/music/queueInsert');

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
