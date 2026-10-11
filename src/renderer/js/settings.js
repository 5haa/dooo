/* Dooo: settings view. Every change goes through dooo.updateSettings(patch); the UI re-renders from the result. */
(function () {
  'use strict';

  var D = window.Dooo;
  var S = D.store;

  var AVATAR_SIZE = 128;
  var els = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    els.name = $('set-name');
    els.avatar = $('set-avatar');
    els.photoBtn = $('photo-btn');
    els.photoLabel = $('photo-btn-label');
    els.photoRemove = $('photo-remove');
    els.photoInput = $('photo-input');
    els.ontop = $('set-ontop');
    els.autostart = $('set-autostart');
    els.clearDone = $('clear-done');
    els.clearHint = $('clear-hint');
    els.version = $('version');
    els.quit = $('quit-btn');

    els.name.addEventListener('input', function () {
      S.updateSettings({ name: els.name.value.trim() });
    });
    els.name.addEventListener('blur', function () {
      var v = typeof S.settings.name === 'string' ? S.settings.name : '';
      if (els.name.value !== v) els.name.value = v;
    });
    els.name.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); els.name.blur(); }
    });

    els.ontop.addEventListener('change', function () { S.updateSettings({ alwaysOnTop: els.ontop.checked }); });
    els.autostart.addEventListener('change', function () { S.updateSettings({ launchAtLogin: els.autostart.checked }); });

    els.photoBtn.addEventListener('click', function () { els.photoInput.click(); });
    els.photoInput.addEventListener('change', onPhoto);
    els.photoRemove.addEventListener('click', function () { S.updateSettings({ avatar: null }); });

    els.clearDone.addEventListener('click', function () { D.actions.clearDone(); });
    els.quit.addEventListener('click', function () {
      try { window.dooo.quit(); } catch (err) { console.error('Dooo: quit failed', err); }
    });
  }

  function render() {
    var s = S.settings;
    if (document.activeElement !== els.name) els.name.value = typeof s.name === 'string' ? s.name : '';
    D.view.renderAvatar(els.avatar, s);
    var hasPhoto = typeof s.avatar === 'string' && s.avatar.indexOf('data:image/') === 0;
    els.photoRemove.hidden = !hasPhoto;
    els.photoLabel.textContent = hasPhoto ? 'Change photo' : 'Choose photo';
    els.ontop.checked = !!s.alwaysOnTop;
    els.autostart.checked = !!s.launchAtLogin;
    var ver = S.version || 'dev';
    els.version.textContent = 'Dooo ' + (/^\d/.test(ver) ? 'v' + ver : ver);
    renderCounts();
  }

  function renderCounts() {
    if (!els.clearHint) return;
    var n = S.tasks.filter(function (t) { return t.done; }).length;
    els.clearHint.textContent = n ? n + ' completed task' + (n === 1 ? '' : 's') : 'No completed tasks';
    els.clearDone.disabled = !n;
  }

  /* ---- photo: center-crop and downscale to 128px via canvas, stored as a data: URL ---- */

  function decode(file) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(file).catch(function () { return decodeViaDataUrl(file); });
    }
    return decodeViaDataUrl(file);
  }

  function decodeViaDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(fr.error); };
      fr.onload = function () {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('Not a readable image')); };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function downscale(src, size) {
    var w = src.naturalWidth || src.width;
    var h = src.naturalHeight || src.height;
    if (!w || !h) throw new Error('Empty image');
    var side = Math.min(w, h);
    var sx = (w - side) / 2;
    var sy = (h - side) / 2;
    var source = src;
    // Two-step downscale for big photos keeps the result crisp.
    if (side > size * 4) {
      var mid = document.createElement('canvas');
      mid.width = mid.height = size * 2;
      var mctx = mid.getContext('2d');
      mctx.imageSmoothingQuality = 'high';
      mctx.drawImage(src, sx, sy, side, side, 0, 0, size * 2, size * 2);
      source = mid;
      sx = 0; sy = 0; side = size * 2;
    }
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
    var url = canvas.toDataURL('image/webp', 0.88);
    if (url.indexOf('data:image/webp') !== 0) url = canvas.toDataURL('image/png');
    return url;
  }

  function onPhoto() {
    var file = els.photoInput.files && els.photoInput.files[0];
    els.photoInput.value = '';
    if (!file) return;
    if (file.type && file.type.indexOf('image/') !== 0) { D.view.toast('That file isn’t an image'); return; }
    decode(file).then(function (bmp) {
      var url = downscale(bmp, AVATAR_SIZE);
      if (bmp.close) bmp.close();
      S.updateSettings({ avatar: url });
    }).catch(function (err) {
      console.warn('Dooo: could not read that image', err);
      D.view.toast('Couldn’t read that image');
    });
  }

  D.settingsView = { init: init, render: render, renderCounts: renderCounts };
})();
