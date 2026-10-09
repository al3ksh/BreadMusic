const test = require('node:test');
const assert = require('node:assert/strict');
const { ICON_NAMES, playerEmoji, syncPlayerEmojis, __testing } = require('../src/music/playerEmojis');

test('player icons are uploaded once and then used by the buttons', async () => {
  __testing.emojiIds.clear();
  const created = [];
  const application = {
    emojis: {
      fetch: async () => [{ name: 'bread_play', id: '100000000000000001' }],
      create: async ({ name, attachment }) => {
        assert.ok(attachment.length > 0, `${name} has an image`);
        created.push(name);
        return { name, id: String(200000000000000000 + created.length) };
      },
    },
  };

  assert.equal(playerEmoji('play', 'x'), 'x', 'falls back before the sync');
  const added = await syncPlayerEmojis(application, { log: { warn() {} } });
  assert.equal(added, ICON_NAMES.length - 1, 'the existing icon is reused');
  assert.ok(!created.includes('bread_play'));
  assert.deepEqual(playerEmoji('play', 'x'), { name: 'bread_play', id: '100000000000000001' });
  assert.equal(typeof playerEmoji('reroll', 'x').id, 'string');

  assert.equal(await syncPlayerEmojis(application), 0, 'nothing left to upload');
});

test('a failed fetch keeps the emoji fallbacks', async () => {
  __testing.emojiIds.clear();
  const application = { emojis: { fetch: async () => { throw new Error('nope'); } } };
  assert.equal(await syncPlayerEmojis(application, { log: { warn() {} } }), 0);
  assert.equal(playerEmoji('skip', 'fallback'), 'fallback');
});
