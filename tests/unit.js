#!/usr/bin/env node
'use strict';

/**
 * Unit checks for the Electron-free main-process helpers (plain Node, no test runner).
 *
 *   npm run test:unit
 *
 * Covers src/main/bounds.js (window geometry, including the click-through safe core) and
 * src/main/login-item.js (with a fake `app`, so the registry is never touched).
 * Exits with 0 on success or 1 on the first failure.
 */

const assert = require('assert');
const path = require('path');

const bounds = require(path.join(__dirname, '..', 'src', 'main', 'bounds.js'));
const loginItem = require(path.join(__dirname, '..', 'src', 'main', 'login-item.js'));

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// ---------------------------------------------------------------------------------------
// bounds.js
// ---------------------------------------------------------------------------------------

const WORK_AREA = { x: 0, y: 0, width: 2560, height: 1392 };
const WIN = { x: 100, y: 50, width: 420, height: 680 };

check('clampSize rounds and clamps to 360x480 .. 760 x work-area height', () => {
  assert.deepStrictEqual(bounds.clampSize(500.6, 700.2, WORK_AREA), { width: 501, height: 700 });
  assert.deepStrictEqual(bounds.clampSize(10, 10, WORK_AREA), { width: 360, height: 480 });
  assert.deepStrictEqual(bounds.clampSize(5000, 99999, WORK_AREA), { width: 760, height: 1392 });
  // a work area shorter than the minimum never pushes the height below 480
  assert.deepStrictEqual(bounds.clampSize(400, 900, { x: 0, y: 0, width: 800, height: 400 }), { width: 400, height: 480 });
});

check('defaultBounds: top-right of the work area with a 24px margin', () => {
  assert.deepStrictEqual(bounds.defaultBounds(WORK_AREA), { x: 2560 - 420 - 24, y: 24, width: 420, height: 680 });
  // second display to the left of the primary, with a short work area
  assert.deepStrictEqual(bounds.defaultBounds({ x: -1920, y: 0, width: 1920, height: 700 }), {
    x: -1920 + 1920 - 420 - 24,
    y: 24,
    width: 420,
    height: 700 - 48,
  });
});

check('isReachable needs the drag strip on a work area', () => {
  assert.strictEqual(bounds.isReachable(WIN, [WORK_AREA]), true);
  assert.strictEqual(bounds.isReachable({ ...WIN, x: -30000, y: -30000 }, [WORK_AREA]), false);
  // body on-screen but the top strip (drag area) above the screen: not reachable
  assert.strictEqual(bounds.isReachable({ ...WIN, y: -100 }, [WORK_AREA]), false);
  // window on a second display
  assert.strictEqual(bounds.isReachable({ ...WIN, x: -1500 }, [WORK_AREA, { x: -1920, y: 0, width: 1920, height: 1040 }]), true);
});

check('sameBounds', () => {
  assert.strictEqual(bounds.sameBounds(WIN, { ...WIN }), true);
  assert.strictEqual(bounds.sameBounds(WIN, { ...WIN, width: 421 }), false);
  assert.strictEqual(bounds.sameBounds(WIN, null), false);
});

check('safeCore is the window inset by 14 + 24 px on every side', () => {
  assert.strictEqual(bounds.PANEL_INSET + bounds.SAFE_CORE_MARGIN, 38);
  assert.deepStrictEqual(bounds.safeCore(WIN), { x: 138, y: 88, width: 344, height: 604 });
  assert.deepStrictEqual(bounds.safeCore({ x: 0, y: 0, width: 60, height: 60 }), { x: 38, y: 38, width: 0, height: 0 });
});

check('isInSafeCore: inside the core', () => {
  const center = { x: WIN.x + WIN.width / 2, y: WIN.y + WIN.height / 2 };
  assert.strictEqual(bounds.isInSafeCore(center, WIN), true);
  assert.strictEqual(bounds.isInSafeCore({ x: 138, y: 88 }, WIN), true); // top-left corner of the core
  assert.strictEqual(bounds.isInSafeCore({ x: 481, y: 691 }, WIN), true); // last pixel of the core
});

