'use strict';

/**
 * Dooo persistence.
 *
 * Three JSON files live in the userData directory:
 *   tasks.json         the renderer's task array, persisted verbatim (main treats it as opaque)
 *   settings.json      user settings; main owns the defaults
 *   window-state.json  the last window bounds
 *
 * Writes are atomic: the JSON goes to "<file>.tmp" and is flushed to disk, the current good
 * file is copied to "<file>.bak", then the temp file is renamed over the real one.
 * Loading falls back to the .bak when the main file is missing, unreadable or the wrong
 * shape, and finally to defaults. Bad JSON never throws out of load().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_TASKS_BYTES = 5 * 1024 * 1024;
const MAX_SETTINGS_BYTES = 4 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_AVATAR_LENGTH = 3 * 1024 * 1024;

// Keys that must never be copied onto a settings object.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Validators for the settings main knows about. Unknown keys are stored as-is.
const SETTING_VALIDATORS = {
  name: (v) => typeof v === 'string' && v.length <= MAX_NAME_LENGTH,
  avatar: (v) =>
    v === null ||
    (typeof v === 'string' && v.length <= MAX_AVATAR_LENGTH && (v === '' || v.startsWith('data:'))),
  alwaysOnTop: (v) => typeof v === 'boolean',
  launchAtLogin: (v) => typeof v === 'boolean',
};

// Windows file locks (antivirus, indexers, sync tools) are usually brief; retry these.
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function warn(...args) {
  console.warn('[dooo:store]', ...args);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin: Atomics.wait is unavailable */
    }
  }
}

function withRetry(fn, attempts = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (attempt >= attempts || !RETRYABLE_CODES.has(err && err.code)) throw err;
      sleepSync(Math.min(20 * attempt, 100));
    }
  }
}

function readJsonFile(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // tolerate a BOM from hand edits
  return JSON.parse(text);
}

function writeFileDurable(file, text) {
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function errorText(err) {
  return (err && (err.code || err.message)) || String(err);
}

/** One JSON document on disk with atomic writes, a .bak copy and recovery. */
class JsonFile {
  constructor(file, validate) {
    this.file = file;
    this.bak = `${file}.bak`;
    this.tmp = `${file}.tmp`;
    this.validate = validate;
    this.label = path.basename(file);
    // True when the file on disk is known to be good, so it may become the next .bak.
    this.mainIsGood = false;
  }

  /** Returns { value, source } with source 'main' | 'backup' | 'none'. Never throws. */
  load() {
    this.mainIsGood = false;
    const main = this.tryRead(this.file);
    if (main.ok) {
      this.mainIsGood = true;
      return { value: main.value, source: 'main' };
    }
    if (!main.missing) {
      warn(`${this.label} is damaged (${main.reason}); trying the backup`);
      // Keep the damaged copy for inspection. The .bak is not touched, because it is the
      // previous good version.
      try {
        withRetry(() => fs.copyFileSync(this.file, `${this.file}.corrupt`));
      } catch {
        /* best effort */
      }
    }
    const bak = this.tryRead(this.bak);
    if (bak.ok) {
      warn(`${this.label} restored from ${path.basename(this.bak)}`);
      try {
        this.save(bak.value);
      } catch (err) {
        warn(`could not rewrite ${this.label} from the backup: ${errorText(err)}`);
      }
      return { value: bak.value, source: 'backup' };
    }
    if (!bak.missing) warn(`${path.basename(this.bak)} is damaged too (${bak.reason})`);
    return { value: undefined, source: 'none' };
  }

  tryRead(file) {
    try {
      const value = readJsonFile(file);
      if (!this.validate(value)) return { ok: false, missing: false, reason: 'unexpected content' };
      return { ok: true, value };
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, missing: true };
      return { ok: false, missing: false, reason: (err && err.message) || String(err) };
    }
  }

  /** Atomically replaces the file. `json` may be passed when the caller already serialised. */
  save(value, json = JSON.stringify(value, null, 2)) {
    if (typeof json !== 'string') throw new TypeError(`${this.label}: value is not JSON-serialisable`);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    withRetry(() => writeFileDurable(this.tmp, `${json}\n`));
    if (this.mainIsGood) {
      try {
        withRetry(() => fs.copyFileSync(this.file, this.bak));
      } catch (err) {
        if (!err || err.code !== 'ENOENT') warn(`could not refresh ${this.label}.bak: ${errorText(err)}`);
      }
    }
    try {
      withRetry(() => fs.renameSync(this.tmp, this.file));
    } catch (err) {
      // Something keeps the target locked. Overwrite in place rather than lose the data;
      // the .bak still holds the previous good version if this write is interrupted.
      warn(`atomic replace of ${this.label} failed (${errorText(err)}); writing in place`);
      withRetry(() => fs.copyFileSync(this.tmp, this.file));
      try {
        fs.unlinkSync(this.tmp);
      } catch {
        /* ignore */
      }
    }
    this.mainIsGood = true;
  }
}

