'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EMPTY, clone, equal, mergeState, validateState } = require('../src/shared/cloud-state');
const { Store } = require('../src/main/store');
const { CloudSync, readCloudConfig } = require('../src/main/cloud-sync');
const { createServer } = require('../src/server/server');
const project = { id: 'personal', name: 'Example project' };
const task = (id, title = id) => ({ id, projectId: 'personal', title, priority: 'none', due: null, done: false, createdAt: 1, completedAt: null });
const state = tasks => ({ projects: [project], tasks });
function cleanup(dir) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert(path.basename(dir).startsWith('dooo-cloud-'));
  fs.rmSync(dir, { recursive: true, force: true });
}

test('three-way merge preserves unrelated edits, metadata and remote deletions', () => {
  const base = state([{ ...task('a'), notes: 'context' }, task('b')]);
  const local = clone(base), remote = clone(base);
  local.tasks[0].title = 'local title'; remote.tasks[0].done = true; remote.tasks[0].completedAt = 2;
  delete remote.tasks[0].notes; remote.tasks.splice(1); remote.tasks.push(task('remote'));
  const result = mergeState(base, local, remote);
  assert.equal(result.tasks[0].title, 'local title'); assert.equal(result.tasks[0].done, true);
  assert.equal(result.tasks[0].notes, undefined); assert(!result.tasks.some(t => t.id === 'b'));
  assert(result.tasks.some(t => t.id === 'remote'));
});
test('local removals, reordering and same-field pending edits survive a stale remote snapshot', () => {
  const base = state([task('a'), task('b'), task('c')]);
  const local = state([{ ...task('c'), title: 'local' }, task('a')]);
  const remote = state([task('remote'), { ...task('c'), title: 'remote' }, task('a'), task('b')]);
  const result = mergeState(base, local, remote);
  assert.deepEqual(result.tasks.map(t => t.id), ['c', 'a', 'remote']);
  assert.equal(result.tasks[0].title, 'local');
});
test('new tasks retain their local insertion position', () => {
  const base = state([task('a')]);
  assert.deepEqual(mergeState(base, state([task('new'), task('a')]), base).tasks.map(t => t.id), ['new', 'a']);
});
test('locally edited tasks remain reachable after remote project deletion', () => {
  const base = state([task('a')]), local = state([{ ...task('a'), title: 'keep this' }]);
  assert.deepEqual(mergeState(base, local, EMPTY), local);
});
test('validation rejects invalid membership, duplicate IDs and unsafe records', () => {
  assert.throws(() => validateState(state([task('a'), task('a')])));
  assert.throws(() => validateState({ projects: [], tasks: [task('a')] }));
  assert.throws(() => validateState(state([{ ...task('a'), notes: { arbitrary: true } }])));
  assert.throws(() => validateState(state([{ ...task('a'), title: 'x'.repeat(301) }])));
  assert.deepEqual(validateState(state([{ ...task('a'), notes: 'Retain my notes' }])), state([{ ...task('a'), notes: 'Retain my notes' }]));
  assert(equal({ a: 1, b: 2 }, { b: 2, a: 1 }), 'Postgres JSONB key order must not cause repeat writes');
});
test('cloud configuration refuses non-HTTPS destinations and encrypts local credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-cloud-config-'));
  try {
    const file = path.join(dir, 'cloud.json'), token = 'a'.repeat(64);
    fs.writeFileSync(file, JSON.stringify({ url: 'http://example.com', token }));
    assert.throws(() => readCloudConfig(dir));
    fs.writeFileSync(file, JSON.stringify({ url: 'https://example.com', token }));
    const storage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('sealed:' + text), decryptString: bytes => bytes.toString().slice(7) };
    assert.equal(readCloudConfig(dir, storage).token, token);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, undefined);
    assert.equal(readCloudConfig(dir, storage).token, token);
  } finally { cleanup(dir); }
});

