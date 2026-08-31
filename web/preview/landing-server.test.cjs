const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
function load(filename) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), `${name}.ts`)) : require(name), process, fetch, Request, Response, Buffer, URL, TextDecoder, Uint8Array, AbortSignal, setTimeout, clearTimeout }, { filename });
  return module.exports;
}
const { createLandingDemoHandler, landingDemoConfig } = load(path.resolve(__dirname, '../lib/landing-demo-server.ts'));
const origin = 'https://bread.example';
const token = 'isolated-test-token-not-a-real-secret';
const env = { WEB_URL: origin, LANDING_DEMO_SEARCH_URL: 'http://private-search:3001', LANDING_DEMO_TOKEN: token };
function req(body = { query: 'daft punk' }, headers = {}, endpoint = 'search') {
  return new Request(`${origin}/demo/api/${endpoint}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

test('demo configuration fails closed and lyrics need separate opt-in', () => {
  assert.equal(landingDemoConfig({}).liveSearch, false);
  assert.equal(landingDemoConfig(env).liveSearch, true);
  assert.equal(landingDemoConfig(env).liveLyrics, false);
  assert.equal(landingDemoConfig({ ...env, LANDING_DEMO_LYRICS_ENABLED: 'true' }).liveLyrics, true);
  for (const address of ['file:///etc/passwd', 'http://user:pass@service', 'http://service/path', 'http://service/?x=1', 'bad']) assert.equal(landingDemoConfig({ ...env, LANDING_DEMO_SEARCH_URL: address }).liveSearch, false);
  assert.equal(landingDemoConfig({ ...env, LANDING_DEMO_TOKEN: 'short' }).liveSearch, false);
});

test('public demo enforces configured origin, not Host or forwarded headers', async () => {
  const handle = createLandingDemoHandler({ env: { WEB_URL: origin } });
  for (const headers of [{ origin: '' }, { origin: 'https://evil.example' }, { origin: 'http://localhost:3181' }, { origin: 'https://evil.example', host: 'evil.example', 'x-forwarded-host': 'evil.example' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await handle(req(undefined, headers))).status, 403);
  assert.equal((await handle(req())).status, 200);
  const preview = createLandingDemoHandler({ env: { WEB_URL: origin, BREAD_LANDING_PREVIEW: '1' } });
  assert.equal((await preview(req(undefined, { origin: 'http://localhost:3181' }))).status, 200);
});

test('validation covers JSON, nulls, content type, byte limits, paths and durations', async () => {
  const handle = createLandingDemoHandler({ env: { WEB_URL: origin } });
  for (const body of ['{', 'null', '[]', '{}', { query: 'x' }, { query: 'a'.repeat(201) }]) assert.equal((await handle(req(body))).status, 400);
  assert.equal((await handle(req(undefined, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handle(req({ query: 'aa', ignored: 'ą'.repeat(1100) }))).status, 413);
  assert.equal((await handle(req(undefined, { 'content-length': '2049' }))).status, 413);
  assert.equal((await handle(new Request(`${origin}/demo/api/search`))).status, 405);
  for (const kind of ['play', 'toString', '__proto__']) assert.equal((await handle(req(undefined, {}, kind))).status, 404);
  for (const duration of [-1, '120000', 86400001]) assert.equal((await handle(req({ artist: 'A', title: 'B', duration }, {}, 'lyrics'))).status, 400);
  assert.equal((await handle(new Request(`${origin}/demo/api/artwork?id=http://localhost/private`))).status, 400);
});

test('unconfigured installation searches sample catalogue without any network or session', async () => {
  const handle = createLandingDemoHandler({ env: { WEB_URL: origin }, request: () => { throw new Error('Network must not run'); } });
  const result = await (await handle(req({ query: 'Kendrick Lamar - Not Like Us' }))).json();
  assert.equal(result.mode, 'catalogue'); assert.equal(result.tracks[0].title, 'Not Like Us');
  assert.equal((await handle(req({ artist: 'A', title: 'B', duration: 1000 }, {}, 'lyrics'))).status, 403);
  assert.equal((await handle(new Request(`${origin}/demo/api/artwork?id=${'a'.repeat(32)}`))).status, 404);
});

test('IP spoofing is ignored by default, quotas reset and a global cap remains with trusted IPs', async () => {
  let time = 0;
  const handle = createLandingDemoHandler({ env: { WEB_URL: origin }, now: () => time });
  for (let i = 0; i < 12; i++) assert.equal((await handle(req(undefined, { 'x-forwarded-for': `192.0.2.${i}`, 'x-real-ip': `192.0.2.${i}` }))).status, 200);
  const limited = await handle(req()); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  time = 60001; assert.equal((await handle(req())).status, 200);
  const trusted = createLandingDemoHandler({ env: { WEB_URL: origin, LANDING_DEMO_CLIENT_IP_HEADER: 'x-real-ip' } });
  for (let i = 0; i < 60; i++) assert.equal((await trusted(req(undefined, { 'x-real-ip': `192.0.2.${i}` }))).status, 200);
  assert.equal((await trusted(req(undefined, { 'x-real-ip': '192.0.2.200' }))).status, 429);
});

test('live proxy forwards only sanitized metadata and private auth, never cookies or browser tokens', async () => {
  let calls = 0;
  const handle = createLandingDemoHandler({ env, request: async (url, options) => {
    calls++;
    assert.equal(url, 'http://private-search:3001/search');
    assert.deepEqual(JSON.parse(options.body), { query: 'test track' });
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(Object.keys(options.headers).length, 2);
    assert.equal(options.redirect, 'error');
    return Response.json({ tracks: [], playlist: null });
  } });
  const response = await handle(req({ query: 'test track', url: 'http://evil', guildId: 'private' }, { cookie: 'session=secret', authorization: 'Bearer user-secret' }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await response.text(), /secret|private/);
});

test('upstream failures, redirects, invalid MIME and oversized responses cannot leak internals', async () => {
  for (const provider of [() => { throw new Error(token); }, () => new Response(token, { status: 302, headers: { location: 'http://private' } }), () => new Response('<html>bad</html>'), () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })]) {
    const handle = createLandingDemoHandler({ env, request: provider });
    const response = await handle(req());
    assert.ok(response.status >= 400); assert.doesNotMatch(await response.text(), new RegExp(token));
  }
  const busy = createLandingDemoHandler({ env, request: () => new Response(null, { status: 429 }) });
  assert.equal((await busy(req())).headers.get('retry-after'), '60');
});

test('concurrent lookups are bounded and slots are released after completion', async () => {
  const releases = [];
  const handle = createLandingDemoHandler({ env, request: () => new Promise(resolve => releases.push(resolve)) });
  const first = handle(req()); const second = handle(req());
  while (releases.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await handle(req())).status, 429);
  releases.forEach(resolve => resolve(Response.json({ tracks: [] })));
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});

test('body reader cancels oversized chunked requests without buffering all chunks', async () => {
  let cancelled = false;
  const handle = createLandingDemoHandler({ env: { WEB_URL: origin } });
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2049)); }, cancel() { cancelled = true; } });
  const response = await handle(new Request(`${origin}/demo/api/search`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body, duplex: 'half' }));
  assert.equal(response.status, 413); assert.equal(cancelled, true);
});
