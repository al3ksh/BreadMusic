const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createServerExtensionHost, parseExtensionPaths } = require('../src/extensions/serverExtensions');

test('extension paths are parsed from a comma-separated value', () => {
  assert.deepEqual(parseExtensionPaths(' /first , , /second '), ['/first', '/second']);
  assert.deepEqual(parseExtensionPaths(''), []);
});

test('server starts with no configured extensions', async () => {
  const host = createServerExtensionHost('');
  assert.equal(host.count, 0);
  assert.equal(await host.resolveGuildAccess({}), null);
});

test('relative extension paths are ignored', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const host = createServerExtensionHost(path.join('relative', 'extension'));
    assert.equal(host.count, 0);
  } finally {
    console.warn = originalWarn;
  }
});
