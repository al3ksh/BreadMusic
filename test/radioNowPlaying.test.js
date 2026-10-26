const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  createRadioNowPlaying,
  readStreamTitle,
  cleanTitle,
  parseStreamTitle,
  isPublicStreamUrl,
} = require('../src/music/radioNowPlaying');

function radioPlayer(guildId = 'radio-guild') {
  const track = {
    info: { title: 'RMF FM', isStream: true },
    radioStation: { id: 'station-1', source: 'radio-browser', url: 'https://stream.example/rmf' },
  };
  return { guildId, queue: { current: track }, track };
}

function manualTimers() {
  const pending = [];
  return {
    setTimer: (fn) => { const timer = { fn }; pending.push(timer); return timer; },
    clearTimer: (timer) => { const index = pending.indexOf(timer); if (index >= 0) pending.splice(index, 1); },
    async runNext() { const timer = pending.shift(); await timer?.fn(); await new Promise((resolve) => setImmediate(resolve)); },
    get count() { return pending.length; },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('stream titles are parsed and cleaned of what is not a song', () => {
  assert.equal(parseStreamTitle("StreamTitle='Evanescence - Bring Me To Life';StreamUrl='';"), 'Evanescence - Bring Me To Life');
  assert.equal(parseStreamTitle("StreamTitle='Guns N' Roses - Don't Cry';"), "Guns N' Roses - Don't Cry");
  assert.equal(parseStreamTitle('nothing here'), null);
  assert.equal(cleanTitle('  Dawid Podsiadło  -  Małomiasteczkowy '), 'Dawid Podsiadło - Małomiasteczkowy');
  assert.equal(cleanTitle('Artist - '), 'Artist');
  assert.equal(cleanTitle(' - '), null);
  assert.equal(cleanTitle(''), null);
  assert.equal(cleanTitle('RMF FM', 'RMF FM'), null);
  assert.equal(cleanTitle('Listen at www.example.com'), null);
});

test('stream urls on the bot network are never read', () => {
  assert.equal(isPublicStreamUrl('https://rs201-krk.rmfstream.pl/rmf_fm'), true);
  assert.equal(isPublicStreamUrl('http://195.150.20.7/rmf_fm'), true);
  assert.equal(isPublicStreamUrl('http://localhost:3001/stream'), false);
  assert.equal(isPublicStreamUrl('http://bot:3001/api'), false);
  assert.equal(isPublicStreamUrl('http://192.168.1.10/stream'), false);
  assert.equal(isPublicStreamUrl('http://10.0.0.5/stream'), false);
  assert.equal(isPublicStreamUrl('http://[::1]/stream'), false);
  assert.equal(isPublicStreamUrl('ftp://stream.example/a'), false);
});

test('a playing station reports a new title once and stays quiet while it repeats', async () => {
  const timers = manualTimers();
  const titles = ["Evanescence - Bring Me To Life", 'Evanescence - Bring Me To Life', 'Linkin Park - Numb'];
  const changes = [];
  const watcher = createRadioNowPlaying({
    readTitle: async () => ({ supported: true, title: titles.shift() }),
    onChange: (_player, track) => changes.push(track.radioStation.nowPlaying),
    ...timers,
  });
  const player = radioPlayer();
  assert.equal(watcher.watch(player), true);
  await settle();
  await timers.runNext();
  await timers.runNext();
  assert.deepEqual(changes, ['Evanescence - Bring Me To Life', 'Linkin Park - Numb']);
  assert.equal(player.track.radioStation.nowPlaying, 'Linkin Park - Numb');
  watcher.stop(player.guildId);
  assert.equal(timers.count, 0);
});

test('watching stops when the station sends no metadata or the track changes', async () => {
  const timers = manualTimers();
  const unsupported = createRadioNowPlaying({ readTitle: async () => ({ supported: false }), ...timers });
  const player = radioPlayer('quiet-guild');
  unsupported.watch(player);
  await settle();
  assert.equal(unsupported.isWatching('quiet-guild'), false);

  const reads = [];
  const watcher = createRadioNowPlaying({ readTitle: async (url) => { reads.push(url); return { supported: true, title: 'A - B' }; }, ...timers });
  const other = radioPlayer('switch-guild');
  watcher.watch(other);
  await settle();
  other.queue.current = { info: { title: 'Song' } };
  await timers.runNext();
  assert.equal(watcher.isWatching('switch-guild'), false);
  assert.equal(reads.length, 1);
  assert.equal(watcher.watch({ guildId: 'x', queue: { current: { info: { title: 'Song' } } } }), false);
});

test('a station that keeps failing is given up on', async () => {
  const timers = manualTimers();
  const watcher = createRadioNowPlaying({ readTitle: async () => { throw new Error('down'); }, ...timers });
  const player = radioPlayer('down-guild');
  watcher.watch(player);
  await settle();
  await timers.runNext();
  await timers.runNext();
  assert.equal(watcher.isWatching('down-guild'), false);
});

test('the ICY title is read from a live stream', async () => {
  const metaint = 64;
  const metadata = Buffer.from("StreamTitle='Daria Zawiałow - Kaonashi';");
  const padded = Buffer.alloc(Math.ceil(metadata.length / 16) * 16);
  metadata.copy(padded);
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['icy-metadata'], '1');
    res.writeHead(200, { 'icy-metaint': String(metaint) });
    res.write(Buffer.concat([Buffer.alloc(metaint), Buffer.from([padded.length / 16]), padded, Buffer.alloc(metaint)]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  // Real streams refuse loopback, so the test points a public-looking name at the local server.
  const lookup = (_host, options, callback) => (options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4));
  try {
    assert.deepEqual(await readStreamTitle(`http://stream.test.example:${port}/live`, { lookup }), { supported: true, title: 'Daria Zawiałow - Kaonashi' });
    await assert.rejects(readStreamTitle(`http://stream.test.example:${port}/live`), /private address|ENOTFOUND|EAI_AGAIN/);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
