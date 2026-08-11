const { SqliteStore } = require('./sqliteStore');

// Keep the existing API so state modules migrate without changing their callers.
// The backing store is now SQLite; the old JSON file is imported once on first use.
class FileStore extends SqliteStore {}

module.exports = {
  FileStore,
};
