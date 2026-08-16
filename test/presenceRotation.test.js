const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresenceRotation } = require('../src/utils/presenceRotation');

const entries = [
  { name: '/play • one' },
  { name: '/play • two' },
  { name: '/dashboard • one' },
  { name: '/dashboard • two' },
  { name: '/help • one' },
  { name: '/help • two' },
];

test('presence rotation alternates categories in the configured order', () => {
  const next = createPresenceRotation(entries, ['/play', '/dashboard', '/help'], () => 0.5);
  const prefixes = Array.from({ length: 9 }, () => next().name.split(' • ')[0]);

  assert.deepEqual(prefixes, [
    '/play', '/dashboard', '/help',
    '/play', '/dashboard', '/help',
    '/play', '/dashboard', '/help',
  ]);
});

test('presence rotation exhausts each category before reusing an entry', () => {
  const next = createPresenceRotation(entries, ['/play', '/dashboard', '/help'], () => 0);
  const names = Array.from({ length: 12 }, () => next().name);

  for (let categoryOffset = 0; categoryOffset < 3; categoryOffset += 1) {
    const categoryNames = names.filter((_, index) => index % 3 === categoryOffset);
    assert.notEqual(categoryNames[0], categoryNames[1]);
    assert.notEqual(categoryNames[1], categoryNames[2]);
    assert.notEqual(categoryNames[2], categoryNames[3]);
  }
});

test('presence rotation skips empty categories', () => {
  const next = createPresenceRotation(entries, ['/missing', '/help'], () => 0.5);
  assert.match(next().name, /^\/help/);
  assert.match(next().name, /^\/help/);
});
