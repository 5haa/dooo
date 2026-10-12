#!/usr/bin/env node
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const { _electron: electron } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'), SHOTS = path.join(ROOT, 'test-results');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-floating-e2e-'));
const errors = [];
let app, first, dock;
const pause = ms => new Promise(r => setTimeout(r, ms));
const read = name => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
async function until(fn, label) { const end = Date.now()+7000; while(Date.now()<end) { const value=await fn(); if(value) return value; await pause(60); } throw new Error(label); }
function track(page) { page.setDefaultTimeout(7000); page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());}); }
async function launch() {
  const env = {...process.env, DOOO_USER_DATA_DIR:dataDir, DOOO_DISABLE_AUTOSTART:'1', DOOO_DISABLE_PROJECT_DISCOVERY:'1'}; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({args:['.'],cwd:ROOT,env});
  app.on('window',track);
  await until(()=>app.windows().length>=2,'project and edge control windows not created');
  for(const page of app.windows()) { track(page); await page.waitForFunction(()=>document.documentElement.dataset.ready==='true'); }
  dock = app.windows().find(p=>p.url().endsWith('dock.html'));
  first = app.windows().find(p=>p.url().endsWith('index.html'));
}
async function native(page, fn, arg) { const h=await app.browserWindow(page); try{return await h.evaluate(fn,arg);}finally{await h.dispose();} }
async function shot(page,name){await page.screenshot({path:path.join(SHOTS,name),animations:'disabled'});}
const row=(page,title)=>page.locator('.task-row').filter({has:page.locator('.task-title',{hasText:title})});
async function add(page,title){await page.locator('#task-input').fill(title);await page.locator('#task-input').press('Enter');}
async function expand(page){if(await page.locator('#project-toggle').getAttribute('aria-expanded')==='false')await page.locator('#project-toggle').click();await until(async()=>await native(page,w=>w.getBounds().height)>280,'project did not expand');await pause(280);}
async function openDock(){await native(dock,w=>w.show());if(await dock.locator('#edge-toggle').getAttribute('aria-expanded')==='false')await dock.locator('#edge-toggle').click();await dock.locator('#dock-menu').waitFor({state:'visible'});await pause(200);}
async function create(name){
  await openDock(); const previous=app.windows().length;
  if(await dock.locator('#new-project-form').isHidden())await dock.locator('#new-project-toggle').click();
  await dock.locator('#new-project-name').fill(name);await dock.locator('#new-project-name').press('Enter');
  await until(()=>app.windows().length>previous,'new project window not created');
  const page=app.windows().find(p=>p!==dock && p!==first && !p.__assigned);
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');page.__assigned=true;
  await expand(page); return page;
}
async function step(name,fn){await fn();console.log('[e2e] ok '+name);}
async function main(){
 fs.mkdirSync(SHOTS,{recursive:true});
 try{
  await launch();
  await step('independent transparent project and persistent screen-edge plus',async()=>{
    assert.equal(await first.locator('#project-name').textContent(),'Tasks');
    assert.equal(await first.locator('#project-toggle').getAttribute('aria-expanded'),'false');
    assert.equal(await native(first,w=>w.getBounds().height),120);
    assert.equal(await first.locator('.project-overview,.header,footer').count(),0);
    assert.equal(await first.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.equal(await dock.locator('#edge-toggle .icon-plus').count(),1);
    const b=await native(dock,w=>w.getBounds());
    const a=await app.evaluate(({screen})=>screen.getPrimaryDisplay().workArea);
    assert.equal(b.x+b.width,a.x+a.width);
    await shot(first,'floating-collapsed-empty.png');
    await shot(dock,'edge-plus.png');
  });
  await step('plus drags freely without opening, anchors its compact icon tray, and snaps to either edge',async()=>{
    const initial=await native(dock,w=>w.getBounds());
    const handle=await dock.locator('#edge-toggle').boundingBox();
    await dock.mouse.move(handle.x+20,handle.y+20);await pause(280);
    const settled=await dock.locator('#edge-toggle').boundingBox();
    await dock.mouse.move(settled.x+20,settled.y+20);await dock.mouse.down();
    await dock.mouse.move(settled.x+20-120,settled.y+20+70,{steps:14});await dock.mouse.up();await pause(250);
    const moved=await native(dock,w=>w.getBounds());
    assert(moved.x<initial.x,'dragging must move the plus away from the edge');
    assert.equal(await dock.locator('#edge-toggle').getAttribute('aria-expanded'),'false','drag must not open controls');
    assert.equal(await dock.locator('body').getAttribute('data-edge'),'floating');
    const before=await dock.evaluate(()=>{const r=document.getElementById('edge-toggle').getBoundingClientRect();return {x:screenX+r.x,y:screenY+r.y};});
    await openDock();
    const after=await dock.evaluate(()=>{const r=document.getElementById('edge-toggle').getBoundingClientRect();return {x:screenX+r.x,y:screenY+r.y};});
    assert.deepEqual(after,before,'opening must not shift the plus');
    assert((await native(dock,w=>w.getBounds())).height<220,'default icon tray must be compact');
    assert.equal(await dock.locator('#dock-menu').innerText(),'','default controls must be icons only');
    assert.equal(await dock.locator('#new-project-form').isVisible(),false);
    assert.equal(await dock.locator('#dock-settings').isVisible(),false);
    assert.equal(await dock.locator('#dock-menu button:not([aria-label])').count(),0);
    await shot(dock,'compact-icon-tray.png');
    await dock.locator('#edge-toggle').click();await pause(240);
    const area=await app.evaluate(({screen})=>screen.getPrimaryDisplay().workArea);
    await dock.evaluate(p=>window.dooo.desktop('move-dock',p),{x:area.x+5,y:area.y+area.height-65,finish:true});
    assert.equal(await dock.locator('body').getAttribute('data-edge'),'left');
    await openDock();await pause(200);
    let b=await native(dock,w=>w.getBounds());
    assert(b.x>=area.x && b.y>=area.y && b.x+b.width<=area.x+area.width && b.y+b.height<=area.y+area.height,'tray must fit on screen near the bottom-left edge');
    await dock.locator('#new-project-toggle').click();await pause(150);
    b=await native(dock,w=>w.getBounds());assert(b.y+b.height<=area.y+area.height);
    await shot(dock,'compact-icon-tray-left.png');
    await dock.keyboard.press('Escape');
    await dock.locator('#edge-toggle').click();await pause(240);
    await dock.evaluate(p=>window.dooo.desktop('move-dock',p),{x:area.x+area.width-50,y:area.y+160,finish:true});
    assert.equal(await dock.locator('body').getAttribute('data-edge'),'right');
    await dock.locator('#edge-toggle').focus();await dock.keyboard.press('ArrowLeft');await pause(100);
    assert.equal(await dock.locator('body').getAttribute('data-edge'),'floating','keyboard arrows must move the plus off an edge');
  });
  await step('header click smoothly expands a task dropdown with bottom entry',async()=>{
    await expand(first);
    assert.equal(await first.locator('#task-dropdown').evaluate(el=>el.inert),false);
    assert.equal(await first.locator('#task-details').isVisible(),false);
    await add(first,'Sketch the homepage');
    await add(first,'Review the first build');
    await add(first,'Send the final files');
    const list=await first.locator('#list').boundingBox(), input=await first.locator('#sheet').boundingBox();
    assert(input.y>=list.y+list.height);
    assert.equal(await first.locator('.task-row').count(),3);
  });
  await step('completion moves to the bottom, preserves focus and restores the original position on undo',async()=>{
    const before=await first.locator('.task-row').evaluateAll(rows=>rows.map(r=>r.dataset.id));
    await row(first,'Review the first build').locator('.task-check').focus();
    await first.keyboard.press('Space');
    assert.equal(await first.locator('.task-row').count(),3);
    assert.deepEqual(await first.locator('.task-row').evaluateAll(rows=>rows.map(r=>r.dataset.id)),[before[0],before[2],before[1]]);
    assert.equal(await row(first,'Review the first build').locator('.task-check').getAttribute('aria-pressed'),'true');
    assert.equal(await row(first,'Review the first build').locator('.task-check').evaluate(el=>el===document.activeElement),true);
    assert.equal(await first.locator('#progress-number').textContent(),'33%');
    assert.equal(await row(first,'Review the first build').evaluate(el=>el.classList.contains('just-completed')),true);
    const undoBox=await first.locator('#toast-undo').boundingBox(),toolbar=await first.locator('.task-toolbar').boundingBox();
    assert(undoBox.y>=toolbar.y && undoBox.y+undoBox.height<=toolbar.y+toolbar.height+1,'undo must stay in the toolbar rather than cover a task');
    await pause(400);
    await shot(first,'floating-expanded.png');
    await first.locator('#toast-undo').click();
    assert.equal(await first.locator('#progress-number').textContent(),'0%');
    assert.deepEqual(await first.locator('.task-row').evaluateAll(rows=>rows.map(r=>r.dataset.id)),before);
    await row(first,'Review the first build').locator('.task-check').click();
    await row(first,'Send the final files').locator('.task-check').click();
    assert.equal(await first.locator('.task-title').last().textContent(),'Send the final files','Newest completion belongs beneath earlier completed tasks');
    await row(first,'Send the final files').locator('.task-check').click();
    await row(first,'Review the first build').locator('.task-check').click();
    assert.deepEqual(await first.locator('.task-row').evaluateAll(rows=>rows.map(r=>r.dataset.id)),before);
    await row(first,'Review the first build').locator('.task-check').click();
  });
  await step('optional details, editing and drafts survive collapse and expansion',async()=>{
    await first.locator('#task-input').fill('Prepare the launch');
    await first.locator('#details-toggle').click();
    await first.locator('#task-priority').selectOption('high');
    await first.locator('#due-date').fill('2027-04-18');
    await first.locator('#due-time').fill('15:30');
    await first.locator('#task-submit').click();
    assert.equal(await first.locator('#task-details').isVisible(),false);
    await first.locator('#task-input').fill('Draft to preserve');
    await row(first,'Prepare the launch').locator('.task-title').click();
    assert.equal(await first.locator('#task-details').isVisible(),false);
    await first.locator('#task-input').fill('Prepare the project launch');
    await first.locator('#task-input').press('Enter');
    assert.equal(await first.locator('#task-input').inputValue(),'Draft to preserve');
    await first.locator('#project-toggle').click();
    await until(async()=>await native(first,w=>w.getBounds().height)===120,'card did not collapse');
    assert.equal(await first.locator('#task-dropdown').evaluate(el=>el.inert),true);
    await expand(first);
    assert.equal(await first.locator('#task-input').inputValue(),'Draft to preserve');
    const t=read('tasks.json').find(t=>t.title==='Prepare the project launch');
    assert.equal(t.priority,'high');assert.equal(t.due,'2027-04-18T15:30');
    await first.locator('#task-input').fill('');
  });
  let second;
  await step('edge plus creates another native project window and scopes concurrent saves',async()=>{
    second=await create('Website for Rune.io');
    assert.equal(await second.locator('#project-name').textContent(),'Website for Rune.io');
    assert.notEqual(await native(first,w=>w.id),await native(second,w=>w.id));
    // Invoke both renderers before either receives the other's snapshot.
    await Promise.all([
      first.evaluate(()=>window.Dooo.store.add({title:'First project concurrent task',priority:'none',due:null})),
      second.evaluate(()=>window.Dooo.store.add({title:'Second project concurrent task',priority:'none',due:null}))
    ]);
    await until(()=>read('tasks.json').some(t=>t.title==='Second project concurrent task'),'concurrent save did not finish');
    assert(read('tasks.json').some(t=>t.title==='First project concurrent task'));
    assert.equal(await second.locator('.task-row').count(),1);
    assert.equal(await first.locator('.task-row').count(),5);
    await add(second,'Design the navigation');
    await add(second,'Review the typography');
    await row(second,'Design the navigation').locator('.task-check').click();
    assert.equal(await second.locator('#progress-number').textContent(),'33%');
    assert.equal(await first.locator('#progress-number').textContent(),'20%');
    await second.locator('#rename-project').click();
    await second.locator('#rename-input').fill('Website launch');
    await second.locator('#rename-input').press('Enter');
    assert.equal(await second.locator('#project-name').textContent(),'Website launch');
    await openDock();
    assert.equal(await dock.getByRole('button',{name:'Show Website launch',exact:true}).count(),1);
    await shot(dock,'edge-controls.png');
    await dock.locator('#edge-toggle').click();
  });
  await step('cards move independently by dragging their header',async()=>{
    const before=await native(second,w=>w.getBounds()), untouched=await native(first,w=>w.getBounds());
    const box=await second.locator('#project-toggle').boundingBox();
    await second.mouse.move(box.x+60,box.y+30);await second.mouse.down();await pause(100);
    await second.mouse.move(box.x+60-90,box.y+30+45,{steps:12});await second.mouse.up();await pause(100);
    const after=await native(second,w=>w.getBounds());
    assert(after.x<before.x,'project header did not move its window');
    assert.deepEqual(await native(first,w=>w.getBounds()),untouched);
    assert.equal(await second.locator('#project-toggle').getAttribute('aria-expanded'),'true','drag must not collapse the card');
  });
  await step('minimize, restore, arrange, collapse and expand work across windows',async()=>{
    await second.locator('#hide-project').click();
    await until(async()=>!(await native(second,w=>w.isVisible())),'project did not minimize');
    await openDock();
    assert.equal(await dock.getByRole('button',{name:'Show Website launch',exact:true}).getAttribute('data-visible'),'false');
    await dock.getByRole('button',{name:'Show Website launch',exact:true}).click();
    await until(async()=>await native(second,w=>w.isVisible()),'project did not restore');
    await openDock();await dock.locator('[data-action="hide-all"]').click();
    await until(async()=>!(await native(first,w=>w.isVisible())) && !(await native(second,w=>w.isVisible())),'minimize all failed');
    assert.equal(await native(dock,w=>w.isVisible()),true);
    await dock.locator('[data-action="show-all"]').click();
    await until(async()=>await native(first,w=>w.isVisible()),'show all failed');
    await dock.locator('[data-action="arrange"]').click();await pause(400);
    assert.equal(await native(first,w=>w.getBounds().height),120);assert.equal(await native(second,w=>w.getBounds().height),120);
    const a=await native(first,w=>w.getBounds()),b=await native(second,w=>w.getBounds());
    assert(a.y+a.height<=b.y || b.y+b.height<=a.y || a.x+a.width<=b.x || b.x+b.width<=a.x);
    await shot(first,'floating-collapsed.png');
    await dock.locator('[data-action="expand-all"]').click();await pause(400);
    assert.equal(await first.locator('#project-toggle').getAttribute('aria-expanded'),'true');
    assert.equal(await second.locator('#project-toggle').getAttribute('aria-expanded'),'true');
    await dock.locator('[data-action="collapse-all"]').click();await pause(350);
    assert.equal(await first.locator('#project-toggle').getAttribute('aria-expanded'),'false');
    await dock.locator('#edge-toggle').click();
  });
  await step('compact resize, keyboard task ordering, deletion and text drop',async()=>{
    await expand(first);
    await first.evaluate(()=>window.dooo.window.setSize(300,360));await pause(250);
    assert.deepEqual(await native(first,w=>w.getSize()),[300,360]);
    await first.locator('#resize-grip').focus();await first.keyboard.press('ArrowRight');
    await until(async()=>(await native(first,w=>w.getSize()))[0]===310,'keyboard resize failed');
    await first.locator('#task-input').fill('A multiline draft\nwith more than one line');
    await shot(first,'floating-compact.png');
    await first.locator('#task-input').fill('');
    const target=row(first,'Sketch the homepage');await target.focus();await first.keyboard.press('Alt+ArrowUp');
    const order=await first.locator('.task-title').allTextContents();assert(order.indexOf('Sketch the homepage')<order.indexOf('Send the final files'));
    await row(first,'First project concurrent task').focus();await first.keyboard.press('Delete');
    assert.equal(await row(first,'First project concurrent task').count(),0);await first.locator('#toast-undo').click();
    await first.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','- Buy milk\n- Call mom');document.body.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));});
    assert.equal(await row(first,'Buy milk').count(),1);
    assert.equal(await first.locator('#panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await openDock();
    await dock.locator('#settings-toggle').click();
    await dock.locator('#always-on-top').click();await until(async()=>await native(first,w=>w.isAlwaysOnTop()),'on top not applied');
    await dock.locator('#always-on-top').click();await dock.locator('#launch-at-login').click();
    await dock.locator('#edge-toggle').click();
  });
  await step('task content, completion, per-project bounds and expansion survive restart',async()=>{
    await pause(700);const before=read('tasks.json'), b=await native(first,w=>w.getBounds()), dockPosition=read('settings.json').dockPosition;
    await app.close();app=null;await launch();
    const tasksPage=await until(async()=>{for(const p of app.windows()){if(p.url().endsWith('index.html') && await p.locator('#project-name').textContent()==='Tasks')return p;}},'Tasks window missing');
    assert.deepEqual(read('tasks.json'),before);
    assert.deepEqual(await native(tasksPage,w=>w.getBounds()),b);
    assert.equal(await tasksPage.locator('#project-toggle').getAttribute('aria-expanded'),'true');
    assert.equal(await row(tasksPage,'Review the first build').locator('.task-check').getAttribute('aria-pressed'),'true');
    assert.equal(read('settings.json').launchAtLogin,false);
    assert.equal(await tasksPage.locator('#task-details').isVisible(),false);
    assert.equal(app.windows().length,3);
    assert.deepEqual(read('settings.json').dockPosition,dockPosition);
    assert.deepEqual((await dock.evaluate(()=>window.dooo.loadState())).dockLayout.anchor,dockPosition);
  });
  assert.deepEqual(errors,[],'renderer errors');
  console.log('[e2e] PASS');
 }catch(err){console.error('[e2e] FAIL',err);console.error('[e2e] errors',errors);console.error('[e2e] data',dataDir);if(first)await shot(first,'floating-failure.png').catch(()=>{});process.exitCode=1;}
 finally{if(app)await app.close();if(!process.exitCode && path.dirname(path.resolve(dataDir))===path.resolve(os.tmpdir()) && path.basename(dataDir).startsWith('dooo-floating-e2e-'))fs.rmSync(dataDir,{recursive:true,force:true});}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