check('isInSafeCore: core edges are exclusive on the far side', () => {
  assert.strictEqual(bounds.isInSafeCore({ x: 137, y: 300 }, WIN), false);
  assert.strictEqual(bounds.isInSafeCore({ x: 300, y: 87 }, WIN), false);
  assert.strictEqual(bounds.isInSafeCore({ x: 482, y: 300 }, WIN), false);
  assert.strictEqual(bounds.isInSafeCore({ x: 300, y: 692 }, WIN), false);
});

check('isInSafeCore: transparent margin, rounded corners, hide badge and grip are outside', () => {
  const right = WIN.x + WIN.width;
  const bottom = WIN.y + WIN.height;
  for (const p of [
    { x: WIN.x + 5, y: WIN.y + 300 }, // left transparent margin
    { x: WIN.x + 16, y: WIN.y + 16 }, // panel's rounded top-left corner
    { x: right - 20, y: WIN.y + 20 }, // corner hide badge
    { x: right - 20, y: bottom - 20 }, // resize grip
    { x: WIN.x + 200, y: bottom - 30 }, // bottom edge band of the panel
  ]) {
    assert.strictEqual(bounds.isInSafeCore(p, WIN), false, JSON.stringify(p));
  }
});

check('isInSafeCore: outside the window, bad input, negative coordinates', () => {
  assert.strictEqual(bounds.isInSafeCore({ x: 5, y: 5 }, WIN), false);
  assert.strictEqual(bounds.isInSafeCore({ x: NaN, y: 300 }, WIN), false);
  assert.strictEqual(bounds.isInSafeCore(null, WIN), false);
  assert.strictEqual(bounds.isInSafeCore({ x: 300, y: 300 }, null), false);
  assert.strictEqual(bounds.isInSafeCore({ x: 30, y: 30 }, { x: 0, y: 0, width: 60, height: 60 }), false); // empty core
  const left = { x: -1800, y: 100, width: 420, height: 680 }; // display left of the primary
  assert.strictEqual(bounds.isInSafeCore({ x: -1590, y: 440 }, left), true);
  assert.strictEqual(bounds.isInSafeCore({ x: -1790, y: 440 }, left), false);
});

// ---------------------------------------------------------------------------------------
// login-item.js (fake app: no registry access)
// ---------------------------------------------------------------------------------------

const EXE = 'C:\\Users\\someone\\AppData\\Local\\Programs\\Dooo\\Dooo.exe';
const ITEM = { name: 'Dooo', path: EXE, args: ['--autostart'] };

function fakeApp({ isPackaged = true, launchItems = [] } = {}) {
  const calls = [];
  return {
    isPackaged,
    calls,
    getLoginItemSettings: (options) => {
      calls.push(['get', options]);
      return { openAtLogin: false, launchItems };
    },
    setLoginItemSettings: (settings) => {
      calls.push(['set', settings]);
    },
  };
}

const GET = ['get', { path: EXE, args: ['--autostart'] }];
const startup = (app, settingOn, env = {}) => loginItem.syncLoginItemAtStartup(app, settingOn, { env, execPath: EXE });
const userItem = (enabled) => ({ ...ITEM, scope: 'user', enabled });

check('login item at startup: unpackaged runs touch nothing', () => {
  for (const settingOn of [true, false]) {
    const app = fakeApp({ isPackaged: false, launchItems: [userItem(false)] });
    assert.deepStrictEqual(startup(app, settingOn), { launchAtLogin: settingOn, action: 'skipped' });
    assert.deepStrictEqual(app.calls, []);
  }
});

check('login item at startup: DOOO_DISABLE_AUTOSTART touches nothing', () => {
  for (const value of ['1', 'true', 'yes', 'TRUE']) {
    const app = fakeApp({ launchItems: [userItem(false)] });
    assert.deepStrictEqual(startup(app, true, { DOOO_DISABLE_AUTOSTART: value }), { launchAtLogin: true, action: 'skipped' });
    assert.deepStrictEqual(app.calls, []);
  }
  assert.strictEqual(loginItem.loginItemsAllowed(fakeApp(), { DOOO_DISABLE_AUTOSTART: '0' }), true);
});

