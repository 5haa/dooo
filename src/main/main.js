'use strict';
const fs = require('fs');
const path = require('path');
const { app, Menu, session, powerMonitor, safeStorage, dialog, shell, globalShortcut } = require('electron');
const { Store } = require('./store');
const { Desktop } = require('./desktop');
const { CloudSync, readCloudConfig } = require('./cloud-sync');
const { ProjectLibrary } = require('./project-library');
const { TaskWriter } = require('./task-writer');
const { createTray } = require('./tray');
const { AUTOSTART_ARG, syncLoginItemAtStartup, setLoginItem } = require('./login-item');
const isDev = !app.isPackaged;
const override = String(process.env.DOOO_USER_DATA_DIR || '').trim();
const dataDir = override ? path.resolve(override) : isDev ? path.join(app.getPath('appData'), 'Dooo-dev') : null;
if (dataDir) { fs.mkdirSync(dataDir, { recursive: true }); app.setPath('userData', dataDir); }
let store, desktop, tray, cloud, cloudError, library, writer, pcWorker, pcLocked = false, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId('com.5haa.dooo');
  app.on('second-instance', () => { if (desktop) desktop.showAll(); });
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-frame-navigate', details => { if (!details.isMainFrame) details.preventDefault(); });
  });
  app.on('before-quit', () => { quitting = true; if (pcWorker) pcWorker.stop(); globalShortcut.unregisterAll(); if (cloud) cloud.stop(); if (desktop) desktop.dispose(); });
  app.on('will-quit', () => { if (tray) tray.destroy(); });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    store = new Store(app.getPath('userData')); store.load();
    try {
      const result = syncLoginItemAtStartup(app, store.getSettings().launchAtLogin === true);
      if (result.launchAtLogin !== store.getSettings().launchAtLogin) store.updateSettings({ launchAtLogin: result.launchAtLogin });
    } catch (err) { console.warn('[dooo] startup setting:', err.message); }
    library = new ProjectLibrary(store, { desktop: process.env.DOOO_PROJECT_ROOT || app.getPath('desktop'),
      onChange: () => { if (desktop && !quitting) { desktop.projects = store.getSettings().projects; desktop.broadcast(); } } });
    const discover = process.env.DOOO_DISABLE_PROJECT_DISCOVERY !== '1';
    desktop = new Desktop(store, {
      isDev, inactive: process.argv.includes(AUTOSTART_ARG),
      isQuitting: () => quitting,
      quit: () => app.quit(),
      aiAvailable: () => !!writer,
      rewriteTask: (id, text) => writer ? writer.rewrite(id, text) : { error: 'unavailable' },
      discoverProject: id => { if (discover) library.ensure(id, { force: true }); },
      linkFolder: (id, folder) => library.ensure(id, { folder, force: true }),
      onSettings: settings => { if (tray) tray.refresh(); }
    });
    desktop.start();
    try {
      const config = readCloudConfig(app.getPath('userData'), safeStorage);
      if (config) {
        writer = new TaskWriter(store, discover ? library : null, config);
        cloud = new CloudSync(store, config, { onRemote: () => { desktop.refreshCloudState(); if (discover) library.discoverAll(); }, onStatus: () => { if (tray) tray.refresh(); } });
      }
    } catch { cloudError = true; console.warn('[dooo] Cloud configuration needs attention'); }
    if (!override && process.env.DOOO_DISABLE_PC_WORKER !== '1') {
      try {
        const config = require('../../apps/worker/config').readConfig();
        if (config) {
          const { PCWorker } = require('../../apps/worker');
          pcWorker = new PCWorker(config, { isLocked: () => pcLocked, onChange: () => tray?.refresh() });
          void pcWorker.start();
          globalShortcut.register('Control+Alt+Escape', () => pcWorker.setPaused(true));
          powerMonitor.on('lock-screen', () => { pcLocked = true; pcWorker.abort('Windows locked'); void pcWorker.tick(); });
          powerMonitor.on('unlock-screen', () => { pcLocked = false; void pcWorker.tick(); });
          powerMonitor.on('suspend', () => { pcLocked = true; pcWorker.abort('PC sleeping'); });
          powerMonitor.on('resume', () => { pcLocked = false; void pcWorker.tick(); });
        }
      } catch { console.warn('[dooo] PC control needs configuration'); }
    }
    tray = createTray({
      assetsDir: path.join(__dirname, '..', 'assets'),
      getSettings: () => store.getSettings(), onShow: () => desktop.showAll(),
      getSyncStatus: () => cloud ? cloud.status : cloudError ? { state: 'configuration-error' } : null,
      onSync: () => { if (cloud) cloud.sync(); },
      getPCStatus: () => pcWorker ? { status: pcWorker.status, paused: pcWorker.paused } : null,
      onPCPause: value => pcWorker?.setPaused(value),
      onPairPhone: async () => {
        try {
          const paired = await pcWorker.request('pair');
          const result = await dialog.showMessageBox({ type: 'info', title: 'Connect your phone', message: paired.code.match(/.{1,4}/g).join(' '),
            detail: 'Open ' + paired.url + ' on your phone and enter this code within 10 minutes. Add Dooo to your Home Screen, then enable notifications.\n\nScreens are shared only during requests. Ctrl+Alt+Esc pauses PC control.', buttons: ['Done', 'Open web app'], defaultId: 0 });
          if (result.response === 1) await shell.openExternal(paired.url);
        } catch { await dialog.showMessageBox({ type: 'error', message: 'Could not create a phone code', detail: 'Check your internet connection and try again.' }); }
      },
      onRevokePhones: async () => { try { await pcWorker.request('revoke-phones'); } catch {} },
      onToggle: (key, value) => desktop.updateSettings({ [key]: value }), onQuit: () => app.quit()
    });
    if (cloud) cloud.start();
    if (discover) library.discoverAll();
    desktop.broadcast();
    powerMonitor.on('shutdown', () => app.quit());
  }).catch(err => { console.error('[dooo] startup failed:', err); app.exit(1); });
}