function defaultName() {
  let raw = '';
  try {
    raw = os.userInfo().username || '';
  } catch {
    /* os.userInfo can throw on unusual accounts */
  }
  if (!raw) raw = process.env.USERNAME || process.env.USER || '';
  raw = raw.trim();
  if (!raw) return 'Friend';
  return raw.charAt(0).toLocaleUpperCase() + raw.slice(1);
}

function defaultSettings() {
  return { name: defaultName(), avatar: null, alwaysOnTop: false, launchAtLogin: true };
}

/** Defaults, overlaid with every valid stored value (unknown keys kept as-is). */
function normalizeSettings(raw) {
  const out = defaultSettings();
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const value = raw[key];
    const check = SETTING_VALIDATORS[key];
    if (check && !check(value)) {
      warn(`ignoring invalid stored value for setting "${key}"`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function sanitizeWindowState(value) {
  if (!isPlainObject(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.tasksFile = new JsonFile(path.join(dir, 'tasks.json'), Array.isArray);
    this.settingsFile = new JsonFile(path.join(dir, 'settings.json'), isPlainObject);
    this.windowFile = new JsonFile(path.join(dir, 'window-state.json'), (v) => sanitizeWindowState(v) !== null);
    this.tasks = [];
    this.settings = defaultSettings();
    this.windowState = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });

    const tasks = this.tasksFile.load();
    this.tasks = tasks.source === 'none' ? [] : tasks.value;

    const settings = this.settingsFile.load();
    this.settings = normalizeSettings(settings.value);
    if (settings.source !== 'main') {
      // First run (or recovery): write the defaults so the default name stays stable.
      try {
        this.settingsFile.save(this.settings);
      } catch (err) {
        warn(`could not write settings.json: ${errorText(err)}`);
      }
    }

    const win = this.windowFile.load();
    this.windowState = win.source === 'none' ? null : sanitizeWindowState(win.value);
  }

  getTasks() {
    return this.tasks;
  }

  /** Persists the renderer's array verbatim. Throws (rejecting the IPC call) on bad input. */
  saveTasks(tasks) {
    if (!Array.isArray(tasks)) throw new TypeError('saveTasks expects an array of tasks');
    const compact = JSON.stringify(tasks);
    const bytes = Buffer.byteLength(compact, 'utf8');
    if (bytes > MAX_TASKS_BYTES) {
      throw new RangeError(`The task list is too large to save (${bytes} bytes, limit ${MAX_TASKS_BYTES})`);
    }
    // Keep memory identical to what a reload from disk would produce.
    const stored = JSON.parse(compact);
    this.tasksFile.save(stored);
    this.tasks = stored;
  }

  getSettings() {
    return { ...this.settings };
  }

  /**
   * Shallow-merges `patch` into the settings and persists them.
   * Returns { settings, keys } where keys lists the settings present in the patch.
   */
  updateSettings(patch) {
    if (!isPlainObject(patch)) throw new TypeError('updateSettings expects a plain object');
    const next = { ...this.settings };
    const keys = [];
    for (const key of Object.keys(patch)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      const value = patch[key];
      if (value === undefined) continue;
      const check = SETTING_VALIDATORS[key];
      if (check && !check(value)) throw new TypeError(`Invalid value for setting "${key}"`);
      next[key] = value;
      keys.push(key);
    }
    const json = JSON.stringify(next, null, 2);
    if (Buffer.byteLength(json, 'utf8') > MAX_SETTINGS_BYTES) {
      throw new RangeError('The settings are too large to save');
    }
    const stored = JSON.parse(json);
    this.settingsFile.save(stored, json);
    this.settings = stored;
    return { settings: this.getSettings(), keys };
  }

  getWindowState() {
    return this.windowState ? { ...this.windowState } : null;
  }

  saveWindowState(bounds) {
    const state = sanitizeWindowState(bounds);
    if (!state) return;
    const prev = this.windowState;
    if (
      prev &&
      prev.x === state.x &&
      prev.y === state.y &&
      prev.width === state.width &&
      prev.height === state.height
    ) {
      return;
    }
    this.windowFile.save(state);
    this.windowState = state;
  }
}

module.exports = {
  Store,
  JsonFile,
  defaultSettings,
  normalizeSettings,
  MAX_TASKS_BYTES,
};
