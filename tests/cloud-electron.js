'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { _electron } = require('playwright-core');
const { createServer } = require('../src/server/server');
const { EMPTY } = require('../src/shared/cloud-state');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { if (await fn()) return; await pause(150); }
  throw new Error(message);
}
(async () => {
  const databaseUrl = process.env.DOOO_TEST_DATABASE_URL;
  assert(databaseUrl && ['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname), 'Use a disposable local Postgres database');
  const token = randomUUID() + randomUUID(), instance = await createServer({ databaseUrl, token });
  await instance.pool.query('UPDATE dooo_workspace SET data=$1, revision=0 WHERE id=1', [JSON.stringify(EMPTY)]);
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + instance.server.address().port;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const read = async () => (await fetch(url + '/api/state', { headers })).json();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-cloud-electron-'));
  const errors = []; let app;
  async function launch() {
    const env = { ...process.env, DOOO_USER_DATA_DIR: dataDir, DOOO_DISABLE_AUTOSTART: '1', DOOO_DISABLE_PROJECT_DISCOVERY: '1', DOOO_SYNC_URL: url, DOOO_SYNC_TOKEN: token };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ args: ['.'], cwd: path.resolve(__dirname, '..'), env });
    app.on('window', page => page.on('pageerror', e => errors.push(e.message)));
    // Restored project windows can finish loading in either order.
    let page;
    await until(async () => {
      for (const candidate of app.windows().filter(p => p.url().endsWith('index.html'))) {
        if (await candidate.evaluate(() => document.getElementById('project-name')?.textContent) === 'Tasks') {
          page = candidate; return true;
        }
      }
      return false;
    }, 'Original project window missing');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    return page;
  }
  try {
    let page = await launch();
    await page.locator('#project-toggle').click(); await pause(300);
    await page.locator('#task-input').fill('Created on the desktop'); await page.locator('#task-input').press('Enter');
    await until(async () => (await read()).data.tasks.length === 1, 'Desktop task was not saved to PostgreSQL');
    await page.locator('#task-input').fill('Keep this unfinished draft');
    const remote = await read(); remote.data.tasks[0].done = true; remote.data.tasks[0].completedAt = Date.now();
    remote.data.projects.push({ id: 'remote-project', name: 'Remote project' });
    const response = await fetch(url + '/api/state', { method: 'PUT', headers, body: JSON.stringify(remote) });
    assert.equal(response.status, 200);
    await until(async () => await page.locator('.task-check').getAttribute('aria-pressed') === 'true', 'Cloud completion did not reach the open card');
    assert.equal(await page.locator('#task-input').inputValue(), 'Keep this unfinished draft');
    await until(() => app.windows().length === 3, 'Cloud project did not create its floating window');
    await app.close(); app = null; page = await launch();
    assert.equal(await page.locator('.task-check').getAttribute('aria-pressed'), 'true');
    await until(() => app.windows().length === 3, 'Cloud project did not persist across restart');
    assert.deepEqual(errors, []);
    console.log('[cloud-electron] PASS: desktop → API → Postgres, remote updates, preserved drafts and restart');
  } finally {
    if (app) await app.close(); await instance.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert(path.basename(dataDir).startsWith('dooo-cloud-electron-'));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
