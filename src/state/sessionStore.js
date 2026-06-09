const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createFileSessionStore(session, options = {}) {
  const Store = session.Store;
  const directory = options.directory || path.join(process.cwd(), 'data', 'sessions');
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;

  class FileSessionStore extends Store {
    constructor() {
      super();
      this.writeQueues = new Map();
      fs.mkdirSync(directory, { recursive: true });
      this._pruneExpired().catch((error) => {
        console.warn('Failed to prune expired sessions:', error.message);
      });
    }

    get(sid, callback) {
      fs.promises.readFile(this._filePath(sid), 'utf8')
        .then((raw) => {
          const record = JSON.parse(raw);
          if (!record || record.expiresAt <= Date.now()) {
            this.destroy(sid, () => {});
            callback(null, null);
            return;
          }
          callback(null, record.session);
        })
        .catch((error) => {
          if (error.code === 'ENOENT') {
            callback(null, null);
            return;
          }
          callback(error);
        });
    }

    set(sid, sess, callback = () => {}) {
      const record = {
        expiresAt: this._expiresAt(sess),
        session: sess,
      };
      const filePath = this._filePath(sid);

      this._enqueueWrite(sid, () => fs.promises.writeFile(filePath, JSON.stringify(record), 'utf8'))
        .then(() => callback(null))
        .catch((error) => callback(error));
    }

    destroy(sid, callback = () => {}) {
      fs.promises.unlink(this._filePath(sid))
        .then(() => callback(null))
        .catch((error) => {
          if (error.code === 'ENOENT') {
            callback(null);
            return;
          }
          callback(error);
        });
    }

    touch(sid, sess, callback = () => {}) {
      this.get(sid, (error, existing) => {
        if (error) {
          callback(error);
          return;
        }
        this.set(sid, existing ? { ...existing, cookie: sess.cookie } : sess, callback);
      });
    }

    _expiresAt(sess) {
      const cookieExpires = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
      if (Number.isFinite(cookieExpires)) return cookieExpires;
      return Date.now() + ttlMs;
    }

    _filePath(sid) {
      const hash = crypto.createHash('sha256').update(String(sid)).digest('hex');
      return path.join(directory, `${hash}.json`);
    }

    _enqueueWrite(sid, operation) {
      const previous = this.writeQueues.get(sid) || Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(operation)
        .finally(() => {
          if (this.writeQueues.get(sid) === next) {
            this.writeQueues.delete(sid);
          }
        });
      this.writeQueues.set(sid, next);
      return next;
    }

    async _pruneExpired() {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      const now = Date.now();
      await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const filePath = path.join(directory, entry.name);
          try {
            const record = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
            if (!record?.expiresAt || record.expiresAt <= now) {
              await fs.promises.unlink(filePath);
            }
          } catch {
            await fs.promises.unlink(filePath).catch(() => {});
          }
        }));
    }
  }

  return new FileSessionStore();
}

module.exports = {
  createFileSessionStore,
};
