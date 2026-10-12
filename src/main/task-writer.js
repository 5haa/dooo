'use strict';
class TaskWriter {
  constructor(store, library, config, fetchImpl = fetch) { this.store = store; this.library = library; this.config = config; this.fetch = fetchImpl; this.queued = 0; this.tail = Promise.resolve(); }
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
      const response = await this.fetch(this.config.url + '/api/ai/rewrite', {
        method: 'POST', signal: AbortSignal.timeout(22000),
        headers: { Authorization: 'Bearer ' + this.config.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, text, project: { name: project.name, contextText: project.contextText || '' } })
      });
      if (!response.ok) return { error: 'unavailable' };
      const result = await response.json();
      return typeof result.title === 'string' && result.title.trim() && result.title.length <= 300 ? result : { error: 'unavailable' };
    } catch { return { error: 'unavailable' }; }
  }
}
module.exports = { TaskWriter };
