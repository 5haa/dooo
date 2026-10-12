'use strict';

const EMPTY = { projects: [], tasks: [] };
const clone = value => JSON.parse(JSON.stringify(value));
const equal = require('node:util').isDeepStrictEqual;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function validateState(value) {
  if (!plain(value) || !Array.isArray(value.projects) || !Array.isArray(value.tasks)) throw new Error('Expected projects and tasks');
  if (value.projects.length > 200 || value.tasks.length > 10000) throw new Error('Workspace limit exceeded');
  const projects = new Set(), tasks = new Set();
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
  for (const p of value.projects) {
    if (!plain(p) || !id(p.id) || projects.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 48) throw new Error('Invalid project');
    projects.add(p.id);
  }
  for (const t of value.tasks) {
    if (!plain(t) || !id(t.id) || tasks.has(t.id) || !projects.has(t.projectId) ||
        typeof t.title !== 'string' || !t.title.trim() || t.title.length > 300 ||
        !['none', 'low', 'medium', 'high'].includes(t.priority) || typeof t.done !== 'boolean' ||
        !Number.isFinite(t.createdAt) || !(t.completedAt === null || Number.isFinite(t.completedAt)) ||
        !(t.due === null || (typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(t.due)))) throw new Error('Invalid task');
    tasks.add(t.id);
  }
  // Unknown scalar task fields (notes, review context) survive synchronization.
  for (const record of [...value.projects, ...value.tasks]) {
    for (const [key, item] of Object.entries(record)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) ||
          (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) ||
          (typeof item === 'string' && item.length > 50000)) throw new Error('Invalid record field');
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw new Error('Workspace is too large');
  return clone(value);
}

// Apply only fields changed locally since the last acknowledged snapshot. Unrelated remote
// edits survive. If the same field changed on both devices, this device's pending edit wins.
function mergeRecords(base, local, remote) {
  const baseMap = new Map(base.map(x => [x.id, x])), localMap = new Map(local.map(x => [x.id, x]));
  const merged = new Map(remote.map(x => [x.id, clone(x)]));
  for (const old of base) if (!localMap.has(old.id)) merged.delete(old.id);
  for (const item of local) {
    const old = baseMap.get(item.id);
    if (equal(old, item)) continue;
    const next = merged.get(item.id) || clone(item);
    for (const key of new Set([...Object.keys(old || {}), ...Object.keys(item)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      if (!equal(old && old[key], item[key])) {
        if (item[key] === undefined) delete next[key]; else next[key] = clone(item[key]);
      }
    }
    // A locally edited record deleted remotely is restored with its complete content.
    merged.set(item.id, next);
  }
  const oldOrder = base.filter(x => localMap.has(x.id)).map(x => x.id);
  const localOrder = local.filter(x => baseMap.has(x.id)).map(x => x.id);
  const order = !equal(oldOrder, localOrder) || local.some(x => !baseMap.has(x.id)) ? local : remote;
  const result = [];
  for (const item of [...order, ...local, ...remote]) {
    if (merged.has(item.id)) { result.push(merged.get(item.id)); merged.delete(item.id); }
  }
  return result;
}
function mergeState(base, local, remote) {
  const projects = mergeRecords(base.projects, local.projects, remote.projects);
  const tasks = mergeRecords(base.tasks, local.tasks, remote.tasks);
  // A task edited while its project was removed must remain reachable.
  const ids = new Set(projects.map(p => p.id));
  for (const task of tasks) if (!ids.has(task.projectId)) {
    const project = [...local.projects, ...remote.projects, ...base.projects].find(p => p.id === task.projectId);
    if (project) { projects.push(clone(project)); ids.add(project.id); }
  }
  return { projects, tasks };
}
module.exports = { EMPTY, clone, equal, validateState, mergeState };
