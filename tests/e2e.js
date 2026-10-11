#!/usr/bin/env node
'use strict';

/**
 * Dooo end-to-end test: plain Node + playwright-core's Electron driver, no test runner.
 *
 *   npm run test:e2e
 *
 * Launches `electron .` with a fresh temp userData (DOOO_USER_DATA_DIR) and
 * DOOO_DISABLE_AUTOSTART=1, drives the UI through data-testid hooks only, and exits with
 * 0 on success or 1 on failure. Screenshots go to $DOOO_SHOTS_DIR (default: test-results).
 * All input is Playwright's in-page input; the real mouse and keyboard are never used (the
 * click-through watchdog check stubs the cursor position in the main process instead).
 * The app is always closed at the end; nothing else is touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.resolve(ROOT, process.env.DOOO_SHOTS_DIR || 'test-results');
const TIMEOUT = 10_000;

const TITLES = ['Write the weekly report', 'Book the dentist', 'Water the plants']; // added in this order
const PRIORITIES = ['high', 'medium', 'low'];
const DROPPED = ['Buy milk', 'Call mom'];
const ALL_TITLES = [...TITLES, ...DROPPED];
const [T1, T2, T3] = TITLES;
const [MILK, MOM] = DROPPED;

const tid = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let userDataDir = null;
let app = null;
let page = null;
const mainOutput = [];
const pageErrors = [];

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

function log(message) {
  console.log(`[e2e] ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Polls fn until it returns a truthy value; after the timeout throws `message` (a string,
 * or a function evaluated at failure time so it can describe the final state).
 */
async function until(fn, message, timeout = TIMEOUT) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() > deadline) {
      let text = message;
      if (typeof message === 'function') {
        try {
          text = await message();
        } catch (err) {
          text = `condition not met (${err.message})`;
        }
      }
      throw new Error(`${text}${lastError ? ` (last error: ${lastError.message})` : ''}`);
    }
    await sleep(100);
  }
}

function readTasksFile() {
  const file = path.join(userDataDir, 'tasks.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readSettingsFile() {
  return JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
}

/** Waits until tasks.json satisfies `predicate` and returns the array. */
function tasksWhere(predicate, message) {
  return until(() => {
    const tasks = readTasksFile();
    return Array.isArray(tasks) && predicate(tasks) ? tasks : null;
  }, message);
}

/** Titles of the not-done tasks in tasks.json, in array order. */
function openTitlesInFile() {
  return (readTasksFile() || []).filter((t) => !t.done).map((t) => t.title);
}

/** Visible task cards (rendered and inside the viewport), in DOM order: [{ id, text }]. */
async function visibleCards() {
  return page.locator(tid('task-card')).evaluateAll((els) =>
    els
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.left < innerWidth &&
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      })
      .map((el) => ({ id: el.getAttribute('data-id'), text: el.textContent.replace(/\s+/g, ' ').trim() })),
  );
}

/** Titles of the visible cards in DOM order. */
async function visibleTitles() {
  const cards = await visibleCards();
  return cards.map((card) => ALL_TITLES.find((t) => card.text.includes(t)) || `?${card.text.slice(0, 40)}`);
}

/**
 * True when the element is actually on top at its centre (so it can be used). Playwright
 * counts opacity:0 elements as visible, so a closed-but-faded sheet needs this check.
 */
async function isOnTop(locator) {
  return locator
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    })
    .catch(() => false);
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Waits until the visible cards show exactly `expected` (titles, in order). */
function expectCards(expected, what) {
  return until(
    async () => sameList(await visibleTitles(), expected),
    async () => `${what}: cards ${JSON.stringify(await visibleTitles())}, expected ${JSON.stringify(expected)}`,
  );
}

/** Waits until the open tasks in tasks.json are exactly `expected` (titles, in order). */
function expectOpenInFile(expected, what) {
  return until(
    () => sameList(openTitlesInFile(), expected),
    () => `${what}: tasks.json open order ${JSON.stringify(openTitlesInFile())}, expected ${JSON.stringify(expected)}`,
  );
}

