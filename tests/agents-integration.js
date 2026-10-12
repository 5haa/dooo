'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { _electron } = require('playwright-core');
const { createServer } = require('../src/server/server');
const ROOT = path.resolve(__dirname, '..'), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) { const end = Date.now() + 22000; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw new Error(message); }
(async () => {
  const databaseUrl = process.env.DOOO_TEST_DATABASE_URL;
  assert(databaseUrl && ['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname), 'Use disposable local Postgres');
  const token = randomUUID() + randomUUID(), agentToken = randomUUID() + randomUUID();
  const instance = await createServer({ databaseUrl, token, agentToken });
  const project = { id: 'personal', name: 'Agent integration', folderPath: ROOT, contextText: 'Disposable test project' };
  const task = id => ({ id, projectId: 'personal', title: id, notes: 'Synthetic integration fixture', priority: 'none', due: null, done: false, createdAt: 1, completedAt: null });
  await instance.pool.query('UPDATE dooo_workspace SET data=$1, revision=0 WHERE id=1', [JSON.stringify({ projects: [project], tasks: [task('Verify agent workflow'), task('Concurrent claim')] })]);
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + instance.server.address().port, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-agents-e2e-'));
  const clients = []; let app;
  async function connect(name) {
    const client = new Client({ name, version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src/agents/mcp.js')],
      env: { ...process.env, DOOO_AGENT_URL: url, DOOO_AGENT_TOKEN: agentToken, DOOO_AGENT_CLIENT: name }, stderr: 'pipe' }));
    clients.push(client); return client;
  }
  const invoke = async (client, name, args) => client.callTool({ name, arguments: args || {} });
  function data(result) { assert(!result.isError, result.content?.[0]?.text); return result.structuredContent; }
  try {
    assert.equal((await fetch(url + '/api/state', { headers: { Authorization: 'Bearer ' + agentToken } })).status, 401, 'Agent key cannot access raw workspace writes');
    assert.equal((await fetch(url + '/api/agent', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })).status, 401, 'Sync and agent credentials are separate');
    const codex = await connect('Codex'), claude = await connect('Claude Code');
    assert.equal((await codex.listTools()).tools.length, 8);
    assert((await codex.listPrompts()).prompts.some(p => p.name === 'work_on_task'));
    assert.equal(data(await invoke(codex, 'list_projects')).projects[0].name, project.name);
    assert.equal(data(await invoke(claude, 'get_project', { projectId: 'personal' })).project.contextText, project.contextText);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ aiRewriteEnabled: false }));
    const env = { ...process.env, DOOO_USER_DATA_DIR: dir, DOOO_DISABLE_AUTOSTART: '1', DOOO_DISABLE_PROJECT_DISCOVERY: '1', DOOO_SYNC_URL: url, DOOO_SYNC_TOKEN: token }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ args: ['.'], cwd: ROOT, env });
    await until(() => app.windows().some(p => p.url().endsWith('index.html')), 'Desktop missing');
    const page = app.windows().find(p => p.url().endsWith('index.html')); await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.locator('#project-toggle').click();
    await until(async () => await page.locator('.task-row').count() === 2, 'Cloud tasks did not reach desktop');
    const { runId } = data(await invoke(codex, 'start_task', { taskId: 'Verify agent workflow', summary: 'Exercise the integration fixture' }));
    assert((await invoke(claude, 'start_task', { taskId: 'Verify agent workflow', summary: 'Duplicate work attempt' })).isError);
    assert((await invoke(codex, 'complete_task', { taskId: 'Verify agent workflow', runId, summary: 'Missing evidence' })).isError);
    await until(async () => await page.locator('.agent-status').count() === 1, 'Claim did not reach desktop');
    assert.match(await page.locator('.agent-status').getAttribute('aria-label'), /Working: Codex/);
    const proof = { taskId: 'Verify agent workflow', runId, summary: 'Synthetic report to exercise the proof gate',
      checks: [{ name: 'Protocol fixture', method: 'Synthetic MCP integration check', result: 'Fixture result', outcome: 'failed' }] };
    data(await invoke(codex, 'record_verification', proof));
    assert((await invoke(codex, 'complete_task', { taskId: proof.taskId, runId, summary: 'Must still refuse' })).isError);
    proof.checks[0].outcome = 'passed';
    data(await invoke(codex, 'record_verification', proof));
    data(await invoke(codex, 'complete_task', { taskId: proof.taskId, runId, summary: 'Synthetic integration completed' }));
    assert(data(await invoke(claude, 'get_task', { taskId: proof.taskId })).task.done);
    await until(async () => await page.locator('.is-done').count() === 1, 'Completion did not sync to desktop');
    assert.equal(await page.locator('.task-title').last().textContent(), proof.taskId);
    await page.locator('.agent-status').click();
    assert.match(await page.locator('.agent-details:not([hidden])').textContent(), /Verified by Codex/);
    assert.match(await page.locator('.agent-details:not([hidden])').textContent(), /PASS/);
    fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'test-results/agent-verification.png'), animations: 'disabled' });
    const race = await Promise.all([codex, claude].map(client => invoke(client, 'start_task', { taskId: 'Concurrent claim', summary: 'Concurrent fixture' })));
    assert.equal(race.filter(result => !result.isError).length, 1, 'Exactly one simultaneous claimant wins');
    const winner = race[0].isError ? claude : codex, won = data(race.find(result => !result.isError));
    data(await invoke(winner, 'release_task', { taskId: 'Concurrent claim', runId: won.runId, status: 'blocked', summary: 'Synthetic handoff' }));
    assert.equal(data(await invoke(claude, 'list_tasks', { status: 'blocked' })).total, 1);
    console.log('[agents-e2e] PASS: real stdio clients → authenticated API → PostgreSQL → desktop; claim exclusion, evidence gate, completion, visible proof and handoff');
  } finally {
    if (app) await app.close(); for (const client of clients) await client.close(); await instance.close();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert(path.basename(dir).startsWith('dooo-agents-e2e-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
