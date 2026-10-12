'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ProjectLibrary, buildContext } = require('../src/main/project-library');
const { Store } = require('../src/main/store');
const { normalizeProjects } = require('../src/main/project-data');
const { validateState } = require('../src/shared/cloud-state');
const { rewriteTask, validInput } = require('../src/server/task-ai');
const { TaskWriter } = require('../src/main/task-writer');
const { createServer } = require('../src/server/server');
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-ai-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert(path.basename(dir).startsWith('dooo-ai-')); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
test('discovery chooses exact names, avoids ambiguity and retains cloud metadata without repeated writes', async t => {
  const dir = temporary(t), desktop = path.join(dir, 'desktop');
  write(path.join(desktop, 'projects', 'Neuvix', 'README.md'), '# Neuvix\nVideo generation with Seedance.');
  write(path.join(desktop, 'projects', 'NeuvixUI', 'README.md'), '# Other project');
  write(path.join(desktop, 'work', 'Twin', 'README.md'), 'one'); write(path.join(desktop, 'other', 'Twin', 'README.md'), 'two');
  const store = new Store(path.join(dir, 'data')); store.load();
  store.updateSettings({ projects: [{ id: 'personal', name: 'Neuvix' }, { id: 'twin', name: 'Twin' }] });
  const library = new ProjectLibrary(store, { desktop }); await library.discoverAll();
  const project = store.getSettings().projects[0];
  assert.equal(project.folderPath, path.join(desktop, 'projects', 'Neuvix')); assert.match(project.contextText, /Seedance/);
  assert.equal(store.getSettings().projectFolders.twin.status, 'ambiguous'); assert.equal(store.getSettings().projects[1].folderPath, undefined);
  assert.equal(normalizeProjects(store)[0].contextHash, project.contextHash);
  assert.doesNotThrow(() => validateState({ projects: store.getSettings().projects, tasks: [] }));
  const before = JSON.stringify(store.getSettings().projects); await library.ensure('personal', { force: true });
  assert.equal(JSON.stringify(store.getSettings().projects), before);
});
test('memory excludes credentials, instruction files, dependencies, symlinks and cloud-supplied paths', async t => {
  const dir = temporary(t), desktop = path.join(dir, 'desktop'), repo = path.join(desktop, 'Example');
  write(path.join(repo, 'README.md'), '# Example\nAPI_KEY = super-sensitive-value\nUses Node.js.\n' + 'sk-or-v1-' + 'x'.repeat(40));
  for (const file of ['.env', 'AGENTS.md', 'CLAUDE.md', 'private-key.pem', 'node_modules/a/README.md']) write(path.join(repo, file), 'PRIVATE_CONTENT');
  write(path.join(dir, 'outside', 'README.md'), 'OUTSIDE_CONTENT');
  fs.symlinkSync(path.join(dir, 'outside'), path.join(repo, 'external'), 'junction');
  const context = await buildContext(repo);
  assert.match(context, /Uses Node/); assert(!/super-sensitive|PRIVATE_CONTENT|OUTSIDE_CONTENT|sk-or-v1/.test(context));
  const store = new Store(path.join(dir, 'data')); store.load();
  store.updateSettings({ projects: [{ id: 'personal', name: 'Missing', folderPath: path.join(dir, 'outside') }] });
  await new ProjectLibrary(store, { desktop }).discoverAll();
  assert.equal(store.getSettings().projectFolders.personal.path, null); assert.equal(store.getSettings().projects[0].contextText, undefined);
});
test('AI uses project memory and task context, redacts secrets and rejects invalid responses', async () => {
  const input = { projectId: 'p', text: 'fix seednace uplaod', project: { name: 'Neuvix', contextText: 'Seedance app\npassword: do-not-send' } };
  const workspace = { projects: [], tasks: [{ projectId: 'p', title: 'Check BytePlus assets', notes: 'Existing context', done: false }] };
  let body;
  const output = content => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const result = await rewriteTask({ input, workspace, key: 'test-only', fetchImpl: async (url, request) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); body = JSON.parse(request.body);
    return output('{"title":"Fix Seedance uploads"}');
  } });
  assert.equal(result.title, 'Fix Seedance uploads'); assert.equal(body.model, 'anthropic/claude-haiku-5.5');
  assert.match(body.messages[1].content, /BytePlus/); assert(!body.messages[1].content.includes('do-not-send'));
  assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.temperature, undefined);
  for (const content of ['not json', '{"title":""}', JSON.stringify({ title: 'x'.repeat(301) }), '{"title":"one\\ntwo"}']) {
    await assert.rejects(rewriteTask({ input, workspace, key: 'test-only', fetchImpl: async () => output(content) }));
  }
  assert(!validInput({ ...input, text: 'x'.repeat(301) })); assert(!validInput({ ...input, project: { name: 'n', contextText: 'x'.repeat(18501) } }));
});
test('desktop queues requests, binds project context, authenticates and falls back offline', async () => {
  const store = { getSettings: () => ({ projects: [{ id: 'p', name: 'Example', contextText: 'Documentation' }] }) };
  let active = 0, maximum = 0;
  const writer = new TaskWriter(store, null, { url: 'https://example.com', token: 'test-only' }, async (_url, request) => {
    active++; maximum = Math.max(maximum, active); assert.equal(request.headers.Authorization, 'Bearer test-only'); assert.equal(JSON.parse(request.body).projectId, 'p');
    await new Promise(resolve => setTimeout(resolve, 10)); active--; return { ok: true, json: async () => ({ title: 'Clean title' }) };
  });
  await Promise.all([writer.rewrite('p', 'first'), writer.rewrite('p', 'second')]); assert.equal(maximum, 1);
  writer.fetch = async () => { throw new Error('offline'); }; assert.deepEqual(await writer.rewrite('p', 'keep this'), { error: 'unavailable' });
});
test('AI endpoint authenticates before provider requests and limits input and concurrent requests', async t => {
  let requests = 0, release; const paused = new Promise(resolve => { release = resolve; });
  const pool = { on() {}, end: async () => {}, query: async sql => ({ rows: sql.startsWith('SELECT revision') ? [{ revision: 1, data: { projects: [], tasks: [] } }] : [] }) };
  const token = 'test-token-'.repeat(5);
  const instance = await createServer({ pool, token, openrouterKey: 'test-only', aiFetch: async () => {
    requests++; await paused; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"Clean title"}' } }] }) };
  } });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve)); t.after(() => instance.close());
  const url = 'http://127.0.0.1:' + instance.server.address().port + '/api/ai/rewrite';
  const body = JSON.stringify({ projectId: 'new', text: 'raw', project: { name: 'New', contextText: '' } });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401); assert.equal(requests, 0);
  const options = { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body };
  assert.equal((await fetch(url, { ...options, body: '{}' })).status, 400);
  const first = fetch(url, options), second = fetch(url, options);
  while (requests < 2) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await fetch(url, options)).status, 429); release(); assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});
