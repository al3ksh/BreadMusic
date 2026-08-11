const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('play events are exposed as paginated history', async () => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-history-'));
  let closeDatabases = () => {};
  process.chdir(tempDir);

  try {
    const { recordTrackPlay, getGuildHistory } = require('../src/state/analyticsStore');
    ({ closeDatabases } = require('../src/state/sqliteStore'));
    recordTrackPlay('guild-1', {
      info: {
        identifier: 'track-1',
        title: 'Test Track',
        author: 'Test Artist',
        uri: 'https://example.test/track',
        duration: 180000,
        sourceName: 'youtube',
      },
      requester: {
        id: 'user-1',
        username: 'listener',
        globalName: 'Listener',
        bot: false,
      },
      isAutoplay: true,
    });

    const history = getGuildHistory('guild-1', { page: 0, limit: 10 });
    assert.equal(history.total, 1);
    assert.equal(history.items[0].track.title, 'Test Track');
    assert.equal(history.items[0].track.source, 'youtube');
    assert.equal(history.items[0].requester.displayName, 'Listener');
    assert.equal(history.items[0].autoplay, true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  } finally {
    closeDatabases();
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