test('Postgres API and desktop clients: authentication, conflict protection, offline replay and restore', { skip: !process.env.DOOO_TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.DOOO_TEST_DATABASE_URL;
  assert(['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname), 'Integration tests require a disposable local database');
  const token = randomUUID() + randomUUID(), instance = await createServer({ databaseUrl, token });
  await instance.pool.query('UPDATE dooo_workspace SET data = $1, revision = 0 WHERE id = 1', [JSON.stringify(EMPTY)]);
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + instance.server.address().port;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dooo-cloud-integration-')), clients = [];
  const makeStore = name => { const s = new Store(path.join(dir, name)); s.load(); s.updateSettings({ projects: [project] }); return s; };
  const connect = (s, options) => { const c = new CloudSync(s, { url, token }, options); clients.push(c); return c; };
  try {
    assert.equal((await fetch(url + '/health')).status, 200);
    assert.equal((await fetch(url + '/api/state')).status, 401);
    assert.equal((await fetch(url + '/api/state', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(url + '/api/state', { method: 'PUT', headers, body: '{' })).status, 400);
    assert.equal((await fetch(url + '/api/state', { method: 'PUT', headers, body: JSON.stringify({ revision: 0, data: state([task('a'), task('a')]) }) })).status, 400);
    const a = makeStore('a'); a.saveTasks([{ ...task('a'), notes: 'keep this note' }]);
    const ca = connect(a); assert.equal(await ca.sync(), true); assert.equal(ca.status.state, 'synced');
    const first = await (await fetch(url + '/api/state', { headers })).json(); assert.equal(first.data.tasks.length, 1);
    const conflict = await fetch(url + '/api/state', { method: 'PUT', headers, body: JSON.stringify({ revision: 0, data: EMPTY }) });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).data.tasks.length, 1);
    const b = makeStore('b'); b.updateSettings({ projects: [{ id: 'personal', name: 'Tasks' }] });
    const cb = connect(b); await cb.sync(); assert.equal(b.getSettings().projects[0].name, project.name); assert.equal(b.getTasks()[0].notes, 'keep this note');
    a.saveTasks([{ ...a.getTasks()[0], title: 'Edited on A' }]); b.saveTasks([{ ...b.getTasks()[0], done: true, completedAt: 2 }, task('b')]);
    await cb.sync(); await ca.sync(); await cb.sync();
    assert.equal(a.getTasks()[0].done, true); assert.equal(b.getTasks()[0].title, 'Edited on A');
    assert.equal(a.getTasks().length, 2);
    // Keep a pending local edit on disk while disconnected, then restart the client.
    ca.stop(); const offline = connect(a, { fetchImpl: async () => { throw new Error('offline'); } });
    a.saveTasks([...a.getTasks(), task('offline')]); assert.equal(await offline.sync(), false); assert.equal(offline.status.state, 'offline'); offline.stop();
    const recovered = new Store(a.dir); recovered.load(); const restored = connect(recovered); assert.equal(await restored.sync(), true);
    await cb.sync(); assert(b.getTasks().some(t => t.id === 'offline'));
    // A change made during PUT must not be replaced by the response from that PUT.
    restored.stop(); let edited = false;
    recovered.saveTasks([...recovered.getTasks(), task('in-flight')]);
    const inflight = connect(recovered, { fetchImpl: async (endpoint, options) => {
      if (options.method === 'PUT' && !edited) { edited = true; recovered.saveTasks([...recovered.getTasks(), task('during-request')]); }
      return fetch(endpoint, options);
    } });
    await inflight.sync(); assert(recovered.getTasks().some(t => t.id === 'during-request')); await inflight.sync();
    await cb.sync(); assert(b.getTasks().some(t => t.id === 'during-request'));
    recovered.saveTasks(recovered.getTasks().filter(t => t.id !== 'b')); await inflight.sync(); await cb.sync(); assert(!b.getTasks().some(t => t.id === 'b'));
    const before = await (await fetch(url + '/api/state', { headers })).json();
    await inflight.sync(); const after = await (await fetch(url + '/api/state', { headers })).json();
    assert.equal(after.revision, before.revision, 'unchanged state must not create database writes');
    const unauthorized = connect(recovered, { fetchImpl: () => Promise.resolve(new Response('{}', { status: 401 })) });
    assert.equal(await unauthorized.sync(), false); assert.equal(unauthorized.status.state, 'unauthorized');
  } finally { clients.forEach(c => c.stop()); await instance.close(); cleanup(dir); }
});