async function shot(name) {
  await sleep(250); // let transitions settle
  await page.screenshot({ path: path.join(SHOTS_DIR, name), animations: 'disabled' });
}

function cardById(id) {
  return page.locator(`${tid('task-card')}[data-id="${id}"]`);
}

async function center(locator) {
  const box = await locator.boundingBox();
  assert(box, 'element has no bounding box (not visible?)');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Pointer drag with Playwright's in-page mouse: press, pass the ~5px threshold, glide, release. */
async function drag(from, to, steps = 20) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 8, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps });
  await sleep(150);
  await page.mouse.up();
}

async function browserWindow(fn) {
  const handle = await app.browserWindow(page);
  try {
    return await handle.evaluate(fn);
  } finally {
    await handle.dispose();
  }
}

/** Main-process click-through state (read-only accessor exposed by src/main/main.js). */
function clickThrough() {
  return app.evaluate(() => globalThis.__doooClickThrough);
}

/** Replaces screen.getCursorScreenPoint in the main process; the real cursor is never moved. */
async function stubCursor(point) {
  await app.evaluate(({ screen }, p) => {
    if (!globalThis.__e2eRealCursor) globalThis.__e2eRealCursor = screen.getCursorScreenPoint;
    screen.getCursorScreenPoint = () => ({ x: p.x, y: p.y });
  }, point);
  const echoed = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
  assert(echoed.x === point.x && echoed.y === point.y, 'could not stub screen.getCursorScreenPoint');
}

async function restoreCursor() {
  await app.evaluate(({ screen }) => {
    if (globalThis.__e2eRealCursor) {
      screen.getCursorScreenPoint = globalThis.__e2eRealCursor;
      delete globalThis.__e2eRealCursor;
    }
  });
}

async function launch() {
  app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, DOOO_USER_DATA_DIR: userDataDir, DOOO_DISABLE_AUTOSTART: '1' },
    timeout: 30_000,
  });
  const child = app.process();
  child.stdout.on('data', (d) => mainOutput.push(String(d)));
  child.stderr.on('data', (d) => mainOutput.push(String(d)));
  page = await app.firstWindow();
  page.setDefaultTimeout(TIMEOUT);
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.locator(tid('fab-add')).waitFor({ state: 'visible' });
}

async function closeApp() {
  if (!app) return;
  const current = app;
  app = null;
  page = null;
  await current.close().catch(() => {});
}

// ---------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------

const ids = {}; // title -> task id

