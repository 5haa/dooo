/* Dooo: actions (store + view + toasts), boot and keyboard shortcuts. */
(function () {
  'use strict';

  var D = window.Dooo;
  var U = D.util;
  var S = D.store;
  var V = D.view;

  var COMPLETE_DELAY = 430; // let the check animation play before the card leaves
  var RESTORE_DELAY = 260;

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  D.actions = {
    add: function (fields) {
      var r = S.add(fields);
      if (V.current() !== 'tasks') V.setView('tasks');
      V.renderList();
      return r.task;
    },

    addMany: function (titles) {
      var r = S.addMany(titles, 'medium');
      if (!r.tasks.length) return;
      if (V.current() !== 'tasks') V.setView('tasks');
      V.renderList();
      V.toast(r.tasks.length === 1 ? 'Task added' : plural(r.tasks.length, 'task') + ' added', function () {
        r.undo();
        V.renderList();
      });
    },

    edit: function (id, fields) {
      if (S.update(id, fields)) V.renderList();
    },

    setPriority: function (id, priority) {
      if (S.update(id, { priority: priority })) V.renderList();
    },

    move: function (id, toIndex, opts) {
      if (S.moveOpen(id, toIndex)) V.renderList({ first: opts && opts.first });
    },

    toggle: function (id) {
      var t = S.get(id);
      if (!t) return;
      if (t.done) D.actions.restore(id);
      else D.actions.complete(id);
    },

    complete: function (id, opts) {
      var undo = S.complete(id);
      if (!undo) return;
      var card = V.cardFor(id);
      if (card && !(opts && opts.fromDrag) && !U.reducedMotion()) {
        V.playComplete(card);
        V.renderCounts();
        setTimeout(function () { V.renderList(); }, COMPLETE_DELAY);
      } else {
        V.renderList();
      }
      V.toast('Task completed', function () {
        undo();
        V.renderList();
      });
    },

    restore: function (id, opts) {
      var undo = S.restore(id);
      if (!undo) return;
      var card = V.cardFor(id);
      if (card && !(opts && opts.fromDrag) && !U.reducedMotion()) {
        V.playRestore(card);
        V.renderCounts();
        setTimeout(function () { V.renderList(); }, RESTORE_DELAY);
      } else {
        V.renderList();
      }
      V.toast('Task restored', function () {
        undo();
        V.renderList();
      });
    },

    remove: function (id) {
      var undo = S.remove(id);
      if (!undo) return;
      V.renderList();
      V.toast('Task deleted', function () {
        undo();
        V.renderList();
      });
    },

    clearDone: function () {
      var r = S.clearDone();
      if (!r.count) return;
      V.renderList();
      V.toast('Cleared ' + plural(r.count, 'task'), function () {
        r.undo();
        V.renderList();
      });
    }
  };

  /* -------------------------------------------------------------- keyboard */

  function onKey(e) {
    if (e.defaultPrevented || (D.dnd && D.dnd.isActive())) return;
    var k = e.key;
    var mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (mod && !e.shiftKey && (k === 'n' || k === 'N')) {
      e.preventDefault();
      D.sheet.open();
      return;
    }
    if (k === 'Escape') {
      if (D.menu.isOpen()) { e.preventDefault(); D.menu.close(true); return; }
      if (D.sheet.isOpen()) { e.preventDefault(); D.sheet.close(); return; }
      return;
    }
    if (mod && !e.shiftKey && (k === 'z' || k === 'Z') && !U.isEditable(e.target) && V.toastHasUndo()) {
      e.preventDefault();
      V.undoToast();
    }
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    D.hydrateIcons(document);
    V.init();
    D.sheet.init();
    D.settingsView.init();
    D.dnd.init();
    D.win.init();
    document.addEventListener('keydown', onKey);

    var api = window.dooo;
    Promise.resolve()
      .then(function () { return api.loadState(); })
      .catch(function (err) {
        console.error('Dooo: could not load saved state', err);
        return { tasks: [], settings: {}, version: '' };
      })
      .then(function (data) {
        S.init(data);
        S.on('settings', function () {
          V.renderHeader();
          if (V.current() === 'settings') D.settingsView.render();
        });
        V.renderHeader();
        D.settingsView.render();
        V.setView('tasks', { instant: true, force: true });

        try {
          if (typeof api.onSettingsChanged === 'function') {
            api.onSettingsChanged(function (settings) { S.applyExternalSettings(settings); });
          }
        } catch (err) {
          console.error('Dooo: could not subscribe to settings changes', err);
        }

        setInterval(V.refreshDue, 30 * 1000);
        window.addEventListener('focus', V.refreshDue);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) V.refreshDue(); });

        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            document.body.classList.add('ready');
            document.documentElement.setAttribute('data-ready', 'true');
          });
        });
      });
  }

  boot();
})();
