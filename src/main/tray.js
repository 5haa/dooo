'use strict';

const fs = require('fs');
const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

/**
 * Picks the tray image: src/assets/tray.ico, else src/assets/icon.png scaled to the
 * notification-area sizes, else an empty image (the icon is then invisible).
 * Returns { image, source }.
 */
function loadTrayImage(assetsDir) {
  const ico = path.join(assetsDir, 'tray.ico');
  if (fs.existsSync(ico)) {
    const image = nativeImage.createFromPath(ico);
    if (!image.isEmpty()) return { image, source: 'tray.ico' };
  }

  const png = path.join(assetsDir, 'icon.png');
  if (fs.existsSync(png)) {
    const base = nativeImage.createFromPath(png);
    if (!base.isEmpty()) {
      // Small-icon sizes for 100/125/150/200% scaling, so Windows does not shrink a big PNG.
      const image = nativeImage.createEmpty();
      for (const [scaleFactor, px] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32]]) {
        image.addRepresentation({
          scaleFactor,
          buffer: base.resize({ width: px, height: px, quality: 'best' }).toPNG(),
        });
      }
      return { image, source: 'icon.png' };
    }
  }

  return { image: nativeImage.createEmpty(), source: 'none' };
}

/**
 * Creates the notification-area icon and its menu.
 *   getSettings()        current settings (for the checkbox states)
 *   onShow()             show + focus the window
 *   onToggle(key, value) change a boolean setting ('alwaysOnTop' | 'launchAtLogin')
 *   onQuit()             really quit
 * Returns { tray, source, refresh(), destroy() }.
 */
function createTray({ assetsDir, getSettings, onShow, onToggle, onQuit, getSyncStatus = () => null, onSync = () => {} }) {
  const { image, source } = loadTrayImage(assetsDir);
  const tray = new Tray(image);
  tray.setToolTip('Dooo');
  tray.on('click', () => onShow());

  function refresh() {
    if (tray.isDestroyed()) return;
    const settings = getSettings();
    const sync = getSyncStatus();
    const labels = { synced: 'Synced', syncing: 'Syncing…', pending: 'Changes waiting to sync', offline: 'Offline — changes saved locally', unauthorized: 'Sign-in key needs attention', 'configuration-error': 'Connection needs attention' };
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Dooo', click: () => onShow() },
        ...(sync ? [{ label: 'Cloud: ' + (labels[sync.state] || sync.state), enabled: false }, { label: 'Sync now', click: onSync }, { type: 'separator' }] : []),
        {
          label: 'Keep on top',
          type: 'checkbox',
          checked: !!settings.alwaysOnTop,
          click: (item) => onToggle('alwaysOnTop', item.checked),
        },
        {
          label: 'Launch at startup',
          type: 'checkbox',
          checked: !!settings.launchAtLogin,
          click: (item) => onToggle('launchAtLogin', item.checked),
        },
        { type: 'separator' },
        { label: 'Quit Dooo', click: () => onQuit() },
      ]),
    );
  }

  refresh();

  return {
    tray,
    source,
    refresh,
    destroy() {
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}

module.exports = { createTray, loadTrayImage };
