'use strict';

/**
 * Dooo main process: the widget window, tray icon, persistence, launch-at-login and the IPC
 * behind window.dooo (the renderer-facing API lives in src/preload/preload.js).
 *
 * Environment hooks:
 *   DOOO_USER_DATA_DIR=<dir>   use <dir> as userData (set before the single-instance lock)
 *   DOOO_DISABLE_AUTOSTART=1   never touch Windows login items
 * Unpackaged runs use %APPDATA%\Dooo-dev and never touch login items.
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, screen, session, powerMonitor } = require('electron');

const { Store } = require('./store');
const { createTray } = require('./tray');
const { clampSize, isReachable, defaultBounds, sameBounds, isInSafeCore } = require('./bounds');
const { AUTOSTART_ARG, syncLoginItemAtStartup, setLoginItem } = require('./login-item');

const APP_ID = 'com.5haa.dooo';
// On Windows, 'floating' keeps the window above normal windows but below the taskbar.
const ALWAYS_ON_TOP_LEVEL = 'floating';

const SRC_DIR = path.join(__dirname, '..');
const RENDERER_INDEX = path.join(SRC_DIR, 'renderer', 'index.html');
const PRELOAD = path.join(SRC_DIR, 'preload', 'preload.js');
const ASSETS_DIR = path.join(SRC_DIR, 'assets');

// IPC channels. Keep in sync with src/preload/preload.js: a sandboxed preload cannot
// require local files, so the names are repeated there.
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

// Web permissions the page may get. Everything else (camera, mic, geolocation…) is refused.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications']);
// Click-through watchdog: how often to check the cursor while the window ignores the mouse.
const CLICK_THROUGH_POLL_MS = 120;

const isDev = !app.isPackaged;
const launchedAtLogin = process.argv.includes(AUTOSTART_ARG);

let store = null;
let mainWindow = null;
let windowRevealed = false;
let trayController = null;
let isQuitting = false;
let sessionEnding = false;
let ignoringMouse = false;
let clickThroughWatchdog = null;
let watchdogResets = 0;
let lastWatchdogLog = 0;
let saveBoundsTimer = null;
let reachabilityTimer = null;
let sessionEndResetTimer = null;
const rendererCrashes = [];

// Read-only view of the click-through state for tests. It lives on the main process's
// global, which the sandboxed renderer cannot reach.
Object.defineProperty(globalThis, '__doooClickThrough', {
  enumerable: false,
  configurable: false,
  get: () => ({ ignoring: ignoringMouse, watchdog: clickThroughWatchdog !== null, resets: watchdogResets }),
});

function log(...args) {
  console.log('[dooo]', ...args);
}

function warn(...args) {
  console.warn('[dooo]', ...args);
}

// ---------------------------------------------------------------------------------------
// Startup order: userData path -> single-instance lock -> AppUserModelId.
// ---------------------------------------------------------------------------------------

function configureUserData() {
  const override = String(process.env.DOOO_USER_DATA_DIR || '').trim();
  let dir = null;
  if (override) dir = path.resolve(override);
  else if (isDev) dir = path.join(app.getPath('appData'), 'Dooo-dev');
  if (!dir) return; // packaged default: %APPDATA%\Dooo
  fs.mkdirSync(dir, { recursive: true }); // setPath throws for a missing directory
  app.setPath('userData', dir);
}

configureUserData();

if (!app.requestSingleInstanceLock()) {
  // Another Dooo owns this userData. It gets 'second-instance' and shows itself.
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  start();
}

function start() {
  app.on('second-instance', () => {
    log('second instance started; focusing the existing window');
    showWindow();
  });
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.on('before-quit', () => {
    isQuitting = true;
    flushBounds();
  });
  app.on('will-quit', () => {
    if (trayController) trayController.destroy();
  });
  // Closing the window only hides it, so this fires only if the window was destroyed some
  // other way. Dooo stays in the tray unless a real quit is under way.
  app.on('window-all-closed', () => {
    if (isQuitting || sessionEnding) app.quit();
  });

  app
    .whenReady()
    .then(onReady)
    .catch((err) => {
      console.error('[dooo] startup failed:', err);
      app.exit(1);
    });
}

function onReady() {
  Menu.setApplicationMenu(null);
  lockDownSession(session.defaultSession);

  store = new Store(app.getPath('userData'));
  store.load();
  log(`userData: ${app.getPath('userData')}`);

  registerIpc();
  // Before the window loads, so loadState already returns the synced launchAtLogin.
  syncLoginItemOnStartup();

  createWindow({ inactive: launchedAtLogin });
  createTrayIcon();

  screen.on('display-removed', scheduleReachabilityCheck);
  screen.on('display-metrics-changed', scheduleReachabilityCheck);
  // Linux/macOS only; on Windows the window's session events below cover shutdown.
  powerMonitor.on('shutdown', () => endSession('system shutdown'));
}

// ---------------------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------------------

function lockDownSession(ses) {
  // Dooo is fully local: refuse anything that would reach the network.
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      warn(`blocked remote request: ${details.url}`);
      callback({ cancel: true });
    },
  );
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
}

function hardenWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    warn(`blocked window.open: ${url}`);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame) details.preventDefault();
  });
}

// ---------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------

function workAreas() {
  return screen.getAllDisplays().map((display) => display.workArea);
}

/** Saved bounds if the window would still be reachable, else top-right of the primary display. */
function initialBounds() {
  const saved = store.getWindowState();
  if (saved) {
    const area = screen.getDisplayMatching(saved).workArea;
    const candidate = { x: saved.x, y: saved.y, ...clampSize(saved.width, saved.height, area) };
    if (isReachable(candidate, workAreas())) return candidate;
    log('saved window position is off-screen; using the default placement');
  }
  return defaultBounds(screen.getPrimaryDisplay().workArea);
}

