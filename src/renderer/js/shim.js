/* Dooo: preview shim.
 * In Electron the preload exposes window.dooo. In a plain browser (design preview) it is missing, so this installs
 * a localStorage-backed stand-in with the same API: window.* calls are no-ops and the version is "dev".
 */
(function () {
  'use strict';

  if (window.dooo) return;

  var KEY_TASKS = 'dooo.preview.tasks';
  var KEY_SETTINGS = 'dooo.preview.settings';
  var DEFAULTS = { name: 'Jennifer', avatar: null, alwaysOnTop: false, launchAtLogin: true };

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable: preview only */ }
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  var settings = Object.assign({}, DEFAULTS, read(KEY_SETTINGS, {}));
  var calls = [];
  function log(name, args) {
    calls.push({ name: name, args: Array.prototype.slice.call(args), at: Date.now() });
    if (calls.length > 500) calls.shift();
  }

  window.dooo = {
    preview: true,
    loadState: function () {
      log('loadState', arguments);
      var tasks = read(KEY_TASKS, []);
      return Promise.resolve({ tasks: Array.isArray(tasks) ? tasks : [], settings: clone(settings), version: 'dev' });
    },
    saveTasks: function (tasks) {
      log('saveTasks', [Array.isArray(tasks) ? tasks.length : 0]);
      write(KEY_TASKS, tasks);
      return Promise.resolve();
    },
    updateSettings: function (patch) {
      log('updateSettings', arguments);
      settings = Object.assign({}, settings, patch || {});
      write(KEY_SETTINGS, settings);
      return Promise.resolve(clone(settings));
    },
    onSettingsChanged: function () {
      return function () {};
    },
    window: {
      hide: function () { log('hide', arguments); },
      getSize: function () {
        log('getSize', arguments);
        return Promise.resolve({ width: window.innerWidth, height: window.innerHeight });
      },
      setSize: function () { log('setSize', arguments); },
      setIgnoreMouse: function () { log('setIgnoreMouse', arguments); }
    },
    quit: function () { log('quit', arguments); },
    /* preview-only: lets a test harness inspect what the UI asked the shell to do */
    __calls: calls
  };

  document.body.classList.add('preview');
})();
