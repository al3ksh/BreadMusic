const fs = require('fs');
const path = require('path');

const DEBOUNCE_DELAY = 1000; 

class FileStore {
  constructor(fileName, defaultData = {}) {
    this.filePath = path.join(process.cwd(), 'data', fileName);
    this.data = defaultData;
    this.saveTimeout = null;
    this.isSaving = false;
    this.pendingSave = false;

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
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    this.saveTimeout = setTimeout(() => {
      this._performSave();
    }, DEBOUNCE_DELAY);
  }

  saveImmediate() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this._performSave();
  }

  _performSave() {
    if (this.isSaving) {
      this.pendingSave = true;
      return;
    }

    this.isSaving = true;
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error(`Failed to save ${this.filePath}:`, error.message);
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
  FileStore,
};