/**
 * setBounds for a window that is not natively resizable. On Windows, resizable:false pins
 * min = max = current size, so a plain setBounds can grow the window but never shrink it.
 * The lock is lifted for this one synchronous call only: no input is processed in between,
 * so the transparent margin never gets native resize borders.
 */
function applyBounds(win, bounds) {
  const locked = !win.isResizable();
  if (locked) win.setResizable(true);
  try {
    win.setBounds(bounds);
  } finally {
    if (locked) win.setResizable(false);
  }
}

function createWindow({ inactive = false } = {}) {
  const settings = store.getSettings();
  const bounds = initialBounds();
  const iconPath = path.join(ASSETS_DIR, 'icon.png');

  const win = new BrowserWindow({
    ...bounds,
    title: 'Dooo',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: !!settings.alwaysOnTop,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: isDev,
    },
  });
  mainWindow = win;
  windowRevealed = false;
  ignoringMouse = false;

  // Mixed-DPI setups can size a new window with the wrong scale factor; apply it again.
  applyBounds(win, bounds);
  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);

  let revealFallback = null;
  const reveal = () => {
    clearTimeout(revealFallback);
    if (windowRevealed || win.isDestroyed()) return;
    windowRevealed = true;
    if (inactive) {
      win.showInactive(); // started at sign-in: don't steal focus
    } else {
      win.show();
      win.focus();
    }
  };
  win.once('ready-to-show', reveal);
  // Never stay invisible if the page fails to paint.
  revealFallback = setTimeout(reveal, 5000);

  win.on('close', (event) => {
    if (isQuitting || sessionEnding) return;
    event.preventDefault(); // Alt+F4 and friends hide to the tray
    hideWindow();
  });
  win.on('closed', () => {
    clearTimeout(revealFallback);
    if (mainWindow === win) {
      stopClickThroughWatchdog();
      mainWindow = null;
    }
  });
  // Click-through safety: a window that is shown or focused always takes the mouse again.
  win.on('show', () => forceClickable(win));
  win.on('focus', () => forceClickable(win));
  win.on('hide', () => stopClickThroughWatchdog());
  win.on('move', scheduleSaveBounds);
  win.on('resize', scheduleSaveBounds);
  // Right-clicking a drag region must not open the Windows system menu.
  win.on('system-context-menu', (event) => event.preventDefault());
  // Windows sign-out / restart / shutdown: never block it.
  win.on('query-session-end', () => prepareForSessionEnd());
  win.on('session-end', () => endSession('session end'));

  const contents = win.webContents;
  contents.on('will-navigate', (details) => {
    // Dropped files or links and stray navigations must never replace the app page.
    details.preventDefault();
    warn(`blocked navigation to ${details.url}`);
  });
  contents.on('did-start-loading', () => {
    // A fresh page knows nothing about click-through; start with a clickable window.
    if (ignoringMouse) forceClickable(win);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) warn(`page failed to load (${code} ${description}): ${url}`);
  });
  contents.on('render-process-gone', (_event, details) => onRendererGone(win, details));
  if (isDev) contents.on('before-input-event', (event, input) => handleDevShortcuts(event, input, contents));

  win.loadFile(RENDERER_INDEX).catch((err) => warn(`could not load ${RENDERER_INDEX}: ${err.message}`));
  return win;
}

