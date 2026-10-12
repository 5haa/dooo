'use strict';
const { randomUUID } = require('crypto');
function normalizeProjects(store) {
  const settings = store.getSettings(), seen = new Set();
  const projects = (Array.isArray(settings.projects) ? settings.projects : []).filter(p => {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim() || seen.has(p.id)) return false;
    seen.add(p.id); return true;
  }).map(p => ({ id: p.id, name: p.id === 'personal' && p.name === 'Personal' ? 'Tasks' : p.name.trim().slice(0, 48) }));
  if (!seen.has('personal')) { projects.unshift({ id: 'personal', name: 'Tasks' }); seen.add('personal'); }
  const tasks = store.getTasks().filter(t => t && typeof t === 'object').map(t => ({ ...t, projectId: typeof t.projectId === 'string' && t.projectId ? t.projectId : 'personal' }));
  tasks.forEach(t => { if (!seen.has(t.projectId)) { seen.add(t.projectId); projects.push({ id: t.projectId, name: 'Recovered project' }); } });
  if (JSON.stringify(tasks) !== JSON.stringify(store.getTasks())) store.saveTasks(tasks);
  if (JSON.stringify(projects) !== JSON.stringify(settings.projects)) store.updateSettings({ projects });
  return projects;
}
// Each window owns one project's tasks. Never replace another window's data with a stale snapshot.
function mergeProjectTasks(all, incoming, projectId) {
  if (!Array.isArray(incoming)) throw new TypeError('Expected task array');
  const others = all.filter(t => t.projectId !== projectId);
  const ids = new Set(others.map(t => t.id));
  const own = incoming.map(t => {
    if (!t || typeof t.id !== 'string' || !t.id || ids.has(t.id) || t.projectId !== projectId) throw new Error('Invalid project task');
    ids.add(t.id);
    return { ...t, projectId };
  });
  return others.concat(own);
}
function projectName(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 48); }
module.exports = { normalizeProjects, mergeProjectTasks, projectName, randomUUID };