const steps = [
  [
    'window.dooo exists',
    async () => {
      const api = await page.evaluate(() => {
        const d = window.dooo;
        return (
          !!d &&
          ['loadState', 'saveTasks', 'updateSettings', 'onSettingsChanged', 'quit'].every((k) => typeof d[k] === 'function') &&
          ['hide', 'getSize', 'setSize', 'setIgnoreMouse'].every((k) => typeof (d.window || {})[k] === 'function')
        );
      });
      assert(api, 'window.dooo or one of its methods is missing');
      await shot('01-empty.png');
    },
  ],
  [
    'add three tasks through the add sheet',
    async () => {
      const input = page.locator(tid('task-input'));
      for (let i = 0; i < TITLES.length; i++) {
        if (!(await isOnTop(input))) await page.click(tid('fab-add'));
        await until(() => isOnTop(input), 'the add sheet did not open');
        await input.fill(TITLES[i]);
        await page.click(tid(`priority-${PRIORITIES[i]}`));
        if (i === TITLES.length - 1) await shot('03-add-sheet.png');
        await page.click(tid('task-submit'));
        await until(async () => (await visibleCards()).length === i + 1, `card ${i + 1} did not appear`);
        // The sheet normally closes after adding; tolerate one that stays open for "add another".
        await until(async () => !(await isOnTop(input)), 'sheet still open', 3000).catch(() => {});
      }
    },
  ],
  [
    'new tasks go on top: cards and tasks.json are newest first',
    async () => {
      const expected = [T3, T2, T1];
      await expectCards(expected, 'after adding');
      const tasks = await tasksWhere((t) => t.length === 3, 'tasks.json does not have 3 entries');
      assert(
        sameList(tasks.map((t) => t.title), expected),
        `tasks.json order ${JSON.stringify(tasks.map((t) => t.title))}, expected ${JSON.stringify(expected)}`,
      );
      tasks.forEach((t) => {
        const expectedPriority = PRIORITIES[TITLES.indexOf(t.title)];
        assert(t.priority === expectedPriority, `"${t.title}" has priority ${t.priority}, expected ${expectedPriority}`);
        assert(t.done === false, `"${t.title}" should not be done`);
        ids[t.title] = t.id;
      });
      const domIds = (await visibleCards()).map((c) => c.id);
      assert(sameList(domIds, tasks.map((t) => t.id)), `card data-ids ${JSON.stringify(domIds)} do not match tasks.json`);
      await shot('02-three-tasks.png');
    },
  ],
  [
    'drag the last card above the first: exact new order',
    async () => {
      const first = await center(cardById(ids[T3]));
      const last = await center(cardById(ids[T1]));
      await drag({ x: last.x, y: last.y }, { x: first.x, y: first.box.y + first.box.height * 0.25 }, 25);
      const expected = [T1, T3, T2];
      await expectCards(expected, 'after the reorder');
      await expectOpenInFile(expected, 'after the reorder');
      assert((readTasksFile() || []).length === 3, 'tasks.json should still hold 3 tasks');
      await shot('04-after-reorder.png');
    },
  ],
  [
    'drag a card onto nav-done completes it',
    async () => {
      const card = await center(cardById(ids[T1]));
      const nav = await center(page.locator(tid('nav-done')));
      await drag({ x: card.x, y: card.y }, { x: nav.x, y: nav.y }, 30);
      await expectCards([T3, T2], 'Home after dragging onto Done');
      await tasksWhere((t) => {
        const task = t.find((x) => x.id === ids[T1]);
        return task && task.done === true && typeof task.completedAt === 'number';
      }, `"${T1}" is not done in tasks.json`);
      await page.click(tid('nav-done'));
      await expectCards([T1], 'Done view');
      await page.click(tid('nav-tasks'));
      await expectCards([T3, T2], 'Home');
    },
  ],
  [
    'task-toggle completes another task',
    async () => {
      await cardById(ids[T2]).locator(tid('task-toggle')).click();
      await tasksWhere((t) => t.find((x) => x.id === ids[T2])?.done === true, `"${T2}" is not done in tasks.json`);
      await expectCards([T3], 'Home after completing with task-toggle');
      await page.click(tid('nav-done'));
      await until(async () => {
        const shown = (await visibleCards()).map((c) => c.id).sort();
        return sameList(shown, [ids[T1], ids[T2]].sort());
      }, 'the Done view does not list exactly the two completed tasks');
      await shot('05-done-view.png');
      await page.click(tid('nav-tasks'));
      await expectCards([T3], 'Home');
    },
  ],
  [
    'lines dropped from another app go on top, in line order',
    async () => {
      await page.evaluate((text) => {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      }, DROPPED.join('\n'));
      const tasks = await tasksWhere(
        (t) => t.length === 5 && DROPPED.every((d) => t.some((x) => x.title === d && x.done === false)),
        'tasks.json does not contain the two dropped tasks',
      );
      DROPPED.forEach((d) => {
        ids[d] = tasks.find((x) => x.title === d).id;
      });
      const expected = [MILK, MOM, T3];
      await expectCards(expected, 'Home after the drop');
      await expectOpenInFile(expected, 'after the drop');
    },
  ],
  [
    'restoring a task from Done puts it on top',
    async () => {
      await page.click(tid('nav-done'));
      await until(async () => (await visibleCards()).some((c) => c.id === ids[T2]), `"${T2}" is not in the Done view`);
      await cardById(ids[T2]).locator(tid('task-toggle')).click();
      await tasksWhere((t) => {
        const task = t.find((x) => x.id === ids[T2]);
        return task && task.done === false && task.completedAt === null;
      }, `"${T2}" was not restored in tasks.json`);
      await expectCards([T1], 'Done view after the restore');
      await page.click(tid('nav-tasks'));
      const expected = [T2, MILK, MOM, T3];
      await expectCards(expected, 'Home after the restore');
      await expectOpenInFile(expected, 'after the restore');
    },
  ],
  [
    'settings: name updates the greeting, keep-on-top toggles the window',
    async () => {
      await page.click(tid('nav-settings'));
      const name = page.locator(tid('setting-name'));
      await name.waitFor({ state: 'visible' });
      await name.fill('Tester');
      await name.press('Tab'); // commit (change/blur)
      await until(
        async () => (await page.locator(tid('greeting')).textContent()).includes('Tester'),
        'the greeting does not contain "Tester"',
      );
      await until(() => readSettingsFile().name === 'Tester', 'settings.json name is not "Tester"');
      await shot('06-settings.png');

      const onTop = () => browserWindow((w) => w.isAlwaysOnTop());
      assert((await onTop()) === false, 'window should not start always-on-top');
      await page.click(tid('setting-ontop'));
      await until(async () => (await onTop()) === true, 'setting-ontop did not make the window always-on-top');
      await until(() => readSettingsFile().alwaysOnTop === true, 'settings.json alwaysOnTop is not true');
      await page.click(tid('setting-ontop'));
      await until(async () => (await onTop()) === false, 'setting-ontop did not turn always-on-top off');
      await until(() => readSettingsFile().alwaysOnTop === false, 'settings.json alwaysOnTop is not false');
      await page.click(tid('nav-tasks'));
    },
  ],
  [
    'click-through watchdog (stubbed cursor, no real input)',
    async () => {
      const b = await browserWindow((w) => w.getBounds());
      const margin = { x: b.x + 5, y: b.y + Math.round(b.height / 2) }; // transparent margin
      const core = { x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) }; // panel's safe core
      const state = () => clickThrough();
      const turnOn = async () => {
        await page.evaluate(() => window.dooo.window.setIgnoreMouse(true));
        await until(async () => {
          const s = await state();
          return s.ignoring && s.watchdog;
        }, 'setIgnoreMouse(true) did not turn click-through and the watchdog on');
      };
      try {
        assert((await state()).ignoring === false, 'click-through should be off before the check');

        // Cursor over the transparent margin: click-through stays on, the watchdog keeps watching.
        await stubCursor(margin);
        await turnOn();
        await sleep(600); // about five watchdog ticks
        let s = await state();
        assert(s.ignoring && s.watchdog, `the watchdog acted while the cursor was over the margin: ${JSON.stringify(s)}`);

        // Cursor in the panel's safe core: the watchdog turns click-through off and stops.
        const resetsBefore = s.resets;
        await stubCursor(core);
        s = await until(async () => {
          const v = await state();
          return v.ignoring === false ? v : null;
        }, 'the watchdog did not turn click-through off with the cursor over the panel', 2000);
        assert(s.watchdog === false, 'the watchdog kept polling after the reset');
        assert(s.resets === resetsBefore + 1, `expected one forced reset, got ${s.resets - resetsBefore}`);

        // Hidden window: polling stops; showing it again ('show') makes it clickable.
        await stubCursor(margin);
        await turnOn();
        await page.evaluate(() => window.dooo.window.hide());
        await until(async () => (await state()).watchdog === false, 'the watchdog kept polling while the window was hidden');
        await browserWindow((w) => w.showInactive());
        await until(async () => (await state()).ignoring === false, "'show' did not turn click-through off");

        // 'focus' makes it clickable too.
        await turnOn();
        await browserWindow((w) => w.emit('focus'));
        await until(async () => (await state()).ignoring === false, "'focus' did not turn click-through off");
        log('   margin: stayed on | core: forced off once | hidden: polling stopped | show, focus: forced off');
      } finally {
        await restoreCursor().catch(() => {});
        await page.evaluate(() => window.dooo.window.setIgnoreMouse(false)).catch(() => {});
      }
    },
  ],
  [
    'dragging resize-grip by (+60, +80) grows the window',
    async () => {
      const size = () => browserWindow((w) => w.getSize());
      const [w0, h0] = await size();
      const grip = await center(page.locator(tid('resize-grip')));
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      await page.mouse.move(grip.x + 60, grip.y + 80, { steps: 15 });
      await sleep(150);
      await page.mouse.up();
      const [w1, h1] = await until(async () => {
        const s = await size();
        return s[0] > w0 && s[1] > h0 ? s : null;
      }, 'the window did not grow');
      log(`   window ${w0}x${h0} -> ${w1}x${h1}`);
    },
  ],
  [
    'close and relaunch: tasks, order and name persist',
    async () => {
      await sleep(600); // let the debounced window-state save land
      const before = readTasksFile();
      const expected = [T2, MILK, MOM, T3];
      await expectCards(expected, 'Home before closing');
      await closeApp();
      await launch();
      assert(JSON.stringify(readTasksFile()) === JSON.stringify(before), 'tasks.json changed across the restart');
      await expectCards(expected, 'Home after relaunch');
      await until(
        async () => (await page.locator(tid('greeting')).textContent()).includes('Tester'),
        'the name did not persist into the greeting',
      );
      await page.click(tid('nav-done'));
      await expectCards([T1], 'Done view after relaunch');
      await page.click(tid('nav-tasks'));
      await expectCards(expected, 'Home');
      await shot('07-relaunch.png');
    },
  ],
];

