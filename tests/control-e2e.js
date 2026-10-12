'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright-core');
const { fixture, until } = require('./control-fixture');
(async () => {
  assert(process.env.DOOO_TEST_DATABASE_URL, 'Use disposable loopback PostgreSQL');
  const f = await fixture(process.env.DOOO_TEST_DATABASE_URL);
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  const artifacts = path.resolve('test-results/phone'); fs.mkdirSync(artifacts, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  async function capture(name) { await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); }); await page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow'); }
  try {
    await page.goto(f.origin); await page.locator('#pair-view').waitFor({ state: 'visible' }); await capture('mobile-pair');
    const pair = await f.request('/api/worker/pair', {}, { workerAuth: true });
    await page.locator('#pair-code').fill(pair.data.code); await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.locator('#workspace').waitFor({ state: 'visible' }); await page.getByRole('button', { name: /Neuvix/ }).click();
    await page.getByRole('textbox', { name: 'Add a task to Neuvix' }).fill('Review the phone integration'); await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
    await page.getByText('Review the phone integration', { exact: true }).waitFor(); await capture('mobile-projects');
    await page.locator('.task').filter({ hasText: 'Review the phone integration' }).getByRole('button', { name: 'Mark task done' }).click();
    await page.locator('.task.done').waitFor(); assert.match(await page.locator('.task').last().innerText(), /Review the phone integration/);
    await page.getByRole('button', { name: 'Run this task on your PC' }).click();
    await page.locator('#approval').waitFor({ state: 'visible', timeout: 25000 }); await page.locator('#pc-screen').waitFor({ state: 'visible' });
    assert.equal(f.executed.length, 0); await capture('mobile-approval');
    await page.setViewportSize({ width: 1280, height: 900 }); await capture('desktop-approval');
    await page.getByRole('button', { name: 'Allow this action' }).click();
    await page.locator('#complete-run').waitFor({ state: 'visible', timeout: 25000 }); assert.equal(f.executed.length, 1);
    await page.locator('#complete-run').click(); await until(async () => (await page.locator('#run-state').innerText()) === 'Task complete', 'Completion not visible');
    await page.locator('#tasks-tab').click(); await capture('desktop-projects');
    await page.setViewportSize({ width: 320, height: 740 }); await capture('small-mobile-projects');
    await page.locator('#settings-button').click(); await capture('small-mobile-settings');
    const manifest = await (await context.request.get(f.origin + '/manifest.webmanifest')).json(); assert.equal(manifest.display, 'standalone');
    await page.evaluate(() => navigator.serviceWorker.ready); assert(await page.evaluate(() => navigator.serviceWorker.getRegistration().then(Boolean)));
    await page.locator('#logout').click(); await page.locator('#pair-view').waitFor({ state: 'visible' });
    assert.equal((await context.request.get(f.origin + '/api/mobile/state')).status(), 401);
    assert.deepEqual(errors, []); console.log('PASS: phone pairing, task creation/completion, SDK request/approval/review, responsive layouts, PWA registration and logout.');
  } finally { await browser.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
