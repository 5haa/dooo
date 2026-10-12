'use strict';
// Run with Electron. All inputs target this disposable page, never the user's desktop.
const { app, screen, clipboard } = require('electron');
const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
app.setPath('userData', path.resolve('test-results/browser-profile'));
app.whenReady().then(async () => {
  const deadline = setTimeout(() => { console.error('Browser smoke timed out'); app.exit(1); }, 30000);
  const { BrowserOperator } = require('../apps/worker/browser'); const operator = new BrowserOperator();
  const server = http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{font:20px Arial;margin:40px}input,button{font:20px Arial;margin:12px;padding:14px}</style><h1>Independent browser test</h1><form><input aria-label="Search" id="search"><button>Search</button></form><button id="delete">Delete record</button><p id="result">Waiting</p><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("#result").textContent="Searched: "+document.querySelector("input").value};document.querySelector("#delete").onclick=()=>document.querySelector("#result").textContent="Deleted";</script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const act = (type,args={}) => operator.execute({ parsedPrediction:{ action_type:type, action_inputs:args },screenWidth:1280,screenHeight:800,scaleFactor:1 });
  try {
    const clip=await clipboard.readText();
    console.log('Browser smoke: starting');await operator.ready();assert(!operator.window.isVisible());console.log('Browser smoke: ready');
    await act('navigate',{content:'http://127.0.0.1:'+server.address().port});console.log('Browser smoke: navigated');
    const input=await operator.window.webContents.executeJavaScript('(()=>{const r=document.querySelector("input").getBoundingClientRect();return [(r.x+r.width/2)/1280,(r.y+r.height/2)/800]})()');
    await act('click',{start_box:JSON.stringify(input)});await act('type',{content:'neuvix'});await act('hotkey',{key:'ctrl+a'});await act('type',{content:'Neuvix project\n'});
    assert.equal(await operator.window.webContents.executeJavaScript('document.querySelector("#result").textContent'),'Searched: Neuvix project');
    const bounds=await operator.window.webContents.executeJavaScript('(()=>{const r=document.querySelector("#delete").getBoundingClientRect();return [(r.x+r.width/2)/1280,(r.y+r.height/2)/800]})()');
    const context=await operator.context({args:{start_box:JSON.stringify(bounds)}});assert.equal(context.target,'Delete record');assert(!context.editable);
    const raw=await operator.screenshot();fs.mkdirSync('test-results/browser',{recursive:true});fs.writeFileSync('test-results/browser/independent-browser.png',Buffer.from(raw.base64,'base64'));
    // Sample directly around a CDP move, not across the full test while the user may use their PC.
    const before=screen.getCursorScreenPoint();await operator.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20,y:20});const after=screen.getCursorScreenPoint();
    assert.notDeepEqual(after,{x:20,y:20},'The browser pointer must not become the OS pointer');
    console.log('OS pointer unchanged during CDP move:',JSON.stringify(before)===JSON.stringify(after));
    assert((await clipboard.readText())===clip,'Browser typing must not change the system clipboard');assert(!operator.window.isVisible());
    assert.equal(operator.window.webContents.getLastWebPreferences().sandbox,true);
    assert.equal(await operator.window.webContents.executeJavaScript('typeof require'),'undefined');
    await act('hotkey',{key:'ctrl+l'});await act('type',{content:'http://127.0.0.1:'+server.address().port+'\n'});
    await operator.window.webContents.executeJavaScript('document.querySelector("#search")');assert(operator.window.webContents.getURL().startsWith('http://127.0.0.1:'));
    const {BrowserWindow}=require('electron'),show=BrowserWindow.prototype.show;
    BrowserWindow.prototype.show=function(){};
    try { await operator.show();await operator.manual.webContents.executeJavaScript('localStorage.setItem("login-test","signed-in")');await operator.prepare();assert.equal(await operator.window.webContents.executeJavaScript('localStorage.getItem("login-test")'),'signed-in'); }
    finally { BrowserWindow.prototype.show=show; }
    await assert.rejects(act('navigate',{content:'file:///C:/Windows'}));
    await operator.window.webContents.executeJavaScript('window.open("ms-settings:privacy")');assert(!operator.window.isVisible());
    console.log('PASS: real background Chromium navigation, click, typing, select-all, Enter, screenshots and DOM context; OS pointer/clipboard unchanged; sandboxed with no Node access.');
  } finally { clearTimeout(deadline);operator.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.quit(); }
}).catch(error=>{console.error(error);app.exit(1);});
