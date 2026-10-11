'use strict';

/**
 * Windows "launch at login" through app.setLoginItemSettings, which writes the HKCU Run
 * value "Dooo" = "<exe>" --autostart (and its StartupApproved state).
 * build/installer.nsh removes both values on a real uninstall.
 *
 * Windows is the source of truth: the user can turn Dooo off (or on again) in Task Manager
 * or in Settings > Apps > Startup, and Dooo must never undo that choice.
 *
 * Takes `app` as a parameter so it can be checked without Electron (tests/unit.js).
 */

const LOGIN_ITEM_NAME = 'Dooo';
const AUTOSTART_ARG = '--autostart';

function envFlag(env, name) {
  const value = String(env[name] || '').trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false' && value !== 'no';
}

/** Only packaged builds touch login items, and never with DOOO_DISABLE_AUTOSTART set. */
function loginItemsAllowed(app, env = process.env) {
  return app.isPackaged === true && !envFlag(env, 'DOOO_DISABLE_AUTOSTART');
}

function itemFor(execPath) {
  return { name: LOGIN_ITEM_NAME, path: execPath, args: [AUTOSTART_ARG] };
}

/** Dooo's own per-user Run entry for this executable, or null. */
function findLoginItem(app, item) {
  const current = app.getLoginItemSettings({ path: item.path, args: item.args }) || {};
  const items = Array.isArray(current.launchItems) ? current.launchItems : [];
  return items.find((entry) => entry && entry.name === LOGIN_ITEM_NAME && entry.scope !== 'machine') || null;
}

/**
 * Packaged startup. Returns { launchAtLogin, action }: the value the setting must have
 * afterwards, and what was done.
 *  - A Dooo login item exists: its enabled state wins (the user may have changed it in
 *    Windows), and the current exe path is re-registered with that same state.
 *  - No item: register it, enabled, when the setting is on; otherwise write nothing.
 */
function syncLoginItemAtStartup(app, settingOn, { env = process.env, execPath = process.execPath } = {}) {
  if (!loginItemsAllowed(app, env)) return { launchAtLogin: settingOn, action: 'skipped' };
  const item = itemFor(execPath);
  const existing = findLoginItem(app, item);
  if (existing) {
    const enabled = existing.enabled !== false;
    app.setLoginItemSettings({ ...item, openAtLogin: true, enabled });
    return { launchAtLogin: enabled, action: enabled ? 'refreshed (enabled)' : 'refreshed (kept disabled)' };
  }
  if (settingOn) {
    app.setLoginItemSettings({ ...item, openAtLogin: true, enabled: true });
    return { launchAtLogin: true, action: 'registered' };
  }
  return { launchAtLogin: false, action: 'none' };
}

/** Explicit toggle from the UI or the tray: register it enabled, or remove it. */
function setLoginItem(app, enable, { env = process.env, execPath = process.execPath } = {}) {
  if (!loginItemsAllowed(app, env)) return 'skipped';
  const item = itemFor(execPath);
  if (enable) {
    app.setLoginItemSettings({ ...item, openAtLogin: true, enabled: true });
    return 'registered';
  }
  app.setLoginItemSettings({ ...item, openAtLogin: false });
  return 'removed';
}

module.exports = { LOGIN_ITEM_NAME, AUTOSTART_ARG, loginItemsAllowed, syncLoginItemAtStartup, setLoginItem };
