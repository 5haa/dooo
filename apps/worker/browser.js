'use strict';
// A separate Chromium target: CDP inputs never call Windows mouse/keyboard APIs.
const { BrowserWindow, session } = require('electron');
const { validateAction } = require('./policy');
const PARTITION = 'persist:dooo-automation';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const webURL = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } };
class BrowserOperator {
  static MANUAL = { ACTION_SPACES: [
    "navigate(content='https://example.com') # Open a URL. This browser has no address bar; use navigate, not Ctrl+L.",
    'navigate_back()', "click(start_box='[x1, y1, x2, y2]')", "left_double(start_box='[x1, y1, x2, y2]')",
    "right_single(start_box='[x1, y1, x2, y2]')", "drag(start_box='[x1, y1, x2, y2]', end_box='[x3, y3, x4, y4]')",
    "type(content='') # A trailing \\n submits with Enter.", "hotkey(key='')", "scroll(start_box='[x1, y1, x2, y2]', direction='down or up')",
    'wait()', 'finished()', 'call_user()'
  ] };
  constructor() { this.clipboard = ''; this.position = { x: 640, y: 400 }; }
  async ready() {
    if (this.initializing) return this.initializing;
    if (this.window && !this.window.isDestroyed()) return;
    this.initializing = this.initialize();
    try { await this.initializing; } catch (error) { this.dispose(); throw error; } finally { this.initializing = null; }
  }
  async initialize() {
    const profile = session.fromPartition(PARTITION);
    profile.setPermissionRequestHandler((_web, _permission, reply) => reply(false));
    profile.setPermissionCheckHandler(() => false);
    // A web page cannot escape into native dialogs, the user's files or external applications.
    this.downloadHandler ||= event => { event.preventDefault(); this.problem = 'Downloads need your help. Open this site yourself to save a file.'; };
    profile.removeListener('will-download', this.downloadHandler); profile.on('will-download', this.downloadHandler);
    const win = this.window = new BrowserWindow({ title: 'Dooo · Automation browser', width: 1280, height: 800, useContentSize: true, show: false,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false } });
    win.setMenu(null); win.on('close', event => { event.preventDefault(); win.hide(); });
    const wc = win.webContents;
    wc.setAudioMuted(true);
    for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) wc.on(event, details => { if (!webURL(details.url)) details.preventDefault(); });
    wc.on('will-attach-webview', event => event.preventDefault());
    wc.setWindowOpenHandler(({ url }) => { if (webURL(url)) void wc.loadURL(url).catch(() => {}); return { action: 'deny' }; });
    await wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="background:#f4f4f4;color:#242424;font:20px Segoe UI;margin:90px"><h1>Dooo browser</h1><p>A separate browser for your requests.</p><p>Ask Dooo to open a website to get started.</p></body></html>'));
    wc.debugger.attach('1.3');
    wc.debugger.on('message', (_event, method, params) => {
      if (method === 'Page.fileChooserOpened') this.problem = 'Choosing local files needs your help in Desktop mode.';
      if (method === 'Page.javascriptDialogOpening') {
        if (params.type !== 'alert') this.problem = 'The site opened a confirmation dialog. Please handle it yourself.';
        void this.send('Page.handleJavaScriptDialog', { accept: params.type === 'alert' }).catch(() => {});
      }
    });
    await this.send('Page.enable'); await this.send('Page.setInterceptFileChooserDialog', { enabled: true });
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  }
  async send(method, params = {}) { return this.window.webContents.debugger.sendCommand(method, params); }
  check() { if (this.problem) { const message = this.problem; this.problem = null; throw new Error(message); } }
  async screenshot() { await this.ready(); this.check(); const shot = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); return { base64: shot.data, scaleFactor: 1 }; }
  async context(action) {
    await this.ready(); const box = action.args.start_box ? JSON.parse(action.args.start_box) : null;
    const point = box ? { x: (box[0] + (box[2] ?? box[0])) / 2 * 1280, y: (box[1] + (box[3] ?? box[1])) / 2 * 800 } : null;
    // Fixed, read-only DOM inspection. Page text stays untrusted classifier evidence.
    return this.window.webContents.executeJavaScript(`(() => {
      const p = ${JSON.stringify(point)};
      let target = p ? document.elementFromPoint(p.x, p.y) : document.activeElement;
      while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
      const actionable = target?.closest('button,a,input,textarea,select,[role="button"],[contenteditable]') || target;
      const editable = !!actionable?.matches('input:not([type=button]):not([type=submit]),textarea,[contenteditable="true"]');
      return { url: location.href.slice(0,2000), title: document.title.slice(0,200), target: (actionable?.getAttribute('aria-label') || actionable?.innerText || actionable?.getAttribute('placeholder') || '').slice(0,350),
        tag: actionable?.tagName, role: actionable?.getAttribute('role'), inputType: actionable?.getAttribute('type'), editable,
        value: editable && actionable?.type !== 'password' ? String(actionable?.value || '').slice(0,2000) : '', href: actionable?.getAttribute('href')?.slice(0,2000) };
    })()`);
  }
  async key(value) {
    const tokens = value.toLowerCase().trim().split(/[+\s]+/), name = tokens.pop();
    const modifiers = (tokens.includes('alt') ? 1 : 0) | (tokens.some(x => ['ctrl','control'].includes(x)) ? 2 : 0) | (tokens.includes('shift') ? 8 : 0);
    if (tokens.some(x => !['alt','ctrl','control','shift'].includes(x))) throw new Error('This shortcut is unavailable in the background browser');
    if (modifiers & 2 && ['c','x','v'].includes(name)) {
      if (name === 'v') { await this.send('Input.insertText', { text: this.clipboard }); return; }
      this.clipboard = await this.window.webContents.executeJavaScript(`(() => {const e=document.activeElement;return e?.type==='password'?'':typeof e?.selectionStart==='number'?e.value.slice(e.selectionStart,e.selectionEnd):String(getSelection());})()`);
      if (name === 'x') await this.key('backspace'); return;
    }
    const keys = { enter:['Enter',13], return:['Enter',13], tab:['Tab',9], escape:['Escape',27], esc:['Escape',27], backspace:['Backspace',8], delete:['Delete',46], del:['Delete',46], space:[' ',32], up:['ArrowUp',38], down:['ArrowDown',40], left:['ArrowLeft',37], right:['ArrowRight',39], arrowup:['ArrowUp',38], arrowdown:['ArrowDown',40], arrowleft:['ArrowLeft',37], arrowright:['ArrowRight',39], home:['Home',36], end:['End',35], pageup:['PageUp',33], pagedown:['PageDown',34] };
    const pair = keys[name] || (/^[a-z0-9]$/.test(name) ? [name, name.toUpperCase().charCodeAt(0)] : null);
    if (!pair || (modifiers & 2 && ['l','n','t','w'].includes(name))) throw new Error('Use navigate() for browser navigation; this shortcut is unavailable');
    const event = { key: pair[0], windowsVirtualKeyCode: pair[1], modifiers };
    await this.send('Input.dispatchKeyEvent', { ...event, type: 'keyDown', ...(!modifiers && pair[0] === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await this.send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
  }
  async execute(params) {
    await this.ready(); this.check(); const action = validateAction(params.parsedPrediction), { type, args } = action;
    const point = key => { const b = JSON.parse(args[key]); return { x: Math.min(1279, Math.round((b[0] + (b[2] ?? b[0])) / 2 * 1280)), y: Math.min(799, Math.round((b[1] + (b[3] ?? b[1])) / 2 * 800)) }; };
    if (type === 'navigate') { await this.window.webContents.loadURL(args.content); }
    else if (type === 'navigate_back') { if (this.window.webContents.navigationHistory.canGoBack()) this.window.webContents.navigationHistory.goBack(); }
    else if (type === 'type') {
      const submit = args.content.endsWith('\n'), content = submit ? args.content.slice(0, -1) : args.content;
      if (content) await this.send('Input.insertText', { text: content }); if (submit) await this.key('enter');
    } else if (type === 'hotkey') await this.key(args.key || args.hotkey);
    else if (type === 'wait') await sleep(1000);
    else if (!action.terminal) {
      const start = args.start_box ? point('start_box') : this.position;
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start }); this.position = start;
      if (type === 'scroll') await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...start, deltaX: 0, deltaY: args.direction === 'up' ? -500 : 500 });
      else if (type === 'drag') {
        const end = point('end_box'); await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 12; i++) await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x+(end.x-start.x)*i/12, y: start.y+(end.y-start.y)*i/12, button: 'left', buttons: 1 });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 }); this.position = end;
      } else if (!['hover','mouse_move'].includes(type)) {
        const button = ['right_click','right_single'].includes(type) ? 'right' : 'left';
        for (let count=1; count<=(['left_double','double_click'].includes(type)?2:1); count++) {
          await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button, clickCount: count });
          await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...start, button, clickCount: count });
        }
      }
    }
    await sleep(150); this.check(); return {};
  }
  async show() { await this.ready(); this.window.show(); }
  hide() { this.window?.hide(); }
  dispose() { this.window?.destroy(); this.window = null; }
}
module.exports = { BrowserOperator, PARTITION };
