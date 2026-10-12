'use strict';
const CODES = new Set(['not_configured', 'provider_auth', 'credits', 'rate_limited', 'timeout', 'invalid_response', 'invalid_request', 'unavailable']);
const RETRY = new Set(['offline', 'timeout', 'rate_limited', 'unavailable']);
class TaskWriter {
  constructor(store, library, config, fetchImpl = fetch, { retryDelay = 650 } = {}) { this.store = store; this.library = library; this.config = config; this.fetch = fetchImpl; this.retryDelay = retryDelay; this.queued = 0; this.tail = Promise.resolve(); }
  rewrite(projectId, text) {
    if (!this.config || !projectId || typeof text !== 'string' || !text.trim() || text.length > 300 || this.queued >= 12) return Promise.resolve({ error: 'unavailable' });
    this.queued++;
    const result = this.tail.then(() => this.request(projectId, text)).finally(() => { this.queued--; });
    this.tail = result.catch(() => {}); return result;
  }
  async request(projectId, text) {
    try {
      const project = this.library ? await this.library.ensure(projectId) : this.store.getSettings().projects.find(p => p.id === projectId);
      if (!project) return { error: 'unavailable' };
      for (let attempt = 0; attempt < 2; attempt++) {
        let error;
        try {
          const response = await this.fetch(this.config.url + '/api/ai/rewrite', {
            method: 'POST', signal: AbortSignal.timeout(22000),
            headers: { Authorization: 'Bearer ' + this.config.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, text, project: { name: project.name, contextText: project.contextText || '' } })
          });
          let result; try { result = await response.json(); } catch {}
          if (response.ok) return result && typeof result.title === 'string' && result.title.trim() && result.title.length <= 300 ? result : { error: 'invalid_response' };
          error = response.status === 401 ? 'connection_auth' : result && CODES.has(result.code) ? result.code :
            response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'unavailable' : 'invalid_request';
        } catch (failure) { error = ['TimeoutError', 'AbortError'].includes(failure.name) ? 'timeout' : 'offline'; }
        if (attempt || !RETRY.has(error)) return { error };
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    } catch { return { error: 'unavailable' }; }
  }
}
module.exports = { TaskWriter };
