'use strict';
const { _electron }=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {randomUUID}=require('node:crypto');const {fixture,until}=require('./control-fixture');
(async()=>{
  const f=await fixture(process.env.DOOO_TEST_DATABASE_URL);f.worker.stop();await f.pair();f.setRisk('routine');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dooo-browser-worker-'));
  const site=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{font:22px Arial;padding:50px}input,button{font:22px Arial;padding:10px}</style><h1>Background test</h1><form><input id="search" aria-label="Search"><button>Search</button></form><p id="result">Waiting</p><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("#result").textContent="Found: "+document.querySelector("input").value}</script>');});
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  let app;
  try {
    app=await _electron.launch({args:['.'],env:{...process.env,DOOO_USER_DATA_DIR:dir,DOOO_DISABLE_PROJECT_DISCOVERY:'1',DOOO_DISABLE_AUTOSTART:'1',DOOO_DISABLE_PC_WORKER:'1',DOOO_SYNC_URL:f.origin,DOOO_SYNC_TOKEN:f.syncToken}});
    await app.evaluate(async({app},config)=>{const taskRequire=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');const {PCWorker}=taskRequire('./apps/worker');globalThis.testWorker=new PCWorker(config);await globalThis.testWorker.start();},{url:f.origin,token:f.workerToken,deviceId:f.deviceId});
    f.setPredictions([`Action: navigate(content='http://127.0.0.1:${site.address().port}')`,'Action: finished()']);
    const run=await f.request('/api/mobile/run',{requestId:randomUUID(),deviceId:f.deviceId,instruction:'Open the disposable test page',mode:'browser'});assert.equal(run.status,200);
    const detail=await until(async()=>{const d=(await f.request('/api/mobile/run/'+run.data.run.id)).data;return !['queued','running'].includes(d.run.status)&&d;},'Browser worker did not finish',25000);assert.equal(detail.run.status,'review',detail.run.summary);
    await until(()=>app.evaluate(()=>!globalThis.testWorker.current),'First request still finishing');
    const box=await app.evaluate(async()=>globalThis.testWorker.browser.window.webContents.executeJavaScript('(()=>{const r=document.querySelector("input").getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()'));
    f.setPredictions([`Action: click(start_box='(${box.join(',')})')`,"Action: type(content='Neuvix')","Action: hotkey(key='enter')",'Action: finished()']);
    const second=await f.request('/api/mobile/run',{requestId:randomUUID(),deviceId:f.deviceId,instruction:'Search this page for Neuvix',mode:'browser'});
    const done=await until(async()=>{const d=(await f.request('/api/mobile/run/'+second.data.run.id)).data;return !['queued','running'].includes(d.run.status)&&d;},'Search request did not finish',25000);assert.equal(done.run.status,'review',done.run.summary);
    const content=await app.evaluate(()=>globalThis.testWorker.browser.window.webContents.executeJavaScript('document.querySelector("#result").textContent'));assert.equal(content,'Found: Neuvix');assert.equal(done.approval,null);
    assert.equal(await app.evaluate(()=>globalThis.testWorker.browser.window.isVisible()),false);
    await until(()=>app.evaluate(()=>!globalThis.testWorker.current),'Search still finishing');f.setRisk('sensitive');f.setPredictions([`Action: click(start_box='(${box.join(',')})')`]);
    const pending=await f.request('/api/mobile/run',{requestId:randomUUID(),deviceId:f.deviceId,instruction:'Check cancellation on this test page',mode:'browser'});
    await until(async()=>(await f.request('/api/mobile/run/'+pending.data.run.id)).data.approval,'Cancellation approval missing',25000);
    await f.request('/api/mobile/run/'+pending.data.run.id+'/stop',{});await until(()=>app.evaluate(()=>!globalThis.testWorker.current),'Stop did not release browser');
    assert.equal(await app.evaluate(()=>globalThis.testWorker.browser.window),null,'Stop disposes the active target');
    const preview=await f.request('/api/mobile/run',{requestId:randomUUID(),deviceId:f.deviceId,instruction:'[preview]',mode:'browser'});
    await until(async()=>(await f.request('/api/mobile/run/'+preview.data.run.id)).data.run.status==='review','Browser did not recover after Stop',25000);
    console.log('PASS: actual desktop main process → PCWorker → UI-TARS SDK → risk API → background browser navigates, clicks, types and submits with no approvals or visible browser window.');
  } finally { if(app){await app.evaluate(()=>globalThis.testWorker?.stop()).catch(()=>{});await app.close();}site.closeAllConnections();await new Promise(resolve=>site.close(resolve));await f.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
