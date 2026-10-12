'use strict';
const assert = require('node:assert/strict'), net = require('node:net');
const { randomUUID } = require('node:crypto');
const { Jimp } = require('jimp');
const { createServer } = require('../src/server/server');
const { PCWorker } = require('../apps/worker');
const { MODEL } = require('../src/server/control-api');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(100); } throw new Error(message); }
async function fixture(databaseUrl) {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname), 'Tests require disposable loopback PostgreSQL');
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = 'http://127.0.0.1:' + port, workerToken = 'worker-test-'.repeat(5), agentToken = 'agent-test-'.repeat(5), syncToken = 'sync-test-'.repeat(5), deviceId = randomUUID();
  let calls = 0, executed = [], notifications = [], risk = 'sensitive', predictions;
  const instance = await createServer({ databaseUrl, token: syncToken, agentToken, workerToken, origin, openrouterKey: 'test-only', vapid: { publicKey: 'fake-public', privateKey: 'fake-private' },
    pushImpl: async (_sub, data) => { notifications.push(JSON.parse(data)); },
    modelFetch: async (_url, options) => {
      const input = JSON.parse(options.body); assert(input.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')));
      if (input.model !== MODEL) return { ok: risk !== 'unavailable', json: async () => ({ choices: [{ message: { content: JSON.stringify({ risk, reason: risk === 'sensitive' ? 'Delete the test record' : 'Edit the search field' }) } }] }) };
      const content = predictions ? predictions[calls++] || 'Thought: Done.\nAction: finished()' : ++calls % 2 ? "Thought: Click the test target.\nAction: click(start_box='(500, 500)')" : 'Thought: The test target was clicked.\nAction: finished()';
      return { ok: true, json: async () => ({ id: randomUUID(), model: MODEL, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { total_tokens: 100 } }) };
    }
  });
  await instance.pool.query('TRUNCATE dooo_devices,dooo_runs,dooo_run_events,dooo_approvals,dooo_frames,dooo_pair_codes,dooo_phone_sessions,dooo_push CASCADE');
  const tasks = [{ id: 'fixture-task', projectId: 'personal', title: 'Check the Neuvix test screen', priority: 'none', due: null, done: false, createdAt: 1, completedAt: null }];
  await instance.pool.query('UPDATE dooo_workspace SET data=$1,revision=0 WHERE id=1', [JSON.stringify({ projects: [{ id: 'personal', name: 'Neuvix' }, { id: 'almarkaz', name: 'Almarkaz' }], tasks })]);
  await new Promise(resolve => instance.server.listen(port, '127.0.0.1', resolve));
  const bmp = new Jimp({ width: 1024, height: 640, color: 0xf3f3f3ff });
  for (let y=200;y<410;y++)for(let x=190;x<834;x++)bmp.setPixelColor(0xffffffff,x,y);
  const raw = { base64: (await bmp.getBuffer('image/png')).toString('base64'), scaleFactor: 1 };
  const worker = new PCWorker({ url: origin, token: workerToken, deviceId }, { createOperator: () => ({ screenshot: async () => raw, execute: async params => { executed.push(params.parsedPrediction); } }) });
  let cookie;
  async function request(route, input, { workerAuth = false, noCookie = false, originOverride = origin, method = input === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json', 'X-Dooo-Request': '1', Origin: originOverride,
      ...(workerAuth ? { Authorization: 'Bearer ' + workerToken } : cookie && !noCookie ? { Cookie: cookie } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    let data; try { data = await response.json(); } catch {}
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]; return { status: response.status, data, cookie };
  }
  await worker.start();
  return { ...instance, origin, worker, workerToken, agentToken, syncToken, deviceId, raw, executed, notifications, request,
    pair: async () => { const code = (await request('/api/worker/pair', {}, { workerAuth: true })).data.code; const result = await request('/api/mobile/pair', { code }); assert.equal(result.status, 200); return { code, cookie }; },
    resetModel: () => { calls = 0; },
    setRisk: value => { risk = value; },
    setPredictions: values => { predictions = values; calls = 0; },
    close: async () => { worker.stop(); if (worker.execution) await worker.execution; await instance.close(); }
  };
}
module.exports = { fixture, until, delay };
