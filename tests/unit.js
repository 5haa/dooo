#!/usr/bin/env node
'use strict';

/**
 * Unit checks for the Electron-free main-process helpers (plain Node, no test runner).
 *
 *   npm run test:unit
 *
 * Covers src/main/bounds.js (floating-window geometry and scoped data writes) and
 * src/main/login-item.js (with a fake `app`, so the registry is never touched).
 * Exits with 0 on success or 1 on the first failure.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { randomUUID } = require('crypto');

const bounds = require(path.join(__dirname, '..', 'src', 'main', 'bounds.js'));
const loginItem = require(path.join(__dirname, '..', 'src', 'main', 'login-item.js'));

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// ---------------------------------------------------------------------------------------
// bounds.js
// ---------------------------------------------------------------------------------------

const WORK_AREA = { x: 0, y: 0, width: 2560, height: 1392 };
check('floating cards clamp size and stay fully on the matching display', () => {
  assert.deepStrictEqual(bounds.projectBounds({x:3000,y:2000,width:900,height:1600}, WORK_AREA, true), {x:1760,y:16,width:800,height:1376});
  assert.deepStrictEqual(bounds.projectBounds({x:-50,y:-30,width:200,height:200}, WORK_AREA, false), {x:0,y:0,width:300,height:120});
  assert.deepStrictEqual(bounds.projectBounds({x:-4000,y:-500,width:380,height:480}, {x:-1920,y:0,width:1920,height:1040}, true), {x:-1920,y:0,width:380,height:480});
});
check('arranged collapsed cards occupy separate rows and columns', () => {
  const a=bounds.projectPosition(0,WORK_AREA), b=bounds.projectPosition(1,WORK_AREA), c=bounds.projectPosition(10,WORK_AREA);
  assert.strictEqual(b.y-a.y,132); assert.strictEqual(a.x,b.x); assert(c.x<a.x); assert.strictEqual(c.y,a.y);
});
check('dock opening preserves its anchor and flips the tray away from screen edges', () => {
  const area={x:0,y:0,width:1920,height:1040};
  for(const anchor of [{x:1876,y:350},{x:0,y:975},{x:900,y:8}]) {
    const closed=bounds.dockLayout(anchor,area,false), opened=bounds.dockLayout(anchor,area,true,240);
    assert.deepStrictEqual(closed.anchor,opened.anchor);
    assert.strictEqual(closed.bounds.x+closed.buttonLeft,opened.bounds.x+opened.buttonLeft);
    assert.strictEqual(closed.bounds.y+closed.buttonTop,opened.bounds.y+opened.buttonTop);
    assert(opened.bounds.x>=0 && opened.bounds.y>=0 && opened.bounds.x+opened.bounds.width<=1920 && opened.bounds.y+opened.bounds.height<=1040);
  }
  assert.strictEqual(bounds.dockLayout({x:0,y:200},area,true).side,'right');
  assert.strictEqual(bounds.dockLayout({x:1876,y:200},area,true).side,'left');
  const left=bounds.dockLayout({x:-1900,y:300},{x:-1920,y:0,width:1920,height:1040},true);
  assert(left.bounds.x>=-1920 && left.bounds.x+left.bounds.width<=0);
});
const { mergeProjectTasks, normalizeProjects } = require('../src/main/project-data');
check('concurrent project saves preserve other projects, including completed tasks', () => {
  const a={id:'a',projectId:'one',title:'A',done:true}, b={id:'b',projectId:'two',title:'B'};
  let all=mergeProjectTasks([a,b],[{...a,title:'Updated A'}],'one');
  all=mergeProjectTasks(all,[{...b,title:'Updated B'}],'two');
  assert.deepStrictEqual(all.find(t=>t.id==='a'),{...a,title:'Updated A'});
  assert.strictEqual(all.find(t=>t.id==='b').title,'Updated B');
  assert.deepStrictEqual(mergeProjectTasks(all,[],'two'),[{...a,title:'Updated A'}]);
});
check('a project cannot write another project or collide with an existing task id', () => {
  const a={id:'a',projectId:'one'};
  assert.throws(()=>mergeProjectTasks([a],[{id:'a',projectId:'two'}],'two'));
  assert.throws(()=>mergeProjectTasks([a],[{id:'b',projectId:'one'}],'two'));
  assert.throws(()=>mergeProjectTasks([a],[{id:'b',projectId:'two'},{id:'b',projectId:'two'}],'two'));
});
check('main-process migration preserves legacy and orphaned project tasks', () => {
  let tasks=[{id:'old',title:'Existing'},{id:'orphan',title:'Recovered',projectId:'lost'}];
  let settings={projects:[{id:'personal',name:'Personal'}]};
  const projects=normalizeProjects({getTasks:()=>tasks,saveTasks:value=>tasks=value,getSettings:()=>settings,updateSettings:patch=>settings={...settings,...patch}});
  assert.strictEqual(tasks[0].projectId,'personal');assert.strictEqual(tasks[1].projectId,'lost');
  assert.deepStrictEqual(projects,[{id:'personal',name:'Tasks'},{id:'lost',name:'Recovered project'}]);
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

// Project membership must never cause one tab's changes to affect another tab's tasks.
function projectStore(tasks = [], settings = {}) {
  const savedSettings = { ...settings };
  const window = {
    crypto: { randomUUID },
    matchMedia: () => ({ matches: true }),
    dooo: {
      saveTasks: () => Promise.resolve(),
      updateSettings: (patch) => Promise.resolve(JSON.parse(JSON.stringify(Object.assign(savedSettings, patch)))),
    },
  };
  const context = vm.createContext({ window, console });
  for (const file of ['util.js', 'store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js', file), 'utf8'), context);
  }
  const store = window.Dooo.store;
  store.init({ tasks, settings });
  return store;
}
const plain = value => JSON.parse(JSON.stringify(value));

check('legacy tasks retain their content and move into the default tab; missing project settings recover', () => {
  const store = projectStore([
    null,
    { id: 'old', title: 'Existing task', priority: 'high', due: '2027-04-18', done: false },
    { id: 'orphan', projectId: 'lost', title: 'Recovered task', done: false },
  ], { activeProjectId: 'missing' });
  assert.strictEqual(store.activeProjectId, 'personal');
  assert.deepStrictEqual(Array.from(store.open(), t => t.id), ['old']);
  assert.strictEqual(store.get('old').priority, 'high');
  assert.strictEqual(store.get('old').due, '2027-04-18');
  assert(store.projects.some(p => p.id === 'lost'));
  store.selectProject('lost');
  assert.deepStrictEqual(Array.from(store.open(), t => t.id), ['orphan']);
});

check('the old Personal tab label is removed without changing its tasks or selected project', () => {
  const store = projectStore([{ id: 'existing', title: 'Existing', projectId: 'personal' }], {
    projects: [{ id: 'personal', name: 'Personal' }], activeProjectId: 'personal',
  });
  assert.strictEqual(store.projects[0].name, 'Tasks');
  assert.strictEqual(store.activeProjectId, 'personal');
  assert.strictEqual(store.open()[0].id, 'existing');
});

check('project creation, renaming and selection keep stable task membership', () => {
  const store = projectStore();
  const personal = store.add({ title: 'Personal task' }).task;
  const work = store.createProject(' Work ');
  const workTask = store.add({ title: 'Work task' }).task;
  assert.strictEqual(store.activeProjectId, work.id);
  assert.strictEqual(workTask.projectId, work.id);
  assert.deepStrictEqual(Array.from(store.open(), t => t.id), [workTask.id]);
  store.selectProject('personal');
  assert.deepStrictEqual(Array.from(store.open(), t => t.id), [personal.id]);
  assert.strictEqual(store.createProject('work').id, work.id);
  assert.strictEqual(store.projects.length, 2);
  assert.strictEqual(store.renameProject(work.id, 'Launch'), true);
  assert.strictEqual(store.renameProject(work.id, 'Tasks'), false);
  assert.strictEqual(store.createProject('   '), null);
  assert.strictEqual(workTask.projectId, work.id);
});

check('reordering and clearing completed tasks are restricted to the active project', () => {
  const store = projectStore();
  const a = store.add({ title: 'A' }).task;
  const b = store.add({ title: 'B' }).task;
  store.complete(a.id);
  const work = store.createProject('Work');
  const c = store.add({ title: 'C' }).task;
  const d = store.add({ title: 'D' }).task;
  const otherTasks = plain(store.tasks.filter(t => t.projectId === 'personal'));
  store.moveOpen(c.id, 0);
  assert.deepStrictEqual(Array.from(store.open(), t => t.title), ['C', 'D']);
  assert.deepStrictEqual(plain(store.tasks.filter(t => t.projectId === 'personal')), otherTasks);
  store.complete(c.id);
  assert.deepStrictEqual(Array.from(store.done(), t => t.id), [c.id]);
  const cleared = store.clearDone();
  assert.strictEqual(cleared.count, 1);
  assert(store.get(a.id));
  assert.strictEqual(store.get(c.id), null);
  cleared.undo();
  assert.strictEqual(store.get(c.id).projectId, work.id);
  store.restore(c.id);
  assert.deepStrictEqual(Array.from(store.open(), t => t.id), [c.id, d.id]);
  store.selectProject('personal');
  assert.deepStrictEqual(Array.from(store.open(), t => t.id), [b.id]);
  assert.deepStrictEqual(Array.from(store.done(), t => t.id), [a.id]);
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
