'use strict';
const path = require('path');
const { BrowserWindow, ipcMain, screen, app, systemPreferences, dialog } = require('electron');
const { setLoginItem } = require('./login-item');
const { normalizeProjects, mergeProjectTasks, projectName, randomUUID } = require('./project-data');
const ROOT = path.join(__dirname, '..');
const { projectBounds, projectPosition, dockLayout, COLLAPSED_HEIGHT: COLLAPSED } = require('./bounds');
const COLORS = ['#db5a45', '#258d91', '#b47b15', '#3d74ce', '#805ec3', '#428366'];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function bounds(win, next) {
  const locked = !win.isResizable();
  if (locked) win.setResizable(true);
  win.setBounds(next);
  if (locked) win.setResizable(false);
}
class Desktop {
  constructor(store, options) {
    this.store = store; this.options = options;
    this.projects = normalizeProjects(store);
    this.entries = new Map(); this.dock = null; this.dockOpen = false;
    this.timer = null; this.disposed = false; this.cloudVersion = 0;
    const area = screen.getPrimaryDisplay().workArea;
    const saved = this.store.getSettings().dockPosition;
    this.dockPosition = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : { x: area.x + area.width - 44, y: area.y + Math.round(area.height * .35) };
    this.dockHeight = 160;
  }
  start() {
    this.registerIpc();
    this.projects.forEach((p, i) => this.createProjectWindow(p, i));
    this.createDock();
    screen.on('display-removed', () => this.recoverPositions());
    screen.on('display-metrics-changed', () => this.recoverPositions());
  }
  windowOptions(rect) {
    return { ...rect, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false,
      icon: path.join(ROOT, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(ROOT, 'preload', 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: this.options.isDev } };
  }
  defaultPosition(index, width = 380) { return projectPosition(index, screen.getPrimaryDisplay().workArea, width); }
  constrain(rect, expanded) { return projectBounds(rect, screen.getDisplayMatching(rect).workArea, expanded); }
  createProjectWindow(project, index) {
    const saved = (this.store.getSettings().floatingWindows || {})[project.id] || {};
    const expanded = saved.expanded === true;
    const position = this.defaultPosition(index);
    const initial = this.constrain({
      x: Number.isFinite(saved.x) ? saved.x : position.x, y: Number.isFinite(saved.y) ? saved.y : position.y,
      width: Number.isFinite(saved.width) ? saved.width : 380, height: Number.isFinite(saved.height) ? saved.height : 480
    }, expanded);
    const win = new BrowserWindow({ ...this.windowOptions(initial), title: project.name + ' — Dooo',
      alwaysOnTop: !!this.store.getSettings().alwaysOnTop });
    const entry = { win, projectId: project.id, expanded, expandedHeight: Number.isFinite(saved.height) ? saved.height : 480,
      hidden: saved.hidden === true, ignore: false, watch: null, animation: null, hideTimer: null };
    this.entries.set(project.id, entry);
    bounds(win, initial);
    this.wireWindow(entry, 'index.html');
    win.once('ready-to-show', () => { if (!entry.hidden) win.showInactive(); this.broadcast(); });
    win.on('move', () => { if (!entry.animation) this.saveSoon(); });
    win.on('resize', () => { if (!entry.animation && entry.expanded) entry.expandedHeight = win.getBounds().height; this.saveSoon(); });
    win.on('close', event => { if (!this.options.isQuitting()) { event.preventDefault(); this.hide(entry); } });
    win.on('closed', () => { this.clearEntry(entry); this.entries.delete(project.id); });
    win.on('query-session-end', () => this.flush());
    win.on('session-end', () => this.options.quit());
    return entry;
  }
  wireWindow(entry, file) {
    const win = entry.win;
    const load = () => win.loadFile(path.join(ROOT, 'renderer', file)).catch(err => console.error('[dooo] load:', err));
    entry.load = load;
    win.on('system-context-menu', event => event.preventDefault());
    win.on('show', () => this.ignore(entry, false));
    win.on('focus', () => this.ignore(entry, false));
    win.on('hide', () => this.ignore(entry, false));
    win.webContents.on('did-start-loading', () => this.ignore(entry, false));
    let crashes = [];
    win.webContents.on('render-process-gone', (_event, info) => {
      if (this.options.isQuitting() || win.isDestroyed() || info.reason === 'clean-exit') return;
      crashes = crashes.filter(t => Date.now() - t < 60000); crashes.push(Date.now());
      if (crashes.length <= 3) load();
    });
    if (this.options.isDev) win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        event.preventDefault(); win.webContents.toggleDevTools();
      } else if (input.control && input.key.toLowerCase() === 'r') { event.preventDefault(); win.webContents.reloadIgnoringCache(); }
    });
    load();
  }
  createDock() {
    const win = new BrowserWindow({ ...this.windowOptions(this.dockGeometry(false).bounds), title: 'Dooo controls', alwaysOnTop: true });
    this.dock = { win, projectId: null, ignore: false, watch: null };
    this.wireWindow(this.dock, 'dock.html');
    win.once('ready-to-show', () => win.showInactive());
    win.on('blur', () => { if (this.dockOpen) this.setDockOpen(false); });
    win.on('close', event => { if (!this.options.isQuitting()) { event.preventDefault(); this.setDockOpen(false); } });
  }
  dockGeometry(open = this.dockOpen) {
    const area = screen.getDisplayNearestPoint({ x: Math.round(this.dockPosition.x + 22), y: Math.round(this.dockPosition.y + 22) }).workArea;
    return dockLayout(this.dockPosition, area, open, this.dockHeight);
  }
  positionDock(open = this.dockOpen) {
    const layout = this.dockGeometry(open);
    this.dockPosition = layout.anchor;
    bounds(this.dock.win, layout.bounds);
    this.dock.win.webContents.send('dooo:dock-layout', layout);
  }
  moveDock(value) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return;
    const area = screen.getDisplayNearestPoint({ x: Math.round(value.x + 22), y: Math.round(value.y + 22) }).workArea;
    let x = clamp(value.x, area.x, area.x + area.width - 44);
    if (value.finish && value.snap !== false) {
      if (x - area.x < 24) x = area.x;
      else if (area.x + area.width - 44 - x < 24) x = area.x + area.width - 44;
    }
    this.dockPosition = { x, y: value.y };
    this.positionDock(); this.saveSoon();
  }
  setDockOpen(open) {
    this.dockOpen = !!open;
    clearTimeout(this.dockTimer);
    if (this.dockOpen) this.positionDock(true);
    else this.dockTimer = setTimeout(() => { if (!this.dock.win.isDestroyed() && !this.dockOpen) this.positionDock(false); }, 200);
    this.dock.win.webContents.send('dooo:dock-open', this.dockOpen);
    if (open) this.dock.win.focus();
  }
  snapshot(entry) {
    return {
      cloudVersion: this.cloudVersion,
      aiAvailable: !!(this.options.aiAvailable && this.options.aiAvailable()),
      kind: entry.projectId ? 'project' : 'dock', projectId: entry.projectId, expanded: !!entry.expanded, dockOpen: this.dockOpen,
      dockLayout: entry.projectId ? undefined : this.dockGeometry(),
      color: COLORS[Math.max(0, this.projects.findIndex(p => p.id === entry.projectId)) % COLORS.length],
      projects: this.projects.map((p, i) => {
        const tasks = this.store.getTasks().filter(t => t.projectId === p.id), item = this.entries.get(p.id);
        return { ...p, total: tasks.length, done: tasks.filter(t => t.done).length, color: COLORS[i % COLORS.length],
          visible: item ? !item.hidden : false, expanded: item ? item.expanded : false };
      }),
      tasks: entry.projectId ? this.store.getTasks().filter(t => t.projectId === entry.projectId) : [],
      settings: this.store.getSettings(), version: app.getVersion()
    };
  }
  broadcast() {
    [...this.entries.values(), this.dock].filter(Boolean).forEach(entry => {
      if (!entry.win.isDestroyed()) entry.win.webContents.send('dooo:desktop-changed', this.snapshot(entry));
    });
  }
  refreshCloudState() {
    this.cloudVersion++;
    this.projects = normalizeProjects(this.store);
    const ids = new Set(this.projects.map(p => p.id));
    for (const [id, entry] of this.entries) if (!ids.has(id)) {
      this.clearEntry(entry); entry.win.destroy(); this.entries.delete(id);
    }
    this.projects.forEach((project, index) => {
      const entry = this.entries.get(project.id);
      if (!entry) this.createProjectWindow(project, index);
      else entry.win.setTitle(project.name + ' — Dooo');
    });
    this.broadcast();
  }
  expand(entry, expanded) {
    if (!entry.projectId || entry.expanded === expanded) return;
    if (entry.expanded) entry.expandedHeight = entry.win.getBounds().height;
    entry.expanded = expanded;
    const current = entry.win.getBounds();
    const target = this.constrain({ ...current, height: expanded ? entry.expandedHeight : COLLAPSED }, expanded);
    this.broadcast();
    this.animate(entry, target);
  }
  animate(entry, target) {
    clearInterval(entry.animation);
    const from = entry.win.getBounds(), start = Date.now();
    if (systemPreferences.getAnimationSettings().prefersReducedMotion) { bounds(entry.win, target); entry.animation = null; this.saveSoon(); return; }
    entry.animation = setInterval(() => {
      if (entry.win.isDestroyed()) { clearInterval(entry.animation); return; }
      const t = Math.min(1, (Date.now() - start) / 240), ease = 1 - Math.pow(1 - t, 4);
      const frame = {};
      for (const key of ['x', 'y', 'width', 'height']) frame[key] = Math.round(from[key] + (target[key] - from[key]) * ease);
      bounds(entry.win, frame);
      if (t === 1) { clearInterval(entry.animation); entry.animation = null; this.saveSoon(); }
    }, 16);
  }
  hide(entry) {
    if (!entry.projectId) return;
    entry.hidden = true;
    entry.win.webContents.send('dooo:visibility', false);
    clearTimeout(entry.hideTimer);
    entry.hideTimer = setTimeout(() => { if (!entry.win.isDestroyed() && entry.hidden) entry.win.hide(); }, systemPreferences.getAnimationSettings().prefersReducedMotion ? 0 : 150);
    this.saveSoon(); this.broadcast();
  }
  show(entry) {
    clearTimeout(entry.hideTimer); entry.hidden = false;
    if (entry.win.isMinimized()) entry.win.restore();
    entry.win.showInactive(); entry.win.webContents.send('dooo:visibility', true);
    this.saveSoon(); this.broadcast();
  }
  showAll() { this.entries.forEach(e => this.show(e)); if (this.dock) this.dock.win.showInactive(); }
  arrange() {
    this.projects.forEach((project, i) => {
      const entry = this.entries.get(project.id), current = entry.win.getBounds();
      if (entry.expanded) entry.expandedHeight = current.height;
      entry.expanded = false; this.show(entry);
      this.animate(entry, this.constrain({ ...current, ...this.defaultPosition(i, 380), width: 380, height: COLLAPSED }, false));
    });
    this.broadcast();
  }
  ignore(entry, ignore) {
    if (!entry || entry.win.isDestroyed()) return;
    entry.ignore = ignore;
    entry.win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
    clearInterval(entry.watch); entry.watch = null;
    if (ignore) entry.watch = setInterval(() => {
      if (entry.win.isDestroyed() || !entry.win.isVisible()) { clearInterval(entry.watch); return; }
      const p = screen.getCursorScreenPoint(), b = entry.win.getBounds();
      if (p.x > b.x + 12 && p.x < b.x + b.width - 12 && p.y > b.y + 12 && p.y < b.y + b.height - 12) this.ignore(entry, false);
    }, 120);
  }
  recoverPositions() {
    this.entries.forEach(entry => bounds(entry.win, this.constrain(entry.win.getBounds(), entry.expanded)));
    if (this.dock) this.positionDock();
    this.saveSoon();
  }
  saveSoon() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 350); }
  flush() {
    clearTimeout(this.timer);
    const floatingWindows = Object.fromEntries([...this.entries].filter(([, e]) => !e.win.isDestroyed()).map(([id, e]) => {
      const b = e.win.getBounds();
      return [id, { x: b.x, y: b.y, width: b.width, height: e.expandedHeight, expanded: e.expanded, hidden: e.hidden }];
    }));
    if (this.entries.size) this.store.updateSettings({ floatingWindows, dockPosition: this.dockPosition });
  }
  updateSettings(patch) {
    const allowed = {};
    for (const key of ['alwaysOnTop', 'launchAtLogin', 'aiRewriteEnabled']) if (typeof patch[key] === 'boolean') allowed[key] = patch[key];
    const { settings, keys } = this.store.updateSettings(allowed);
    if (keys.includes('alwaysOnTop')) this.entries.forEach(e => e.win.setAlwaysOnTop(settings.alwaysOnTop, 'floating'));
    if (keys.includes('launchAtLogin')) setLoginItem(app, settings.launchAtLogin);
    this.options.onSettings(settings); this.broadcast();
    return settings;
  }
  command(entry, action, value) {
    if (action === 'pair-phone') {
      if (entry !== this.dock || !this.options.onPairPhone) throw new Error('Open Settings in the project controls to connect a phone.');
      return this.options.onPairPhone();
    }
    if (action === 'link-folder' && entry.projectId) {
      return dialog.showOpenDialog(entry.win, { title: 'Link project folder', properties: ['openDirectory'],
        defaultPath: (this.store.getSettings().projectFolders || {})[entry.projectId]?.path || app.getPath('desktop')
      }).then(async result => {
        if (!result.canceled && result.filePaths.length) await this.options.linkFolder(entry.projectId, result.filePaths[0]);
      });
    }
    if (action === 'refresh-context' && entry.projectId) { this.options.discoverProject(entry.projectId); return; }
    if (action === 'move-dock' && !entry.projectId) { this.moveDock(value); return; }
    if (action === 'dock-height' && !entry.projectId && Number.isFinite(value)) {
      this.dockHeight = clamp(value, 140, 360);
      if (this.dockOpen) this.positionDock();
      return;
    }
    if (action === 'dock') { this.setDockOpen(value === true); return; }
    if (action === 'show-all') this.showAll();
    else if (action === 'hide-all') this.entries.forEach(e => this.hide(e));
    else if (action === 'collapse-all') this.entries.forEach(e => this.expand(e, false));
    else if (action === 'expand-all') this.entries.forEach(e => { this.show(e); this.expand(e, true); });
    else if (action === 'arrange') this.arrange();
    else if (action === 'show-project') {
      const target = this.entries.get(value); if (target) { this.show(target); this.expand(target, true); target.win.focus(); }
    } else if (action === 'expand') this.expand(entry, value === true);
    else if (action === 'hide') this.hide(entry);
    else if (action === 'rename') {
      const name = projectName(value);
      if (!entry.projectId || !name) throw new Error('Enter a project name.');
      if (this.projects.some(p => p.id !== entry.projectId && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('That project name is already used.');
      this.projects = this.projects.map(p => p.id === entry.projectId ? { ...p, name } : p);
      this.store.updateSettings({ projects: this.projects }); entry.win.setTitle(name + ' — Dooo'); this.broadcast();
      if (this.options.discoverProject) this.options.discoverProject(entry.projectId);
    } else if (action === 'create') {
      const name = projectName(value);
      if (!name) throw new Error('Enter a project name.');
      if (this.projects.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('That project already exists.');
      const project = { id: randomUUID(), name }; this.projects.push(project);
      this.store.updateSettings({ projects: this.projects });
      const created = this.createProjectWindow(project, this.projects.length - 1);
      created.win.once('ready-to-show', () => { this.show(created); this.expand(created, true); created.win.focus(); });
      this.broadcast(); if (this.options.discoverProject) this.options.discoverProject(project.id); return project;
    }
  }
  sender(event) {
    const entry = [...this.entries.values(), this.dock].filter(Boolean).find(e => !e.win.isDestroyed() && e.win.webContents === event.sender);
    if (!entry || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown window');
    return entry;
  }
  registerIpc() {
    const handle = (channel, fn) => ipcMain.handle('dooo:' + channel, (event, ...args) => fn(this.sender(event), ...args));
    const listen = (channel, fn) => ipcMain.on('dooo:' + channel, (event, ...args) => {
      try { fn(this.sender(event), ...args); } catch (err) { console.warn('[dooo] ' + channel + ':', err.message); }
    });
    handle('load-state', entry => this.snapshot(entry));
    handle('rewrite-task', (entry, text) => entry.projectId && this.options.rewriteTask ? this.options.rewriteTask(entry.projectId, text) : { error: 'unavailable' });
    handle('desktop', (entry, action, value) => this.command(entry, action, value));
    handle('save-tasks', (entry, tasks) => {
      if (!entry.projectId) throw new Error('Select a project first');
      this.store.saveTasks(mergeProjectTasks(this.store.getTasks(), tasks, entry.projectId));
      this.broadcast();
    });
    handle('update-settings', (_entry, patch) => this.updateSettings(patch || {}));
    handle('window-get-size', entry => { const b = entry.win.getBounds(); return { width: b.width, height: b.height }; });
    handle('window-get-bounds', entry => entry.win.getBounds());
    listen('window-hide', entry => this.hide(entry));
    listen('window-set-size', (entry, width, height) => {
      if (!entry.projectId || !Number.isFinite(width) || !Number.isFinite(height)) return;
      clearInterval(entry.animation); entry.animation = null;
      const target = this.constrain({ ...entry.win.getBounds(), width, height }, entry.expanded);
      bounds(entry.win, target); if (entry.expanded) entry.expandedHeight = target.height; this.saveSoon();
    });
    listen('window-move', (entry, x, y) => {
      if (!entry.projectId || !Number.isFinite(x) || !Number.isFinite(y)) return;
      bounds(entry.win, this.constrain({ ...entry.win.getBounds(), x, y }, entry.expanded)); this.saveSoon();
    });
    listen('window-set-ignore-mouse', (entry, value) => this.ignore(entry, value === true));
    listen('quit', () => this.options.quit());
  }
  clearEntry(entry) { clearInterval(entry.watch); clearInterval(entry.animation); clearTimeout(entry.hideTimer); }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.flush(); clearTimeout(this.dockTimer); [...this.entries.values(), this.dock].filter(Boolean).forEach(e => this.clearEntry(e));
  }
}
module.exports = { Desktop };
