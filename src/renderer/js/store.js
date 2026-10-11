/* Dooo: state + persistence.
 * Task: { id, title, priority: 'high'|'medium'|'low', due: "YYYY-MM-DD" | "YYYY-MM-DDTHH:mm" | null,
 *         done, createdAt, completedAt }
 * The array order is the user's manual order of open tasks. Completing a task leaves it in place, so an undo puts
 * it back exactly where it was. Every change is followed by dooo.saveTasks(tasks), with no debounce.
 */
(function () {
  'use strict';

  var D = window.Dooo;
  var U = D.util;
  var PRIORITIES = ['high', 'medium', 'low'];
  var MAX_TITLE = 300;
  var listeners = {};

  function api() { return window.dooo; }

  function cleanTitle(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  }

  function normalizeTask(t, seen) {
    if (!t || typeof t !== 'object') return null;
    var id = typeof t.id === 'string' && t.id ? t.id : U.uid();
    while (seen[id]) id = U.uid();
    seen[id] = true;
    var createdAt = Number.isFinite(t.createdAt) ? t.createdAt : Date.now();
    var done = !!t.done;
    return Object.assign({}, t, {
      id: id,
      title: cleanTitle(t.title) || 'Untitled',
      priority: PRIORITIES.indexOf(t.priority) >= 0 ? t.priority : 'medium',
      due: U.parseDue(t.due) ? t.due : null,
      done: done,
      createdAt: createdAt,
      completedAt: done ? (Number.isFinite(t.completedAt) ? t.completedAt : createdAt) : null
    });
  }

  var store = {
    tasks: [],
    settings: {},
    version: '',

    on: function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit: function (evt, data) { (listeners[evt] || []).forEach(function (fn) { fn(data); }); },

    init: function (data) {
      data = data || {};
      var seen = {};
      this.tasks = (Array.isArray(data.tasks) ? data.tasks : []).map(function (t) { return normalizeTask(t, seen); }).filter(Boolean);
      this.settings = Object.assign({}, data.settings || {});
      this.version = data.version ? String(data.version) : '';
    },

    get: function (id) {
      for (var i = 0; i < this.tasks.length; i++) if (this.tasks[i].id === id) return this.tasks[i];
      return null;
    },
    indexOf: function (id) {
      for (var i = 0; i < this.tasks.length; i++) if (this.tasks[i].id === id) return i;
      return -1;
    },
    open: function () { return this.tasks.filter(function (t) { return !t.done; }); },
    done: function () {
      return this.tasks.filter(function (t) { return t.done; })
        .sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
    },

    persist: function () {
      var p;
      try {
        p = api().saveTasks(this.tasks);
      } catch (err) {
        console.error('Dooo: saving tasks failed', err);
        return;
      }
      if (p && typeof p.catch === 'function') p.catch(function (err) { console.error('Dooo: saving tasks failed', err); });
    },

    /* ---- mutations (each persists and returns what the UI needs) ---- */

    add: function (fields) {
      var task = {
        id: U.uid(),
        title: cleanTitle(fields.title) || 'Untitled',
        priority: PRIORITIES.indexOf(fields.priority) >= 0 ? fields.priority : 'medium',
        due: U.parseDue(fields.due) ? fields.due : null,
        done: false,
        createdAt: Date.now(),
        completedAt: null
      };
      this.tasks.unshift(task);
      this.persist();
      var self = this;
      return { task: task, undo: function () { self.removeIds([task.id]); } };
    },

    /* Dropped text: one task per line, inserted at the top in line order. */
    addMany: function (titles, priority) {
      var now = Date.now();
      var made = titles.map(function (title, i) {
        return {
          id: U.uid(),
          title: cleanTitle(title) || 'Untitled',
          priority: PRIORITIES.indexOf(priority) >= 0 ? priority : 'medium',
          due: null,
          done: false,
          createdAt: now + i,
          completedAt: null
        };
      });
      this.tasks = made.concat(this.tasks);
      this.persist();
      var self = this;
      var ids = made.map(function (t) { return t.id; });
      return { tasks: made, undo: function () { self.removeIds(ids); } };
    },

    update: function (id, patch) {
      var t = this.get(id);
      if (!t) return null;
      var snap = this.snapshot([id]);
      if (patch.title !== undefined) t.title = cleanTitle(patch.title) || t.title;
      if (patch.priority !== undefined && PRIORITIES.indexOf(patch.priority) >= 0) t.priority = patch.priority;
      if (patch.due !== undefined) t.due = U.parseDue(patch.due) ? patch.due : null;
      this.persist();
      var self = this;
      return function () { self.revert(snap); };
    },

    complete: function (id) {
      var t = this.get(id);
      if (!t || t.done) return null;
      var snap = this.snapshot([id]);
      t.done = true;
      t.completedAt = Date.now();
      this.persist();
      var self = this;
      return function () { self.revert(snap); };
    },

    /* Back to the open list: to the very top (drag onto Home, or the Done-view toggle). */
    restore: function (id) {
      var i = this.indexOf(id);
      if (i < 0 || !this.tasks[i].done) return null;
      var snap = this.snapshot([id]);
      var t = this.tasks[i];
      t.done = false;
      t.completedAt = null;
      this.tasks.splice(i, 1);
      this.tasks.unshift(t);
      this.persist();
      var self = this;
      return function () { self.revert(snap); };
    },

    remove: function (id) {
      var snap = this.snapshot([id]);
      if (!snap.length) return null;
      this.tasks.splice(snap[0].index, 1);
      this.persist();
      var self = this;
      return function () { self.revert(snap); };
    },

    clearDone: function () {
      var ids = this.tasks.filter(function (t) { return t.done; }).map(function (t) { return t.id; });
      if (!ids.length) return { count: 0, undo: null };
      var snap = this.snapshot(ids);
      this.tasks = this.tasks.filter(function (t) { return !t.done; });
      this.persist();
      var self = this;
      return { count: ids.length, undo: function () { self.revert(snap); } };
    },

    /* Reorder within the open tasks; done tasks keep their slots in the array. */
    moveOpen: function (id, toIndex) {
      var open = this.open();
      var from = -1;
      for (var i = 0; i < open.length; i++) if (open[i].id === id) { from = i; break; }
      if (from < 0) return false;
      toIndex = U.clamp(toIndex, 0, open.length - 1);
      if (toIndex === from) return false;
      var moved = open.splice(from, 1)[0];
      open.splice(toIndex, 0, moved);
      var k = 0;
      this.tasks = this.tasks.map(function (t) { return t.done ? t : open[k++]; });
      this.persist();
      return true;
    },

    removeIds: function (ids) {
      var drop = {};
      ids.forEach(function (id) { drop[id] = true; });
      this.tasks = this.tasks.filter(function (t) { return !drop[t.id]; });
      this.persist();
    },

    /* ---- undo plumbing: per-task snapshots, so undo never disturbs unrelated changes ---- */

    snapshot: function (ids) {
      var out = [];
      for (var i = 0; i < this.tasks.length; i++) {
        if (ids.indexOf(this.tasks[i].id) >= 0) out.push({ index: i, task: Object.assign({}, this.tasks[i]) });
      }
      return out;
    },

    revert: function (snaps) {
      var self = this;
      snaps.forEach(function (s) {
        var cur = self.indexOf(s.task.id);
        if (cur >= 0) self.tasks.splice(cur, 1);
      });
      snaps.slice().sort(function (a, b) { return a.index - b.index; }).forEach(function (s) {
        self.tasks.splice(Math.min(s.index, self.tasks.length), 0, Object.assign({}, s.task));
      });
      this.persist();
    },

    /* ---- settings: optimistic, serialised, newest patch wins ---- */

    updateSettings: function (patch) {
      Object.assign(this.settings, patch);
      this.emit('settings', this.settings);
      pendingPatch = Object.assign(pendingPatch || {}, patch);
      if (!inFlight) pumpSettings();
    },

    /* Pushed from main (tray menu). Keep any patch the renderer has not sent yet on top. */
    applyExternalSettings: function (settings) {
      if (!settings || typeof settings !== 'object') return;
      this.settings = Object.assign({}, settings, pendingPatch || {});
      this.emit('settings', this.settings);
    }
  };

  var inFlight = false;
  var pendingPatch = null;

  function pumpSettings() {
    var patch = pendingPatch;
    pendingPatch = null;
    if (!patch) return;
    inFlight = true;
    var p;
    try {
      p = Promise.resolve(api().updateSettings(patch));
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(function (resolved) {
      inFlight = false;
      if (pendingPatch) { pumpSettings(); return; }
      if (resolved && typeof resolved === 'object') {
        store.settings = Object.assign({}, resolved);
        store.emit('settings', store.settings);
      }
    }, function (err) {
      inFlight = false;
      console.error('Dooo: updating settings failed', err);
      if (pendingPatch) pumpSettings();
    });
  }

  D.store = store;
})();
