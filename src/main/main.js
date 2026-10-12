'use strict';
const fs = require('fs');
const path = require('path');
const { app, Menu, session, powerMonitor, safeStorage } = require('electron');
const { Store } = require('./store');
const { Desktop } = require('./desktop');
const { CloudSync, readCloudConfig } = require('./cloud-sync');
const { createTray } = require('./tray');
const { AUTOSTART_ARG, syncLoginItemAtStartup, setLoginItem } = require('./login-item');
const isDev = !app.isPackaged;
const override = String(process.env.DOOO_USER_DATA_DIR || '').trim();
const dataDir = override ? path.resolve(override) : isDev ? path.join(app.getPath('appData'), 'Dooo-dev') : null;
if (dataDir) { fs.mkdirSync(dataDir, { recursive: true }); app.setPath('userData', dataDir); }
let store, desktop, tray, cloud, cloudError, quitting = false;
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
  app.on('before-quit', () => { quitting = true; if (cloud) cloud.stop(); if (desktop) desktop.dispose(); });
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
    desktop = new Desktop(store, {
      isDev, inactive: process.argv.includes(AUTOSTART_ARG),
      isQuitting: () => quitting,
      quit: () => app.quit(),
      onSettings: settings => { if (tray) tray.refresh(); }
    });
    desktop.start();
    try {
      const config = readCloudConfig(app.getPath('userData'), safeStorage);
      if (config) cloud = new CloudSync(store, config, { onRemote: () => desktop.refreshCloudState(), onStatus: () => { if (tray) tray.refresh(); } });
    } catch { cloudError = true; console.warn('[dooo] Cloud configuration needs attention'); }
    tray = createTray({
      assetsDir: path.join(__dirname, '..', 'assets'),
      getSettings: () => store.getSettings(), onShow: () => desktop.showAll(),
      getSyncStatus: () => cloud ? cloud.status : cloudError ? { state: 'configuration-error' } : null,
      onSync: () => { if (cloud) cloud.sync(); },
      onToggle: (key, value) => desktop.updateSettings({ [key]: value }), onQuit: () => app.quit()
    });
    if (cloud) cloud.start();
    powerMonitor.on('shutdown', () => app.quit());
  }).catch(err => { console.error('[dooo] startup failed:', err); app.exit(1); });
}
