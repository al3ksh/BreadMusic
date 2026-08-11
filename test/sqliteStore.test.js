const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('FileStore migrates legacy JSON into SQLite and persists updates', () => {
  const originalCwd = process.cwd();
  const originalDbPath = process.env.BREAD_DB_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bread-sqlite-'));
  const dataDir = path.join(tempDir, 'data');
  const databasePath = path.join(dataDir, 'bread.sqlite');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'configs.json'),
    JSON.stringify({ 'guild-1': { autoplay: true } }),
    'utf8',
  );

  process.chdir(tempDir);
  process.env.BREAD_DB_PATH = databasePath;

  try {
    const { FileStore } = require('../src/state/fileStore');
    const { closeDatabases } = require('../src/state/sqliteStore');
    const store = new FileStore('configs.json', {});

    assert.deepEqual(store.get('guild-1'), { autoplay: true });
    assert.equal(fs.existsSync(`${path.join(dataDir, 'configs.json')}.migrated`), true);

    store.set('guild-2', { autoplay: false });
    store.saveImmediate();
    closeDatabases();

    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare('SELECT value FROM key_value_store WHERE namespace = ? AND store_key = ?')
      .get('configs', 'root');
    database.close();

    assert.deepEqual(JSON.parse(row.value), {
      'guild-1': { autoplay: true },
      'guild-2': { autoplay: false },
    });
  } finally {
    process.chdir(originalCwd);
    if (originalDbPath === undefined) delete process.env.BREAD_DB_PATH;
    else process.env.BREAD_DB_PATH = originalDbPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
