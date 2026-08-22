const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BREAD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-autoplay-mode-'));

const { getAutoplayMode, setAutoplayMode } = require('../src/music/autoplay');
const { normalizeVolumeConfig, AUTOPLAY_MODES } = require('../src/state/guildConfig');
const { closeDatabases } = require('../src/state/sqliteStore');

test.after(() => {
  closeDatabases();
  fs.rmSync(process.env.BREAD_DATA_DIR, { recursive: true, force: true });
});

test('autoplay mode defaults to ai_assisted', () => {
  assert.equal(getAutoplayMode('mode-default-guild'), 'ai_assisted');
});

test('autoplay mode round-trips and rejects unknown values', () => {
  assert.equal(setAutoplayMode('mode-roundtrip-guild', 'classic'), 'classic');
  assert.equal(getAutoplayMode('mode-roundtrip-guild'), 'classic');

  assert.equal(setAutoplayMode('mode-roundtrip-guild', 'discovery'), 'discovery');
  assert.equal(getAutoplayMode('mode-roundtrip-guild'), 'discovery');

  assert.equal(setAutoplayMode('mode-roundtrip-guild', 'hyper'), null);
  assert.equal(getAutoplayMode('mode-roundtrip-guild'), 'discovery');
});

test('stored invalid modes normalize back to the default', () => {
  assert.equal(normalizeVolumeConfig({ autoplayMode: 'bogus' }).autoplayMode, 'ai_assisted');
  assert.equal(normalizeVolumeConfig({}).autoplayMode, 'ai_assisted');
});

test('documented modes are exactly classic, ai_assisted and discovery', () => {
  assert.deepEqual([...AUTOPLAY_MODES].sort(), ['ai_assisted', 'classic', 'discovery']);
});
