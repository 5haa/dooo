'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { redact } = require('../shared/project-context');
const SKIP = /^(?:\.|node_modules$|vendor$|dist$|build$|target$|coverage$|artifacts$|output$|tmp$|temp$|backups?$)/i;
const PRIVATE = /(?:^|[._-])(?:env|secret|credential|token|password|private|key)(?:[._-]|$)|^(?:AGENTS|CLAUDE)\.md$/i;
const nameKey = name => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function inside(root, file) { const relative = path.relative(root, file); return !relative.startsWith('..') && !path.isAbsolute(relative); }
async function entries(dir) { try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; } }
async function safeRead(root, file, limit = 16000) {
  try {
    if (!inside(root, file) || PRIVATE.test(path.basename(file))) return '';
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128000 || !inside(root, await fs.realpath(file))) return '';
    return redact((await fs.readFile(file, 'utf8')).slice(0, limit));
  } catch { return ''; }
}
async function findFolders(desktop) {
  const root = await fs.realpath(desktop), queue = [{ dir: root, depth: 0 }], result = [];
  while (queue.length && result.length < 1800) {
    const { dir, depth } = queue.shift(), children = await entries(dir);
    if (depth) result.push(dir);
    if (depth >= 4 || (depth && children.some(item => ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'pubspec.yaml'].includes(item.name)))) continue;
    for (const item of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!item.isDirectory() || item.isSymbolicLink() || SKIP.test(item.name)) continue;
      const next = path.join(dir, item.name);
      try { if (inside(root, await fs.realpath(next))) queue.push({ dir: next, depth: depth + 1 }); } catch {}
    }
  }
  return result;
}
async function buildContext(folder) {
  const root = await fs.realpath(folder), tree = [], docs = [], manifests = [], queue = [{ dir: root, depth: 0 }];
  while (queue.length && tree.length < 300) {
    const { dir, depth } = queue.shift();
    for (const item of (await entries(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.isSymbolicLink() || SKIP.test(item.name) || PRIVATE.test(item.name)) continue;
      const file = path.join(dir, item.name), relative = path.relative(root, file).replace(/\\/g, '/');
      if (tree.length >= 300) break;
      tree.push(relative + (item.isDirectory() ? '/' : ''));
      if (item.isDirectory() && depth < 2) {
        try { if (inside(root, await fs.realpath(file))) queue.push({ dir: file, depth: depth + 1 }); } catch {}
      } else if (item.isFile()) {
        if (item.name === 'package.json') manifests.push(file);
        if (/^(?:readme|architecture|product|overview)(?:[._-].*)?\.md$/i.test(item.name)) docs.push(file);
      }
    }
  }
  const parts = [];
  for (const file of manifests.slice(0, 12)) {
    try {
      const data = JSON.parse(await safeRead(root, file));
      parts.push('Manifest ' + path.relative(root, file) + ': ' + JSON.stringify({ name: data.name, description: data.description,
        workspaces: data.workspaces, dependencies: Object.keys(data.dependencies || {}).slice(0, 50) }));
    } catch {}
  }
  for (const file of docs.slice(0, 8)) {
    const text = await safeRead(root, file, file === path.join(root, 'README.md') ? 6500 : 2000);
    if (text) parts.push('Document ' + path.relative(root, file) + ':\n' + text);
  }
  return redact(parts.join('\n\n').slice(0, 14000) + '\n\nProject files (names only):\n' + tree.join('\n').slice(0, 4000)).slice(0, 18500);
}
class ProjectLibrary {
  constructor(store, { desktop, onChange = () => {} }) { this.store = store; this.desktop = desktop; this.onChange = onChange; this.pending = new Map(); }
  project(id) { return (this.store.getSettings().projects || []).find(p => p.id === id); }
  async candidates(name) {
    if (!this.scannedAt || Date.now() - this.scannedAt > 60000) {
      this.scannedAt = Date.now(); this.folders = findFolders(this.desktop).catch(() => []);
    }
    const folders = await this.folders, key = nameKey(name);
    return folders.filter(folder => nameKey(path.basename(folder)) === key);
  }
  ensure(id, options = {}) {
    if (this.pending.has(id)) return options.folder ? this.pending.get(id).then(() => this.ensure(id, options)) : this.pending.get(id);
    const promise = this.refresh(id, options).catch(() => this.project(id)).finally(() => this.pending.delete(id));
    this.pending.set(id, promise); return promise;
  }
  async refresh(id, { folder, force = false } = {}) {
    const project = this.project(id); if (!project) return null;
    const mapping = (this.store.getSettings().projectFolders || {})[id];
    if (!force && !folder && mapping && mapping.name === project.name && Date.now() - mapping.checkedAt < 300000) return project;
    // Only locally discovered or user-selected paths are opened. Never trust a path from cloud state.
    let selected = folder || (mapping && mapping.name === project.name && mapping.path);
    if (selected) { try { if (!(await fs.stat(selected)).isDirectory()) selected = null; } catch { selected = null; } }
    const matches = selected ? [] : await this.candidates(project.name);
    selected = selected || (matches.length === 1 ? matches[0] : null);
    let metadata = mapping && mapping.name !== project.name ? { folderPath: null, folderDevice: null,
      contextText: null, contextHash: null, contextUpdatedAt: null } : {};
    let status = matches.length > 1 ? 'ambiguous' : 'missing';
    if (selected) {
      selected = await fs.realpath(selected);
      const contextText = await buildContext(selected), contextHash = createHash('sha256').update(contextText).digest('hex');
      metadata = { folderPath: selected, folderDevice: os.hostname(), contextText, contextHash,
        contextUpdatedAt: project.contextHash === contextHash ? project.contextUpdatedAt || Date.now() : Date.now() };
      status = 'linked';
    }
    const projectFolders = { ...this.store.getSettings().projectFolders,
      [id]: { path: selected || null, name: project.name, status, checkedAt: Date.now(), candidates: matches.slice(0, 10) } };
    this.store.updateSettings({ projectFolders });
    // Read the latest project records after I/O so a simultaneous rename/sync is preserved.
    const current = this.project(id); if (!current || current.name !== project.name) return current;
    if (Object.keys(metadata).some(key => current[key] !== metadata[key])) {
      this.store.updateSettings({ projects: this.store.getSettings().projects.map(p => p.id === id ? { ...p, ...metadata } : p) });
    }
    this.onChange(); return this.project(id);
  }
  async discoverAll() { for (const project of this.store.getSettings().projects || []) await this.ensure(project.id); }
}
module.exports = { ProjectLibrary, findFolders, buildContext, safeRead };
