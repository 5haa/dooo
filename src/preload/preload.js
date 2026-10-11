'use strict';

/**
 * Sandboxed preload: exposes window.dooo (the contract API) and nothing else.
 * Channel names must match CH in src/main/main.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

const CH = {
  loadState: 'dooo:load-state',
  saveTasks: 'dooo:save-tasks',
  updateSettings: 'dooo:update-settings',
  settingsChanged: 'dooo:settings-changed',
  windowHide: 'dooo:window-hide',
  windowGetSize: 'dooo:window-get-size',
  windowSetSize: 'dooo:window-set-size',
  windowSetIgnoreMouse: 'dooo:window-set-ignore-mouse',
  quit: 'dooo:quit',
};

contextBridge.exposeInMainWorld('dooo', {
  /** @returns {Promise<{ tasks: object[], settings: object, version: string }>} */
  loadState: () => ipcRenderer.invoke(CH.loadState),

  /** Persists the whole task array (atomically). @returns {Promise<void>} */
  saveTasks: (tasks) => ipcRenderer.invoke(CH.saveTasks, tasks),

  /** Shallow-merges and persists. @returns {Promise<object>} the full settings */
  updateSettings: (patch) => ipcRenderer.invoke(CH.updateSettings, patch),

  /** Fires when settings change outside the renderer (tray menu). Returns an unsubscribe fn. */
  onSettingsChanged: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('onSettingsChanged expects a function');
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on(CH.settingsChanged, listener);
    return () => {
      ipcRenderer.removeListener(CH.settingsChanged, listener);
    };
  },

  window: {
    /** Hide to the tray. */
    hide: () => {
      ipcRenderer.send(CH.windowHide);
    },
    /** @returns {Promise<{ width: number, height: number }>} */
    getSize: () => ipcRenderer.invoke(CH.windowGetSize),
    /** Main rounds, clamps to min/max, applies and persists. */
    setSize: (width, height) => {
      ipcRenderer.send(CH.windowSetSize, Number(width), Number(height));
    },
    /** true = click-through (mouse moves are still forwarded to the page). */
    setIgnoreMouse: (ignore) => {
      ipcRenderer.send(CH.windowSetIgnoreMouse, Boolean(ignore));
    },
  },

  /** Really quit (not hide). */
  quit: () => {
    ipcRenderer.send(CH.quit);
  },
});
