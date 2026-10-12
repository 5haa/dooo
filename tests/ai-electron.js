'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { _electron } = require('playwright-core');
const ROOT = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-ai-electron-'));
const data = path.join(dir, 'data'), desktop = path.join(dir, 'desktop'), token = 'test-token-'.repeat(5);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, remote = { revision: 0, data: { projects: [], tasks: [] } }, requests = [], fail = false;
async function until(fn, message) { const end = Date.now() + 20000; while (Date.now() < end) { if (await fn()) return; await pause(50); } throw new Error(message); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function read(name) { return JSON.parse(fs.readFileSync(path.join(data, name), 'utf8')); }
const server = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, 'Bearer ' + token);
  let raw = ''; for await (const chunk of req) raw += chunk;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/ai/rewrite') {
    const input = JSON.parse(raw); requests.push({ input, res });
    if (fail) { res.statusCode = 503; res.end('{"error":"unavailable"}'); }
    return;
  }
  if (req.method === 'PUT') {
    const input = JSON.parse(raw);
    if (input.revision !== remote.revision) res.statusCode = 409;
    else remote = { revision: remote.revision + 1, data: input.data };
  }
  res.end(JSON.stringify(remote));
});
async function launch() {
  const env = { ...process.env, DOOO_USER_DATA_DIR: data, DOOO_PROJECT_ROOT: desktop, DOOO_DISABLE_AUTOSTART: '1', DOOO_SYNC_URL: 'http://127.0.0.1:' + server.address().port, DOOO_SYNC_TOKEN: token };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DOOO_DISABLE_PROJECT_DISCOVERY;
  app = await _electron.launch({ args: ['.'], cwd: ROOT, env });
  await until(() => app.windows().some(p => p.url().endsWith('index.html')), 'No project window');
  const page = app.windows().find(p => p.url().endsWith('index.html'));
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  if (await page.locator('#project-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#project-toggle').click();
  await pause(300); return page;
}
async function add(page, title) { await page.locator('#task-input').fill(title); await page.locator('#task-input').press('Enter'); }
function answer(index, title) { requests[index].res.end(JSON.stringify({ title, model: 'test-haiku' })); }
(async () => {
  write(path.join(data, 'settings.json'), JSON.stringify({ projects: [{ id: 'personal', name: 'Neuvix' }] }));
  write(path.join(desktop, 'projects', 'neuvix', 'README.md'), '# Neuvix\nSeedance and BytePlus video app');
  write(path.join(desktop, 'projects', 'Fresh', 'README.md'), '# Fresh\nA new project');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let page = await launch();
    await until(() => read('settings.json').projects[0].folderPath, 'Folder not discovered');
    await add(page, 'fix seednace uplaod'); await until(() => requests.length === 1, 'No AI request');
    assert.equal(await page.locator('#task-input').inputValue(), '');
    assert.equal(read('tasks.json')[0].title, 'fix seednace uplaod', 'Task must persist before AI finishes');
    assert.match(requests[0].input.project.contextText, /BytePlus/);
    await page.locator('#task-input').fill('An unfinished next task'); answer(0, 'Fix Seedance uploads');
    await page.waitForFunction(() => document.querySelector('.task-title').textContent === 'Fix Seedance uploads');
    assert.equal(await page.locator('#task-input').inputValue(), 'An unfinished next task');
    await page.locator('#toast-undo').click(); assert.equal(await page.locator('.task-title').first().textContent(), 'fix seednace uplaod');
    await add(page, 'rough task two'); await until(() => requests.length === 2, 'Second request missing');
    await page.locator('.task-title').first().click(); await page.locator('#task-input').fill('My manual wording'); await page.locator('#task-input').press('Enter');
    answer(1, 'Late AI wording'); await until(async () => !(await page.locator('.ai-working.visible').count()), 'AI did not finish');
    assert.equal(await page.locator('.task-title').first().textContent(), 'My manual wording');
    await page.locator('#ai-toggle').click(); await page.waitForFunction(() => document.querySelector('#ai-toggle').getAttribute('aria-pressed') === 'false');
    await add(page, 'keep exact wrding'); await pause(150); assert.equal(requests.length, 2);
    await page.locator('#ai-toggle').click(); fail = true;
    await add(page, 'offline original'); await page.locator('#composer-status').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.task-title').first().textContent(), 'offline original');
    await page.evaluate(() => window.dooo.desktop('create', 'Fresh'));
    await until(() => read('settings.json').projects.some(p => p.name === 'Fresh' && p.folderPath), 'New project was not linked automatically');
    await until(() => remote.data.projects.some(p => p.name === 'Fresh' && p.contextText), 'Folder metadata did not reach cloud API');
    await page.locator('#task-input').fill('');
    fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'test-results', 'ai-composer.png'), animations: 'disabled' });
    await page.locator('#task-menu-toggle').click();
    await page.screenshot({ path: path.join(ROOT, 'test-results', 'ai-project-menu.png'), animations: 'disabled' });
    await page.locator('#task-menu-toggle').click();
    const inlineTools = async () => {
      const boxes = await page.evaluate(() => ['task-input', 'details-toggle', 'ai-toggle', 'sheet'].map(id => {
        const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top };
      }));
      assert(boxes[1].left >= boxes[0].right, 'Details belongs to the right of task text');
      assert(boxes[2].left >= boxes[1].right, 'AI belongs beside details');
      assert(Math.abs(boxes[1].top - boxes[0].top) <= 3 && Math.abs(boxes[2].top - boxes[1].top) <= 1, 'Tools must stay on the input row');
      assert(boxes[2].right < boxes[3].right, 'Tools must fit inside the composer');
    };
    await inlineTools();
    await page.evaluate(() => window.dooo.window.setSize(300, 480));
    await page.waitForFunction(() => window.innerWidth === 300);
    await page.locator('#task-input').fill('A longer task that wraps neatly while the controls remain on its right');
    await inlineTools();
    await page.screenshot({ path: path.join(ROOT, 'test-results', 'ai-composer-compact.png'), animations: 'disabled' });
    await app.close(); app = null; page = await launch();
    assert.equal(read('tasks.json').length, 4); assert.equal(read('tasks.json').find(t => t.title === 'fix seednace uplaod').originalText, 'fix seednace uplaod');
    assert.match(read('settings.json').projects[0].contextText, /BytePlus/);
    console.log('[ai-electron] PASS: immediate save, context, rewrite, undo, manual-edit race, toggle, failure fallback, folder discovery, cloud metadata and restart');
  } finally {
    if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert(path.basename(dir).startsWith('dooo-ai-electron-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
