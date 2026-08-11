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
    const { recordTrackPlay, getGuildHistory, getGuildInsights, getUserInsights } = require('../src/state/analyticsStore');
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
    const userInsights = getUserInsights('guild-1', 'user-1', { range: 'all', limit: 5 });
    assert.equal(userInsights.totalRequests, 1);
    assert.equal(userInsights.topTracks[0].title, 'Test Track');
    assert.equal(userInsights.details.estimatedDuration, 180000);
    assert.equal(userInsights.details.topArtists[0].name, 'Test Artist');
    assert.equal(userInsights.details.topSources[0].name, 'youtube');
    assert.equal(userInsights.details.activeDays, 1);
    const guildInsights = getGuildInsights('guild-1', { range: 'all', limit: 5 });
    assert.equal(guildInsights.details.estimatedDuration, 180000);
    assert.equal(guildInsights.details.autoplayPlays, 1);
    assert.equal(guildInsights.details.topSources[0].name, 'youtube');
    await new Promise((resolve) => setTimeout(resolve, 1100));
  } finally {
    closeDatabases();
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
