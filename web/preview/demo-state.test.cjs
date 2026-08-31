const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.resolve(__dirname, '../components/landing-preview');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  if (name.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const filename = path.join(root, `${name}.ts`);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: load, structuredClone }, { filename });
  cache.set(name, module.exports);
  return module.exports;
}
const { initialState, demoReducer, queueEmbed, trackEmbed } = load('./demo-state');
const command = (state, value) => demoReducer(state, { type: 'command', value, random: .72 });
test('resolved tracks share player, queue, seek capability and reorder state', () => {
  const track = { title: 'Real result', artist: 'Artist', duration: '4:00', cover: '', uri: 'https://youtu.be/example', seekable: false };
  let state = command(initialState(), '/pause');
  state = demoReducer(state, { type: 'resolved', tracks: [track] });
  assert.equal(state.paused, true); assert.equal(state.queue.length, 3);
  state = demoReducer(state, { type: 'move', from: 2, to: 0 }); assert.equal(state.queue[0].title, track.title);
  state = command(state, '/skip'); assert.equal(state.current.title, track.title);
  state = command(state, '/seek 1:00'); assert.equal(state.position, 0);
  state = demoReducer(state, { type: 'remove', index: 0 }); assert.equal(state.queue.length, 1);
  state = demoReducer(state, { type: 'resolved', tracks: [track], mode: 'now' }); assert.equal(state.position, 0);
  const copy = initialState(); assert.equal(copy.queue.length, 2);
});
test('play queues without restarting or unpausing; historical queue replies stay snapshots', () => {
  let state = command(initialState(), '/pause');
  state = command(state, '/queue');
  const snapshot = state.messages.at(-1).snapshot;
  state = command(state, '/play Kendrick Lamar');
  assert.equal(state.paused, true); assert.equal(state.position, 84); assert.equal(state.queue.length, 3);
  assert.equal(snapshot.queue.length, 2);
  assert.match(state.messages.at(-1).embed.title, /Added to queue/);
});
test('volume and seek validate, clamp and update the embed', () => {
  let state = command(initialState(), '/volume 0');
  assert.equal(state.volume, 0);
  state = command(state, '/volume 1000'); assert.equal(state.volume, 100);
  state = command(state, '/volume nope'); assert.equal(state.volume, 100);
  state = command(state, '/seek 2:10'); assert.equal(state.position, 130);
  state = command(state, '/seek 9:00'); assert.equal(state.position, 130);
  const embed = trackEmbed('nowPlaying', state.current, state);
  assert.match(embed.description, /2:10 \/ 5:37/);
  assert.equal(embed.fields[2].value, '100%');
});
test('Activity seek retains millisecond precision and rejects invalid or unseekable tracks', () => {
  const initial = initialState();
  let state = demoReducer(initial, { type: 'seek', position: 12.345 });
  assert.equal(state.position, 12.345);
  state = demoReducer(state, { type: 'seek', position: NaN });
  assert.equal(state.position, 12.345);
  state = demoReducer(state, { type: 'seek', position: -5 });
  assert.equal(state.position, 0);
  state = demoReducer(state, { type: 'seek', position: 999 });
  assert.equal(state.position, 336.999);
  const live = { ...initial, current: { ...initial.current, seekable: false } };
  assert.equal(demoReducer(live, { type: 'seek', position: 10 }).position, initial.position);
  const stopped = command(initial, '/stop');
  assert.equal(demoReducer(stopped, { type: 'seek', position: 10 }).position, 0);
});

test('natural end repeats a track but manual skip advances; back restores previous', () => {
  let state = command(initialState(), '/loop track');
  state = demoReducer({ ...state, position: 336 }, { type: 'tick' });
  assert.equal(state.position, 0); assert.equal(state.current.title, 'Instant Crush');
  state = command(state, '/skip'); assert.equal(state.current.title, 'Not Like Us');
  state = command(state, '/back'); assert.equal(state.current.title, 'Instant Crush');
  assert.equal(state.queue[0].title, 'Not Like Us');
});
test('queue loop, stop/disconnect and play from empty', () => {
  let state = command(initialState(), '/loop queue');
  state = command(state, '/skip'); assert.equal(state.queue.at(-1).title, 'Instant Crush');
  state = command(state, '/stop'); assert.equal(state.current, null); assert.equal(state.queue.length, 0);
  state = command(state, '/queue'); assert.equal(state.messages.at(-1).text, 'The queue is empty.');
  state = command(state, '/play Quebonafide'); assert.equal(state.current.title, 'BUBBLETEA');
  assert.equal(state.position, 0); assert.equal(state.paused, false);
});
test('pagination, bounded history and unsupported query feedback', () => {
  let state = initialState();
  for (let i = 0; i < 45; i++) state = command(state, '/play Kendrick Lamar');
  assert.equal(state.messages.length, 40);
  assert.match(queueEmbed(state, 1).footer.text, /Page 2\/5/);
  assert.match(queueEmbed(state, 1).description, /`11\.`/);
  const length = state.queue.length;
  state = command(state, '/play unknown'); assert.equal(state.queue.length, length);
  assert.match(state.messages.at(-1).text, /No match/);
  state = command(state, '/slots 100'); assert.match(state.messages.at(-1).text, /without a bet/);
});
