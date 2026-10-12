'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyAction, LEASE_MS } = require('../src/server/agent-api');
const { validateState, mergeState, clone } = require('../src/shared/cloud-state');
const session = { id: 'codex-session', client: 'Codex' }, other = { id: 'claude-session', client: 'Claude Code' };
function workspace() { return { projects: [{ id: 'p', name: 'Example', folderPath: 'C:/Projects/example', contextText: 'Project memory' }], tasks: [{ id: 't', projectId: 'p', title: 'Fix the upload', notes: 'Keep this context', done: false, priority: 'none', due: null, createdAt: 1, completedAt: null }] }; }
const call = (data, action, args = {}, owner = session, now = 1000) => applyAction(data, { action, args, session: owner }, now).result;
const plan = { taskId: 't', summary: 'Inspect, fix and verify the upload' };
const proof = { summary: 'Synthetic passing check fixture', checks: [{ name: 'Regression', method: 'test command fixture', result: 'Fixture passed', outcome: 'passed' }] };
test('projects and todos expose folders, full task context and filtered live status without modifying data', () => {
  const data = workspace(), before = clone(data);
  assert.equal(call(data, 'list_projects').projects[0].folderPath, 'C:/Projects/example');
  assert.equal(call(data, 'get_project', { projectId: 'p' }).project.contextText, 'Project memory');
  assert.equal(call(data, 'list_tasks', { projectId: 'p', query: 'upload', status: 'open' }).total, 1);
  assert.equal(call(data, 'get_task', { taskId: 't' }).task.notes, 'Keep this context');
  assert.deepEqual(data, before);
  assert.throws(() => call(data, 'list_tasks', { limit: 1000 }), /pagination/);
  assert.throws(() => call(data, 'list_projects', {}, { client: 'Unknown' }), /session/);
});
test('claims prevent duplicate work, heartbeat extends ownership and abandoned leases can be recovered', () => {
  const data = workspace(), run = call(data, 'start_task', plan);
  assert.equal(call(data, 'start_task', plan).runId, run.runId, 'Retry must reuse the run');
  assert.throws(() => call(data, 'start_task', plan, other), /Another session/);
  assert.throws(() => call(data, 'record_verification', { ...proof, taskId: 't', runId: run.runId }, other), /does not own/);
  call(data, 'heartbeat', { runIds: [run.runId] }, session, 2000);
  assert.equal(data.tasks[0].agentLeaseUntil, 2000 + LEASE_MS);
  const next = call(data, 'start_task', plan, other, 3000 + LEASE_MS);
  assert.notEqual(run.runId, next.runId);
  assert.deepEqual(call(data, 'heartbeat', { runIds: [run.runId] }, session, 4000 + LEASE_MS).runIds, []);
});
test('completion requires owned, passing, current verification and is safe to retry', () => {
  const data = workspace(), { runId } = call(data, 'start_task', plan), args = { taskId: 't', runId, summary: 'Fixed and checked' };
  assert.throws(() => call(data, 'complete_task', args), /requires current/);
  call(data, 'record_verification', { ...args, ...proof, checks: [{ ...proof.checks[0], outcome: 'failed' }] });
  assert.throws(() => call(data, 'complete_task', args), /requires current/);
  call(data, 'record_verification', { ...args, ...proof });
  assert.throws(() => call(data, 'complete_task', args, session, 86402000), /requires current/);
  call(data, 'complete_task', args, session, 2000);
  assert(data.tasks[0].done); assert.equal(data.tasks[0].completedAt, 2000);
  const before = clone(data); call(data, 'complete_task', args, session, 3000); assert.deepEqual(data, before);
  assert.doesNotThrow(() => validateState(data));
});
test('changed task details invalidate verification; blocked work stays open and preserves a handoff', () => {
  const data = workspace(), { runId } = call(data, 'start_task', plan), args = { taskId: 't', runId, summary: 'Result' };
  call(data, 'record_verification', { ...args, ...proof }); data.tasks[0].title = 'Different requested work';
  assert.throws(() => call(data, 'complete_task', args), /details changed/);
  assert.throws(() => call(data, 'record_verification', { ...args, ...proof }), /details changed/);
  call(data, 'release_task', { ...args, status: 'blocked', summary: 'Need the user to choose the new behavior' });
  assert.equal(data.tasks[0].done, false); assert.equal(call(data, 'get_task', { taskId: 't' }).status, 'blocked');
  const next = call(data, 'start_task', plan, other); assert.notEqual(next.runId, runId);
  assert.equal(data.tasks[0].agentVerification, null);
});
test('reported evidence is bounded, redacted, and survives offline desktop merges', () => {
  const base = workspace(), remote = clone(base), { runId } = call(remote, 'start_task', plan);
  assert.throws(() => call(remote, 'record_verification', { taskId: 't', runId, summary: 'No tests', checks: [] }), /actual verification/);
  call(remote, 'record_verification', { taskId: 't', runId, ...proof, checks: [{ ...proof.checks[0], result: 'Passed\nAPI_KEY = private-value' }] });
  assert(!remote.tasks[0].agentVerification.includes('private-value'));
  call(remote, 'complete_task', { taskId: 't', runId, summary: 'Complete' });
  const local = clone(base); local.tasks.push({ ...base.tasks[0], id: 'other', title: 'Offline addition' });
  const merged = mergeState(base, local, remote);
  assert.equal(merged.tasks.length, 2); assert(merged.tasks.find(t => t.id === 't').done);
  assert(merged.tasks.find(t => t.id === 't').agentVerification);
});
