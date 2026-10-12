'use strict';
const http = require('node:http');
const { createHash, timingSafeEqual } = require('node:crypto');
const { Pool } = require('pg');
const { EMPTY, validateState } = require('../shared/cloud-state');
const { rewriteTask, validInput, MODEL, AIError } = require('./task-ai');
const { handleAgent, AgentError } = require('./agent-api');
const { createControl } = require('./control-api');
const { serveWeb } = require('./web');

async function createServer({ databaseUrl, token, pool: suppliedPool, openrouterKey, model = MODEL, aiFetch, agentToken, workerToken, origin, vapid, pushImpl, modelFetch }) {
  if (!databaseUrl && !suppliedPool) throw new Error('DATABASE_URL is required');
  if (typeof token !== 'string' || token.length < 32) throw new Error('DOOO_SYNC_TOKEN must have at least 32 characters');
  const pool = suppliedPool || new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  pool.on('error', () => console.error('[dooo-api] Database connection interrupted'));
  await pool.query(`CREATE TABLE IF NOT EXISTS dooo_workspace (
    id integer PRIMARY KEY CHECK (id = 1), revision integer NOT NULL DEFAULT 0,
    data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query('INSERT INTO dooo_workspace (id, data) VALUES (1, $1) ON CONFLICT DO NOTHING', [JSON.stringify(EMPTY)]);
  const digest = value => createHash('sha256').update(value).digest();
  const expected = digest('Bearer ' + token);
  if (agentToken && (agentToken.length < 32 || agentToken === token)) throw new Error('Use a separate agent token of at least 32 characters');
  const agentExpected = agentToken ? digest('Bearer ' + agentToken) : null;
  if (workerToken && [token, agentToken].includes(workerToken)) throw new Error('Use a separate worker key');
  const control = await createControl({ pool, workerToken, origin, openrouterKey, safetyModel: model, vapid, pushImpl, modelFetch });
  const attempts = new Map();
  let aiActive = 0, aiRequests = [];
  function reply(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
    res.end(JSON.stringify(body));
  }
  async function readState() {
    const { rows } = await pool.query('SELECT revision, data, updated_at FROM dooo_workspace WHERE id = 1');
    return { revision: rows[0].revision, data: rows[0].data, updatedAt: rows[0].updated_at };
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        await pool.query('SELECT 1'); reply(res, 200, { status: 'ok', database: 'connected' }); return;
      }
      if (control && await control.handle(req, res, url)) return;
      if (serveWeb(req, res, url)) return;
      if (req.method === 'GET' && url.pathname === '/') { reply(res, 200, { service: 'Dooo cloud sync', health: '/health' }); return; }
      const agentRoute = url.pathname === '/api/agent', required = agentRoute ? agentExpected : expected;
      if (!required || !timingSafeEqual(digest(req.headers.authorization || ''), required)) {
        const key = req.socket.remoteAddress, now = Date.now();
        if (attempts.size > 5000) attempts.clear();
        const previous = attempts.get(key), entry = previous && previous.until > now ? previous : { count: 0, until: now + 60000 };
        entry.count++; attempts.set(key, entry);
        reply(res, entry.count > 60 ? 429 : 401, { error: 'Authentication required' }); return;
      }
      if (agentRoute) {
        if (req.method !== 'POST') { reply(res, 405, { error: 'Method not allowed' }); return; }
        if (!(req.headers['content-type'] || '').startsWith('application/json')) { reply(res, 415, { error: 'Expected JSON' }); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 64000) { reply(res, 413, { error: 'Request is too large' }); return; } chunks.push(chunk); }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(res, 400, { error: 'Invalid JSON' }); return; }
        try { reply(res, 200, control && ['computer_status', 'run_computer', 'get_computer_run', 'stop_computer'].includes(input.action) ? await control.agent(input) : await handleAgent(pool, input)); }
        catch (error) { if (error instanceof AgentError || Number.isInteger(error.status)) reply(res, error.status, { error: error.message }); else throw error; }
        return;
      }
      if (url.pathname === '/api/ai/rewrite') {
        if (req.method !== 'POST') { reply(res, 405, { error: 'Method not allowed' }); return; }
        if (!openrouterKey) { reply(res, 503, { error: 'AI unavailable', code: 'not_configured' }); return; }
        if (!(req.headers['content-type'] || '').startsWith('application/json')) { reply(res, 415, { error: 'Expected JSON' }); return; }
        aiRequests = aiRequests.filter(time => Date.now() - time < 60000);
        if (aiActive >= 2 || aiRequests.length >= 30) { reply(res, 429, { error: 'Try again shortly', code: 'rate_limited' }); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 96000) { reply(res, 413, { error: 'Request is too large' }); return; }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        if (!validInput(input)) { reply(res, 400, { error: 'Invalid task' }); return; }
        // Recheck after reading the body so simultaneous requests cannot bypass the cap.
        if (aiActive >= 2 || aiRequests.length >= 30) { reply(res, 429, { error: 'Try again shortly', code: 'rate_limited' }); return; }
        aiActive++; aiRequests.push(Date.now());
        const started = Date.now();
        try {
          const state = await readState();
          reply(res, 200, await rewriteTask({ input, workspace: state.data, key: openrouterKey, model, fetchImpl: aiFetch }));
        } catch (error) {
          const code = error instanceof AIError ? error.code : 'unavailable';
          console.warn('[dooo-ai]', JSON.stringify({ code, providerStatus: error instanceof AIError ? error.providerStatus : undefined, elapsedMs: Date.now() - started }));
          reply(res, 503, { error: 'AI unavailable', code });
        }
        finally { aiActive--; }
        return;
      }
      if (url.pathname !== '/api/state') { reply(res, 404, { error: 'Not found' }); return; }
      if (req.method === 'GET') { reply(res, 200, await readState()); return; }
      if (req.method !== 'PUT') { reply(res, 405, { error: 'Method not allowed' }); return; }
      if (!(req.headers['content-type'] || '').startsWith('application/json')) { reply(res, 415, { error: 'Expected JSON' }); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) { reply(res, 413, { error: 'Request is too large' }); return; }
        chunks.push(chunk);
      }
      let input, data;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error('Invalid revision');
        data = validateState(input.data);
      } catch { reply(res, 400, { error: 'Invalid workspace data' }); return; }
      // A single conditional UPDATE is atomic: concurrent writers never silently replace
      // each other. A stale client receives the latest document and merges before retrying.
      const { rows } = await pool.query(`UPDATE dooo_workspace SET data = $1, revision = revision + 1, updated_at = now()
        WHERE id = 1 AND revision = $2 RETURNING revision, data, updated_at`, [JSON.stringify(data), input.revision]);
      if (!rows.length) { reply(res, 409, await readState()); return; }
      reply(res, 200, { revision: rows[0].revision, data: rows[0].data, updatedAt: rows[0].updated_at });
    } catch {
      console.error('[dooo-api] Request failed');
      if (!res.headersSent) reply(res, 503, { error: 'Service temporarily unavailable' }); else res.destroy();
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, pool, close: async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); } };
}
if (require.main === module) {
  createServer({ databaseUrl: process.env.DATABASE_URL, token: process.env.DOOO_SYNC_TOKEN,
    openrouterKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL || MODEL, agentToken: process.env.DOOO_AGENT_TOKEN,
    workerToken: process.env.DOOO_WORKER_TOKEN, origin: process.env.DOOO_PUBLIC_ORIGIN,
    vapid: process.env.DOOO_VAPID_PRIVATE_KEY ? { publicKey: process.env.DOOO_VAPID_PUBLIC_KEY, privateKey: process.env.DOOO_VAPID_PRIVATE_KEY } : undefined }).then(instance => {
    instance.server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('[dooo-api] Listening'));
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => instance.close().then(() => process.exit(0)));
  }).catch(() => { console.error('[dooo-api] Startup failed; check database and sync token configuration'); process.exitCode = 1; });
}
module.exports = { createServer };
