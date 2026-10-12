'use strict';
// Standalone host retains Electron's native Windows lock/suspend detection.
const { app, powerMonitor, globalShortcut } = require('electron');
const { PCWorker } = require('./index');
const { readConfig } = require('./config');
let worker, locked = false;
app.whenReady().then(async () => {
  const config = readConfig(); if (!config) { console.error('Connect this PC first. See docs/PC-CONTROL.md.'); app.quit(); return; }
  worker = new PCWorker(config, { isLocked: () => locked });
  for (const event of ['lock-screen', 'suspend']) powerMonitor.on(event, () => { locked = true; worker.abort('Windows locked or suspended'); void worker.tick(); });
  for (const event of ['unlock-screen', 'resume']) powerMonitor.on(event, () => { locked = false; void worker.tick(); });
  globalShortcut.register('Control+Alt+Escape', () => worker.setPaused(true));
  await worker.start();
});
app.on('before-quit', () => { worker?.stop(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => {}); // Closing an automation target must not stop the background host.
