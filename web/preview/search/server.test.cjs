const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMetadataApp } = require('./server.cjs');
const token = 'unit-test-metadata-token-not-for-production';

test('metadata service requires dedicated authentication and has no playback routes', async () => {
  assert.throws(() => createMetadataApp({ token: 'short' }), /32 characters/);
  let searches = 0;
  const app = createMetadataApp({ token, service: { search: async () => { searches++; return { tracks: [] }; } }, lyrics: async () => { throw new Error('Disabled lyrics must not run'); }, lyricsEnabled: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, authorization, body = '{}') => fetch(`${base}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body });
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    for (const auth of ['', 'Bearer wrong', `Bearer ${token.slice(1)}x`]) assert.equal((await post('search', auth)).status, 403);
    assert.equal(searches, 0);
    assert.equal((await post('search', `Bearer ${token}`, '{"query":"test"}')).status, 200);
    assert.equal(searches, 1);
    assert.equal((await post('lyrics', `Bearer ${token}`)).status, 403);
    assert.equal((await post('play', `Bearer ${token}`)).status, 404);
    assert.equal((await post('search', `Bearer ${token}`, 'x'.repeat(2049))).status, 413);
    assert.equal((await post('search', `Bearer ${token}`, '{')).status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