function showWindow() {
  if (!store) return; // not ready yet; the window shows itself on ready-to-show
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ inactive: false });
    return;
  }
  const win = mainWindow;
  windowRevealed = true;
  if (win.isMinimized()) win.restore();
  keepWindowReachable();
  win.show();
  win.focus();
  // Windows can drop the topmost flag while a window is hidden; re-assert it.
  if (store.getSettings().alwaysOnTop) win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  flushBounds();
  mainWindow.hide();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function setWindowSize(width, height) {
  const win = mainWindow;
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  const current = win.getBounds();
  const size = clampSize(w, h, screen.getDisplayMatching(current).workArea);
  if (size.width === current.width && size.height === current.height) return;
  applyBounds(win, { x: current.x, y: current.y, ...size });
  scheduleSaveBounds();
}

function setIgnoreMouse(ignore) {
  if (ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    startClickThroughWatchdog();
  } else {
    mainWindow.setIgnoreMouseEvents(false);
    stopClickThroughWatchdog();
  }
}

/** Makes the window take the mouse again (show/focus, page loads, the watchdog). */
function forceClickable(win) {
  stopClickThroughWatchdog();
  ignoringMouse = false;
  if (!win.isDestroyed()) win.setIgnoreMouseEvents(false);
}

function startClickThroughWatchdog() {
  if (clickThroughWatchdog) return;
  clickThroughWatchdog = setInterval(checkClickThrough, CLICK_THROUGH_POLL_MS);
}

function stopClickThroughWatchdog() {
  if (!clickThroughWatchdog) return;
  clearInterval(clickThroughWatchdog);
  clickThroughWatchdog = null;
}

/**
 * Safety net for a stuck click-through. While the window ignores the mouse, a cursor over
 * the panel's safe core means real clicks would fall through to whatever is behind the
 * widget, so the window is made clickable again. The renderer resyncs on its next
 * mousemove. Runs only while click-through is on and the window is visible.
 */
function checkClickThrough() {
  const win = mainWindow;
  if (!ignoringMouse || !win || win.isDestroyed() || !win.isVisible()) {
    stopClickThroughWatchdog();
    return;
  }
  let cursor;
  try {
    cursor = screen.getCursorScreenPoint();
  } catch {
    return;
  }
  if (!isInSafeCore(cursor, win.getBounds())) return;
  forceClickable(win);
  watchdogResets++;
  const now = Date.now();
  if (now - lastWatchdogLog > 10_000) {
    lastWatchdogLog = now;
    warn('click-through was on with the cursor over the panel; the window takes the mouse again');
  }
}

function scheduleSaveBounds() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(flushBounds, 400);
}

function flushBounds() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = null;
  const win = mainWindow;
  if (!store || !win || win.isDestroyed() || win.isMinimized()) return;
  try {
    store.saveWindowState(win.getBounds());
  } catch (err) {
    warn(`could not save the window position: ${err.message}`);
  }
}

function scheduleReachabilityCheck() {
  clearTimeout(reachabilityTimer);
  reachabilityTimer = setTimeout(keepWindowReachable, 300);
}

/** After display changes: clamp to the new work area, or move back on-screen if lost. */
function keepWindowReachable() {
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const current = win.getBounds();
  const area = screen.getDisplayMatching(current).workArea;
  let next = { x: current.x, y: current.y, ...clampSize(current.width, current.height, area) };
  if (!isReachable(next, workAreas())) next = defaultBounds(screen.getPrimaryDisplay().workArea);
  if (sameBounds(next, current)) return;
  applyBounds(win, next);
  scheduleSaveBounds();
}

function onRendererGone(win, details) {
  warn(`renderer process gone (${details.reason}, exit code ${details.exitCode})`);
  if (isQuitting || win.isDestroyed() || details.reason === 'clean-exit') return;
  const now = Date.now();
  while (rendererCrashes.length && now - rendererCrashes[0] > 60_000) rendererCrashes.shift();
  rendererCrashes.push(now);
  if (rendererCrashes.length > 3) {
    warn('the renderer keeps crashing; not reloading again');
    return;
  }
  win.loadFile(RENDERER_INDEX).catch((err) => warn(`reload failed: ${err.message}`));
}

function handleDevShortcuts(event, input, contents) {
  if (input.type !== 'keyDown') return;
  const key = String(input.key || '').toLowerCase();
  if (key === 'f12' || (input.control && input.shift && key === 'i')) {
    event.preventDefault();
    if (contents.isDevToolsOpened()) contents.closeDevTools();
    else contents.openDevTools({ mode: 'detach' });
  } else if (input.control && !input.shift && key === 'r') {
    event.preventDefault();
    contents.reloadIgnoringCache();
  }
}

// ---------------------------------------------------------------------------------------
// Session end: Dooo must never hold up sign-out or shutdown.
// ---------------------------------------------------------------------------------------

