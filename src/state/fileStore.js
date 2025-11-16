const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(fileName, defaultData = {}) {
    this.filePath = path.join(process.cwd(), 'data', fileName);
    this.data = defaultData;

    this.ensureFile();
    this.load();
  }

  ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    }
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = raw ? JSON.parse(raw) : {};
    } catch {
      this.data = {};
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
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
  FileStore,
};