// ---------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-e2e-'));
  log(`project:     ${ROOT}`);
  log(`userData:    ${userDataDir}`);
  log(`screenshots: ${SHOTS_DIR}`);

  let failed = null;
  const started = Date.now();
  try {
    await launch();
    for (let i = 0; i < steps.length; i++) {
      const [name, run] = steps[i];
      const t0 = Date.now();
      process.stdout.write(`[e2e] ${String(i + 1).padStart(2)}. ${name} ... `);
      try {
        await run();
        console.log(`ok (${Date.now() - t0} ms)`);
      } catch (err) {
        console.log('FAILED');
        failed = { step: i + 1, name, err };
        break;
      }
    }
  } catch (err) {
    failed = failed || { step: 0, name: 'launch', err };
  }

  if (failed && page) {
    await page.screenshot({ path: path.join(SHOTS_DIR, 'failure.png') }).catch(() => {});
  }
  await closeApp();

  if (failed) {
    console.log('');
    log(`FAIL at step ${failed.step} (${failed.name}): ${failed.err && failed.err.message}`);
    if (pageErrors.length) {
      log('renderer errors:');
      [...new Set(pageErrors)].slice(0, 15).forEach((e) => log(`   ${e}`));
    }
    const tail = mainOutput.join('').trim().split(/\r?\n/).slice(-20);
    if (tail.length && tail[0]) {
      log('main process output (tail):');
      tail.forEach((line) => log(`   ${line}`));
    }
    log(`userData kept for inspection: ${userDataDir}`);
    process.exitCode = 1;
    return;
  }

  if (pageErrors.length) {
    log('renderer errors seen during the run (not fatal):');
    [...new Set(pageErrors)].slice(0, 15).forEach((e) => log(`   ${e}`));
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
  log(`PASS: ${steps.length}/${steps.length} steps in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  process.exitCode = 0;
}

main()
  .catch(async (err) => {
    console.error('[e2e] unexpected error:', err);
    await closeApp();
    process.exitCode = 1;
  })
  .finally(() => {
    // Don't let a lingering handle keep the process alive after the app is closed.
    setTimeout(() => process.exit(), 3000).unref();
  });
