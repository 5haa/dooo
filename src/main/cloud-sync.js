'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { JsonFile } = require('./store');
const { EMPTY, clone, equal, validateState, mergeState } = require('../shared/cloud-state');

function readCloudConfig(dir, safeStorage) {
  const file = path.join(dir, 'cloud.json');
  let config = {};
  if (fs.existsSync(file)) config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.DOOO_SYNC_URL) config.url = process.env.DOOO_SYNC_URL;
  if (process.env.DOOO_SYNC_TOKEN) config.token = process.env.DOOO_SYNC_TOKEN;
  if (!config.url) return null;
  if (!config.token && config.encryptedToken && safeStorage) config.token = safeStorage.decryptString(Buffer.from(config.encryptedToken, 'base64'));
  const url = new URL(config.url);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Cloud URL must use HTTPS');
  if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('Cloud token is missing');
  if (!process.env.DOOO_SYNC_TOKEN && safeStorage && safeStorage.isEncryptionAvailable() && !config.encryptedToken) {
    const secured = new JsonFile(file, value => value && typeof value === 'object');
    secured.save({ url: url.origin, encryptedToken: safeStorage.encryptString(config.token).toString('base64') });
  }
  return { url: url.origin, token: config.token };
}

class CloudSync {
  constructor(store, config, { onRemote = () => {}, onStatus = () => {}, fetchImpl = fetch, interval = 15000 } = {}) {
    this.store = store; this.config = config; this.onRemote = onRemote; this.onStatus = onStatus;
    this.fetch = fetchImpl; this.interval = interval; this.running = null; this.applying = false; this.stopped = false;
    this.metaFile = new JsonFile(path.join(store.dir, 'cloud-state.json'), value => value && typeof value.endpoint === 'string' && value.base && Array.isArray(value.base.tasks) && Array.isArray(value.base.projects));
    const saved = this.metaFile.load().value;
    this.meta = saved && saved.endpoint === config.url ? saved : { endpoint: config.url, base: clone(EMPTY) };
    this.status = { state: 'pending', lastSyncedAt: this.meta.lastSyncedAt || null };
    this.onChange = () => { if (!this.applying) { this.setStatus('pending'); this.schedule(); } };
  }
  snapshot() { return clone({ projects: this.store.getSettings().projects || [], tasks: this.store.getTasks() }); }
  setStatus(state) { this.status = { state, lastSyncedAt: this.meta.lastSyncedAt || null }; this.onStatus(this.status); }
  schedule() { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 350); }
  start() { this.store.on('change', this.onChange); this.poll = setInterval(() => this.sync(), this.interval); return this.sync(); }
  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.poll); this.store.off('change', this.onChange); }
  async request(method = 'GET', body) {
    const response = await this.fetch(this.config.url + '/api/state', {
      method, headers: { Authorization: 'Bearer ' + this.config.token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000), redirect: 'error'
    });
    if (response.status !== 409 && !response.ok) throw new Error(response.status === 401 ? 'Authentication failed' : 'Cloud unavailable');
    const value = await response.json();
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid cloud revision');
    value.data = validateState(value.data);
    return { ...value, conflict: response.status === 409 };
  }
  sync() {
    if (this.stopped) return Promise.resolve(false);
    if (this.running) return this.running;
    this.running = this.perform().finally(() => { this.running = null; });
    return this.running;
  }
  async perform() {
    this.setStatus('syncing');
    try {
      let remote = await this.request();
      let local, merged, accepted = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        local = this.snapshot();
        let candidate = local;
        if (!this.meta.lastSyncedAt && remote.data.projects.length) {
          candidate = clone(local);
          // A fresh install's implicit Tasks project must not rename a real cloud project.
          const defaults = candidate.projects.find(p => p.id === 'personal' && p.name === 'Tasks');
          const existing = remote.data.projects.find(p => p.id === 'personal');
          if (defaults && existing) defaults.name = existing.name;
        }
        merged = mergeState(this.meta.base, candidate, remote.data);
        validateState(merged);
        if (equal(merged, remote.data)) { accepted = true; break; }
        remote = await this.request('PUT', { revision: remote.revision, data: merged });
        if (!remote.conflict) { accepted = true; break; }
      }
      if (!accepted) throw new Error('Cloud is busy');
      if (this.stopped) return false;
      // Preserve edits made while the request was in flight; they will be pushed next.
      const current = this.snapshot(), next = mergeState(local, current, remote.data);
      validateState(next);
      if (!equal(current, next)) {
        this.applying = true;
        try { this.store.updateSettings({ projects: next.projects }); this.store.saveTasks(next.tasks); }
        finally { this.applying = false; }
        this.onRemote();
      }
      this.meta = { endpoint: this.config.url, base: remote.data, revision: remote.revision, lastSyncedAt: new Date().toISOString() };
      this.metaFile.save(this.meta);
      const pending = !equal(this.snapshot(), remote.data);
      this.setStatus(pending ? 'pending' : 'synced');
      if (pending) this.schedule();
      return true;
    } catch (error) {
      this.setStatus(error.message === 'Authentication failed' ? 'unauthorized' : 'offline');
      return false;
    }
  }
}
module.exports = { CloudSync, readCloudConfig };
