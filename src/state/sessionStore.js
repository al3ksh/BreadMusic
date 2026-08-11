const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createFileSessionStore(session, options = {}) {
  const Store = session.Store;
  const directory = options.directory || path.join(process.cwd(), 'data', 'sessions');
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const configuredSecret = options.secret || process.env.SESSION_SECRET;
  const encryptionKey = configuredSecret
    ? crypto.createHash('sha256').update(String(configuredSecret)).digest()
    : null;

  class FileSessionStore extends Store {
    constructor() {
      super();
      this.writeQueues = new Map();
      fs.mkdirSync(directory, { recursive: true });
      this._pruneExpired().catch((error) => {
        console.warn('Failed to prune expired sessions:', error.message);
      });
      this.pruneTimer = setInterval(() => {
        this._pruneExpired().catch((error) => {
          console.warn('Failed to prune expired sessions:', error.message);
        });
      }, 6 * 60 * 60 * 1000);
      this.pruneTimer.unref?.();
    }

    get(sid, callback) {
      this._waitForWrite(sid)
        .then(() => this._readRecord(sid))
        .then((record) => {
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

      this._enqueueWrite(sid, () => this._writeRecord(sid, record))
        .then(() => callback(null))
        .catch((error) => callback(error));
    }

    destroy(sid, callback = () => {}) {
      this._enqueueWrite(sid, () => fs.promises.unlink(this._filePath(sid)))
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

    async _readRecord(sid) {
      const filePath = this._filePath(sid);
      try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        if (!raw.trim()) {
          await fs.promises.unlink(filePath).catch(() => {});
          return null;
        }
        const parsed = JSON.parse(raw);
        if (typeof parsed.session === 'string' && encryptionKey) {
          parsed.session = decryptSession(parsed.session, encryptionKey);
        }
        return parsed;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        if (error instanceof SyntaxError) {
          await fs.promises.unlink(filePath).catch(() => {});
          return null;
        }
        throw error;
      }
    }

    async _writeRecord(sid, record) {
      const filePath = this._filePath(sid);
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      try {
        const persisted = encryptionKey
          ? { ...record, session: encryptSession(record.session, encryptionKey) }
          : record;
        await fs.promises.writeFile(tmpPath, JSON.stringify(persisted), 'utf8');
        await renameWithRetry(tmpPath, filePath);
      } catch (error) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        throw error;
      }
    }

    _waitForWrite(sid) {
      return this.writeQueues.get(sid) || Promise.resolve();
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

async function renameWithRetry(source, destination, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error) {
      const retryable = error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY';
      if (!retryable || attempt === attempts - 1) throw error;
      await delay(25 * (attempt + 1));
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encryptSession(session, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(session), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptSession(value, key) {
  if (!value.startsWith('v1.')) return value;
  const [, ivValue, tagValue, ciphertextValue] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

module.exports = {
  createFileSessionStore,
};
