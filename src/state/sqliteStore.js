const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const databaseByPath = new Map();

function cloneDefault(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function resolveDatabasePath() {
  const configuredPath = process.env.BREAD_DB_PATH;
  if (configuredPath) return path.resolve(configuredPath);

  const dataDirectory = process.env.BREAD_DATA_DIR
    ? path.resolve(process.env.BREAD_DATA_DIR)
    : path.join(process.cwd(), 'data');
  return path.join(dataDirectory, 'bread.sqlite');
}

function getDatabase(databasePath = resolveDatabasePath()) {
  const resolvedPath = path.resolve(databasePath);
  const existing = databaseByPath.get(resolvedPath);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS key_value_store (
      namespace TEXT NOT NULL,
      store_key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (namespace, store_key)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_key TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
  `);
  databaseByPath.set(resolvedPath, database);
  return database;
}

function closeDatabases() {
  for (const database of databaseByPath.values()) {
    try {
      database.close();
    } catch {}
  }
  databaseByPath.clear();
}

class SqliteStore {
  constructor(fileName, defaultData = {}) {
    this.fileName = fileName;
    this.namespace = fileName.replace(/\.json$/i, '');
    this.defaultData = defaultData;
    this.databasePath = resolveDatabasePath();
    this.database = getDatabase(this.databasePath);
    this.saveTimeout = null;
    this.isSaving = false;
    this.pendingSave = false;
    this.data = this._load();
  }

  _load() {
    const row = this.database
      .prepare('SELECT value FROM key_value_store WHERE namespace = ? AND store_key = ?')
      .get(this.namespace, 'root');

    if (row?.value) {
      try {
        return JSON.parse(row.value);
      } catch (error) {
        console.warn(`Failed to decode SQLite store ${this.namespace}:`, error.message);
        this._deleteRoot();
      }
    }

    const legacyPath = path.join(path.dirname(this.databasePath), this.fileName);
    if (fs.existsSync(legacyPath)) {
      try {
        const legacyData = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        this.data = legacyData;
        this._persist();
        const migratedPath = `${legacyPath}.migrated`;
        if (!fs.existsSync(migratedPath)) {
          fs.renameSync(legacyPath, migratedPath);
        }
        console.log(`Migrated ${legacyPath} to ${this.databasePath}.`);
        return legacyData;
      } catch (error) {
        console.warn(`Failed to migrate ${legacyPath}:`, error.message);
      }
    }

    return cloneDefault(this.defaultData);
  }

  _deleteRoot() {
    this.database
      .prepare('DELETE FROM key_value_store WHERE namespace = ? AND store_key = ?')
      .run(this.namespace, 'root');
  }

  _persist() {
    this.database
      .prepare(`
        INSERT INTO key_value_store (namespace, store_key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(namespace, store_key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(this.namespace, 'root', JSON.stringify(this.data), Date.now());
  }

  save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);

    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this._performSave();
    }, 1000);
    this.saveTimeout.unref?.();
  }

  saveImmediate() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this._performSave();
  }

  flush() {
    this.saveImmediate();
    return Promise.resolve();
  }

  _performSave() {
    if (this.isSaving) {
      this.pendingSave = true;
      return;
    }

    this.isSaving = true;
    try {
      this._persist();
    } catch (error) {
      console.error(`Failed to save SQLite store ${this.namespace}:`, error.message);
    } finally {
      this.isSaving = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        this._performSave();
      }
    }
  }

  get(key, fallback = undefined) {
    return key in this.data ? this.data[key] : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
    return value;
  }

  delete(key) {
    delete this.data[key];
    this.save();
  }

  entries() {
    return Object.entries(this.data);
  }

  clearAll() {
    this.data = {};
    this.save();
  }
}

module.exports = {
  SqliteStore,
  getDatabase,
  resolveDatabasePath,
  closeDatabases,
};