function prepareForSessionEnd() {
  sessionEnding = true; // let windows close if Windows asks
  flushBounds();
  clearTimeout(sessionEndResetTimer);
  // If another app cancels the shutdown, go back to hide-on-close.
  sessionEndResetTimer = setTimeout(() => {
    sessionEnding = false;
  }, 30_000);
}

function endSession(reason) {
  log(`${reason}: saving and quitting`);
  clearTimeout(sessionEndResetTimer);
  sessionEnding = true;
  isQuitting = true;
  flushBounds();
  app.quit();
}

// ---------------------------------------------------------------------------------------
// Settings side effects and the tray
// ---------------------------------------------------------------------------------------

function applyAlwaysOnTop(on) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (on) mainWindow.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
  else mainWindow.setAlwaysOnTop(false);
}

/**
 * Packaged startup: Windows is the source of truth for "Launch at startup". An existing Dooo
 * login item (possibly turned off or on again in Task Manager or Settings > Apps > Startup)
 * decides the setting, and its exe path is refreshed with the same state; a missing item
 * is registered only when the setting is on. The setting is saved only if it changed.
 * Packaged builds only, never with DOOO_DISABLE_AUTOSTART (see login-item.js).
 */
function syncLoginItemOnStartup() {
  const current = store.getSettings().launchAtLogin === true;
  let result;
  try {
    result = syncLoginItemAtStartup(app, current);
  } catch (err) {
    warn(`could not sync the login item: ${err.message}`);
    return;
  }
  if (result.action !== 'skipped') log(`login item: ${result.action}`);
  if (result.launchAtLogin === current) return;
  try {
    store.updateSettings({ launchAtLogin: result.launchAtLogin });
    log(`launchAtLogin is now ${result.launchAtLogin}, matching Windows`);
  } catch (err) {
    warn(`could not save launchAtLogin: ${err.message}`);
  }
  if (trayController) trayController.refresh();
}

/** Explicit toggle from the UI or the tray: register the login item enabled, or remove it. */
function applyLoginItemToggle(enable) {
  try {
    const result = setLoginItem(app, enable);
    if (result !== 'skipped') log(`login item: ${result}`);
  } catch (err) {
    warn(`could not update the login item: ${err.message}`);
  }
}

/** The single path for settings changes (renderer and tray). Returns the full settings. */
function applySettingsPatch(patch) {
  const { settings, keys } = store.updateSettings(patch);
  if (keys.includes('alwaysOnTop')) applyAlwaysOnTop(settings.alwaysOnTop);
  if (keys.includes('launchAtLogin')) applyLoginItemToggle(settings.launchAtLogin);
  if (trayController) trayController.refresh();
  return settings;
}

function updateSettingsFromTray(patch) {
  try {
    const settings = applySettingsPatch(patch);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(CH.settingsChanged, settings);
    }
  } catch (err) {
    warn(`could not update settings from the tray: ${err.message}`);
    if (trayController) trayController.refresh(); // put the checkbox back
  }
}

function createTrayIcon() {
  trayController = createTray({
    assetsDir: ASSETS_DIR,
    getSettings: () => store.getSettings(),
    onShow: showWindow,
    onToggle: (key, value) => updateSettingsFromTray({ [key]: value }),
    onQuit: quitApp,
  });
  if (trayController.source === 'none') {
    warn('no tray icon asset (src/assets/tray.ico or src/assets/icon.png); the tray icon is blank');
  } else {
    log(`tray icon ready (${trayController.source})`);
  }
}

// ---------------------------------------------------------------------------------------
// IPC behind window.dooo
// ---------------------------------------------------------------------------------------

function isMainWindowSender(event) {
  return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!isMainWindowSender(event)) throw new Error('Refused: unknown sender');
      return fn(...args);
    });
  const listen = (channel, fn) =>
    ipcMain.on(channel, (event, ...args) => {
      if (!isMainWindowSender(event)) return;
      try {
        fn(...args);
      } catch (err) {
        warn(`${channel} failed: ${err.message}`);
      }
    });

  handle(CH.loadState, () => ({
    tasks: store.getTasks(),
    settings: store.getSettings(),
    version: app.getVersion(),
  }));
  handle(CH.saveTasks, (tasks) => {
    store.saveTasks(tasks);
  });
  handle(CH.updateSettings, (patch) => applySettingsPatch(patch));
  handle(CH.windowGetSize, () => {
    const [width, height] = mainWindow.getSize();
    return { width, height };
  });
  listen(CH.windowHide, () => hideWindow());
  listen(CH.windowSetSize, (width, height) => setWindowSize(width, height));
  listen(CH.windowSetIgnoreMouse, (ignore) => setIgnoreMouse(ignore === true));
  listen(CH.quit, () => quitApp());
}
