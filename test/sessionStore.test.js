const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const session = require('express-session');

const { createFileSessionStore } = require('../src/state/sessionStore');

const tempDirs = [];
function makeStore(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-sessions-'));
  tempDirs.push(directory);
  const store = createFileSessionStore(session, { directory, ...options });
  clearInterval(store.pruneTimer);
  return { store, directory };
}

const call = (store, method, ...args) => new Promise((resolve, reject) => {
  store[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
});

async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

test.after(() => {
  for (const directory of tempDirs) fs.rmSync(directory, { recursive: true, force: true });
});

test('a stored session reads back and is gone after destroy', async () => {
  const { store } = makeStore({ secret: 'one' });
  const sess = { cookie: { expires: inAnHour() }, user: { id: '42' } };
  await call(store, 'set', 'sid-1', sess);
  assert.deepEqual(await call(store, 'get', 'sid-1'), sess);

  await call(store, 'destroy', 'sid-1');
  assert.equal(await call(store, 'get', 'sid-1'), null);
  assert.equal(await call(store, 'get', 'never-existed'), null);
});

test('sessions are encrypted on disk and the file name does not reveal the session id', async () => {
  const { store, directory } = makeStore({ secret: 'one' });
  await call(store, 'set', 'secret-sid', { cookie: { expires: inAnHour() }, accessToken: 'discord-token-value' });
  const [file] = fs.readdirSync(directory);
  assert.doesNotMatch(file, /secret-sid/);
  const raw = fs.readFileSync(path.join(directory, file), 'utf8');
  assert.doesNotMatch(raw, /discord-token-value/);
  assert.match(JSON.parse(raw).session, /^v1\./);
});

test('an expired session is treated as missing and removed', async () => {
  const { store, directory } = makeStore({ secret: 'one' });
  await call(store, 'set', 'old', { cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
  assert.equal(await call(store, 'get', 'old'), null);
  await waitFor(() => fs.readdirSync(directory).length === 0);
});

test('a session written under another secret logs the user out instead of failing the request', async () => {
  const { store, directory } = makeStore({ secret: 'old-secret' });
  await call(store, 'set', 'rotated', { cookie: { expires: inAnHour() }, user: { id: '7' } });

  const rotated = createFileSessionStore(session, { directory, secret: 'new-secret' });
  clearInterval(rotated.pruneTimer);
  assert.equal(await call(rotated, 'get', 'rotated'), null);
  assert.deepEqual(fs.readdirSync(directory), [], 'the unreadable session file is dropped');

  await call(store, 'set', 'truncated', { cookie: { expires: inAnHour() } });
  const [file] = fs.readdirSync(directory);
  fs.writeFileSync(path.join(directory, file), JSON.stringify({ expiresAt: Date.now() + 60_000, session: 'v1.abc' }));
  assert.equal(await call(store, 'get', 'truncated'), null);
});

test('a corrupt session file is dropped instead of failing the request', async () => {
  const { store, directory } = makeStore({ secret: 'one' });
  await call(store, 'set', 'broken', { cookie: { expires: inAnHour() } });
  const [file] = fs.readdirSync(directory);
  fs.writeFileSync(path.join(directory, file), '{not json');
  assert.equal(await call(store, 'get', 'broken'), null);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('touch keeps the stored data and only refreshes the cookie', async () => {
  const { store } = makeStore({ secret: 'one' });
  await call(store, 'set', 'touched', { cookie: { expires: inAnHour() }, user: { id: '9' } });
  const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await call(store, 'touch', 'touched', { cookie: { expires: later } });
  assert.deepEqual(await call(store, 'get', 'touched'), { cookie: { expires: later }, user: { id: '9' } });
});

test('concurrent writes to one session land in order', async () => {
  const { store } = makeStore({ secret: 'one' });
  const expires = inAnHour();
  await Promise.all([1, 2, 3, 4, 5].map((n) => call(store, 'set', 'busy', { cookie: { expires }, n })));
  assert.equal((await call(store, 'get', 'busy')).n, 5);
});