check('login item at startup: item disabled in Windows -> setting false, stays registered-disabled', () => {
  const app = fakeApp({ launchItems: [userItem(false)] });
  assert.deepStrictEqual(startup(app, true), { launchAtLogin: false, action: 'refreshed (kept disabled)' });
  assert.deepStrictEqual(app.calls, [GET, ['set', { ...ITEM, openAtLogin: true, enabled: false }]]);
  // a later start with the synced setting keeps it that way
  const again = fakeApp({ launchItems: [userItem(false)] });
  assert.deepStrictEqual(startup(again, false), { launchAtLogin: false, action: 'refreshed (kept disabled)' });
  assert.deepStrictEqual(again.calls, [GET, ['set', { ...ITEM, openAtLogin: true, enabled: false }]]);
});

check('login item at startup: item re-enabled in Windows while the setting is false -> setting true', () => {
  const app = fakeApp({ launchItems: [userItem(true)] });
  assert.deepStrictEqual(startup(app, false), { launchAtLogin: true, action: 'refreshed (enabled)' });
  assert.deepStrictEqual(app.calls, [GET, ['set', { ...ITEM, openAtLogin: true, enabled: true }]]);
});

check('login item at startup: item enabled and setting true -> path refreshed, setting unchanged', () => {
  const app = fakeApp({ launchItems: [userItem(true)] });
  assert.deepStrictEqual(startup(app, true), { launchAtLogin: true, action: 'refreshed (enabled)' });
  assert.deepStrictEqual(app.calls, [GET, ['set', { ...ITEM, openAtLogin: true, enabled: true }]]);
});

check('login item at startup: no item and setting true (first run) -> registered', () => {
  const app = fakeApp();
  assert.deepStrictEqual(startup(app, true), { launchAtLogin: true, action: 'registered' });
  assert.deepStrictEqual(app.calls, [GET, ['set', { ...ITEM, openAtLogin: true, enabled: true }]]);
});

check('login item at startup: no item and setting false -> nothing written', () => {
  const app = fakeApp();
  assert.deepStrictEqual(startup(app, false), { launchAtLogin: false, action: 'none' });
  assert.deepStrictEqual(app.calls, [GET]);
});

check("login item at startup: other names and machine-wide entries are not Dooo's item", () => {
  const app = fakeApp({
    launchItems: [
      { name: 'Something', path: EXE, args: [], scope: 'user', enabled: false },
      { ...ITEM, scope: 'machine', enabled: false },
    ],
  });
  assert.deepStrictEqual(startup(app, false), { launchAtLogin: false, action: 'none' });
  assert.deepStrictEqual(app.calls, [GET]);
});

check('login item toggle: on registers it enabled, off removes it (no lookup)', () => {
  const on = fakeApp({ launchItems: [userItem(false)] });
  assert.strictEqual(loginItem.setLoginItem(on, true, { env: {}, execPath: EXE }), 'registered');
  assert.deepStrictEqual(on.calls, [['set', { ...ITEM, openAtLogin: true, enabled: true }]]);
  const off = fakeApp({ launchItems: [userItem(true)] });
  assert.strictEqual(loginItem.setLoginItem(off, false, { env: {}, execPath: EXE }), 'removed');
  assert.deepStrictEqual(off.calls, [['set', { ...ITEM, openAtLogin: false }]]);
});

check('login item toggle: unpackaged or DOOO_DISABLE_AUTOSTART touches nothing', () => {
  const dev = fakeApp({ isPackaged: false });
  assert.strictEqual(loginItem.setLoginItem(dev, true, { env: {}, execPath: EXE }), 'skipped');
  const disabled = fakeApp();
  assert.strictEqual(loginItem.setLoginItem(disabled, false, { env: { DOOO_DISABLE_AUTOSTART: '1' }, execPath: EXE }), 'skipped');
  assert.deepStrictEqual([...dev.calls, ...disabled.calls], []);
});

// ---------------------------------------------------------------------------------------

let failed = 0;
for (const [name, fn] of checks) {
  try {
    fn();
    console.log(`[unit] ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`[unit] FAIL  ${name}\n        ${String(err.message).split('\n').join('\n        ')}`);
  }
}
console.log(failed ? `[unit] ${failed} of ${checks.length} checks failed` : `[unit] PASS: ${checks.length}/${checks.length} checks`);
process.exitCode = failed ? 1 : 0;
