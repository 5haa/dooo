/* Dooo: drag and drop.
 *
 * 1. Cards (hand-rolled pointer events, works with real mice and Playwright's page.mouse):
 *    - a press on a card body (not on its buttons) becomes a drag after 5px of movement;
 *    - the card lifts into a floating ghost that follows the pointer, the real card stays as an invisible
 *      placeholder and its neighbours slide out of the way (transform transitions);
 *    - auto-scroll near the list's top/bottom edge, Esc cancels;
 *    - Home view: drop in the list to reorder, or on the Done nav item to complete;
 *      Done view: drop on the Home nav item to restore the task to the top of the open list.
 * 2. External text: dragover/drop are handled (and always preventDefault-ed) at document level, so a dropped link or
 *    file never navigates the window. Each non-empty line becomes a task (max 20). Files are ignored with a toast.
 */
(function () {
  'use strict';

  var D = window.Dooo;
  var U = D.util;

  var THRESHOLD = 5;
  var EDGE = 48;
  var MAX_SPEED = 16;
  var MAX_LINES = 20;

  var els = {};
  var s = null; // the active press / drag session
  var suppressClick = false;

  function $(id) { return document.getElementById(id); }

  function init() {
    els.list = $('list');
    els.inner = $('panel-inner');
    els.layer = $('drag-layer');
    els.navTasks = document.querySelector('.nav-item[data-view="tasks"]');
    els.navDone = document.querySelector('.nav-item[data-view="done"]');
    els.overlay = $('drop-overlay');
    els.dropIcon = $('drop-icon');
    els.dropTitle = $('drop-title');
    els.dropHint = $('drop-hint');

    els.list.addEventListener('pointerdown', onDown);
    els.list.addEventListener('dragstart', function (e) { e.preventDefault(); });
    window.addEventListener('click', function (e) {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    initExternalDrop();
  }

  function isActive() { return !!(s && s.phase === 'drag'); }

  /* ------------------------------------------------------------ press/move */

  function onDown(e) {
    if (s || e.button !== 0 || !e.isPrimary) return;
    if (D.sheet.isOpen()) return;
    var card = e.target.closest('.card');
    if (!card || !els.list.contains(card)) return;
    if (card.classList.contains('leaving') || card.classList.contains('completing') || card.classList.contains('placeholder')) return;
    if (e.target.closest('button, input, textarea, select, a')) return;
    var view = D.view.current();
    if (view !== 'tasks' && view !== 'done') return;
    s = {
      phase: 'pending', view: view, id: card.dataset.id, card: card, pointerId: e.pointerId,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, raf: 0
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
  }

  function detach() {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
  }

  function onMove(e) {
    if (!s || e.pointerId !== s.pointerId) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (s.phase === 'pending') {
      if (Math.hypot(s.x - s.x0, s.y - s.y0) < THRESHOLD) return;
      begin();
      if (!s) return;
    }
    e.preventDefault();
    schedule();
  }

  function onUp(e) {
    if (!s || e.pointerId !== s.pointerId) return;
    if (s.phase === 'pending') { s = null; detach(); return; }
    e.preventDefault();
    s.x = e.clientX;
    s.y = e.clientY;
    finish('drop');
  }

  function onCancel(e) {
    if (!s || e.pointerId !== s.pointerId) return;
    if (s.phase === 'pending') { s = null; detach(); return; }
    finish('cancel');
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !s) return;
    if (s.phase === 'pending') { s = null; detach(); return; }
    e.preventDefault();
    e.stopPropagation();
    finish('escape');
  }

  function onBlur() {
    if (!s) return;
    if (s.phase === 'pending') { s = null; detach(); return; }
    finish('cancel');
  }

  /* ------------------------------------------------------------- the drag */

  function begin() {
    var card = s.card;
    if (!card.isConnected) { s = null; detach(); return; }
    if (D.menu) D.menu.close(false, true);
    s.phase = 'drag';

    var r = card.getBoundingClientRect();
    s.innerRect = els.inner.getBoundingClientRect();
    s.w = r.width;
    s.h = r.height;
    s.offX = s.x0 - r.left;
    s.offY = s.y0 - r.top;

    try { els.list.setPointerCapture(s.pointerId); } catch (err) { /* synthetic pointer: window listeners still see the moves */ }

    // the floating ghost
    var wrap = document.createElement('div');
    wrap.className = 'ghost';
    var ghost = card.cloneNode(true);
    U.stripTestIds(ghost);
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('role');
    ghost.style.width = s.w + 'px';
    ghost.style.height = s.h + 'px';
    wrap.appendChild(ghost);
    els.layer.appendChild(wrap);
    s.wrap = wrap;
    s.ghost = ghost;
    placeGhost();
    requestAnimationFrame(function () { ghost.classList.add('lifted'); });

    // the real card becomes the gap
    card.classList.add('placeholder');

    s.items = Array.prototype.filter.call(els.list.children, function (c) {
      return c.classList.contains('card') && !c.classList.contains('leaving');
    });
    s.index = s.items.indexOf(card);
    s.target = s.index;
    s.slot = s.h + (parseFloat(getComputedStyle(card).marginBottom) || 0);
    s.mids = s.items.map(function (c) { return c.offsetTop + c.offsetHeight / 2; });
    s.reorder = s.view === 'tasks' && s.items.length > 1;
    if (s.reorder) els.list.classList.add('sorting');

    s.nav = s.view === 'tasks' ? els.navDone : els.navTasks;
    s.nav.classList.add('drop-ready');
    s.overNav = false;

    document.body.classList.add('is-dragging');
    if (D.win) D.win.suspend();
  }

  function placeGhost() {
    var x = s.x - s.offX - s.innerRect.left;
    var y = s.y - s.offY - s.innerRect.top;
    s.wrap.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
  }

  function schedule() {
    if (s && !s.raf) s.raf = requestAnimationFrame(frame);
  }

  function frame() {
    if (!s || s.phase !== 'drag') return;
    s.raf = 0;
    placeGhost();
    if (evaluate(true)) schedule();
  }

  function hitNav(node, x, y) {
    var r = node.getBoundingClientRect();
    var pad = 6;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  /* Updates the nav hover state and the reorder target; returns true while auto-scrolling. */
  function evaluate(allowScroll) {
    var over = hitNav(s.nav, s.x, s.y);
    if (over !== s.overNav) {
      s.overNav = over;
      s.nav.classList.toggle('drop-hover', over);
      s.wrap.classList.toggle('over-target', over);
    }
    if (!s.reorder) return false;

    var list = els.list;
    var lr = list.getBoundingClientRect();
    var scrolling = false;
    if (allowScroll && !over) {
      var v = 0;
      if (s.y < lr.top + EDGE) v = -MAX_SPEED * Math.min(1, (lr.top + EDGE - s.y) / EDGE);
      else if (s.y > lr.bottom - EDGE && s.y < lr.bottom + 6) v = MAX_SPEED * Math.min(1, (s.y - (lr.bottom - EDGE)) / EDGE);
      if (v) {
        var before = list.scrollTop;
        list.scrollTop = before + v;
        scrolling = list.scrollTop !== before;
      }
    }

    var t = s.index;
    if (!over) {
      var cy = s.y - s.offY + s.h / 2 - lr.top - list.clientTop + list.scrollTop;
      for (var k = s.index - 1; k >= 0 && cy < s.mids[k]; k--) t = k;
      if (t === s.index) for (var j = s.index + 1; j < s.items.length && cy > s.mids[j]; j++) t = j;
    }
    if (t !== s.target) {
      s.target = t;
      shift();
    }
    return scrolling;
  }

  function shift() {
    for (var k = 0; k < s.items.length; k++) {
      if (k === s.index) continue;
      var dy = 0;
      if (s.target > s.index && k > s.index && k <= s.target) dy = -s.slot;
      else if (s.target < s.index && k >= s.target && k < s.index) dy = s.slot;
      s.items[k].style.transform = dy ? 'translate3d(0, ' + dy + 'px, 0)' : '';
    }
  }

  function finish(reason) {
    var d = s;
    if (!d) return;
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    var commit = reason === 'drop';
    if (commit) evaluate(false);
    s = null;
    detach();
    try { if (els.list.hasPointerCapture(d.pointerId)) els.list.releasePointerCapture(d.pointerId); } catch (err) { /* ignore */ }
    document.body.classList.remove('is-dragging');
    d.nav.classList.remove('drop-ready', 'drop-hover');
    if (D.win) D.win.resume();

    if (reason === 'drop') {
      // the click that follows this pointerup must not open the editor
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
    } else if (reason === 'escape') {
      // the button is still down: swallow the click that its release would produce
      var swallow = function (ev) {
        if (ev.pointerId !== d.pointerId) return;
        window.removeEventListener('pointerup', swallow, true);
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
      };
      window.addEventListener('pointerup', swallow, true);
      setTimeout(function () { window.removeEventListener('pointerup', swallow, true); }, 10000);
    }

    if (commit && d.overNav) dropOnNav(d);
    else if (commit && d.reorder && d.target !== d.index) commitReorder(d);
    else settleBack(d);
  }

  function land(d, rect, done) {
    var ir = els.inner.getBoundingClientRect();
    var x = rect.left - ir.left;
    var y = rect.top - ir.top;
    d.wrap.classList.remove('over-target');
    d.ghost.classList.remove('lifted');
    var a = d.wrap.animate([
      { transform: d.wrap.style.transform },
      { transform: 'translate3d(' + x + 'px, ' + y + 'px, 0)' }
    ], { duration: U.dur(240), easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'forwards' });
    var finished = false;
    var end = function () {
      if (finished) return;
      finished = true;
      d.wrap.remove();
      if (done) done();
    };
    a.onfinish = end;
    a.oncancel = end;
  }

  function settleBack(d) {
    d.items.forEach(function (c) { if (c !== d.card) c.style.transform = ''; });
    var after = function () {
      d.card.classList.remove('placeholder');
      if (!s) els.list.classList.remove('sorting');
    };
    if (!d.card.isConnected) { d.wrap.remove(); after(); return; }
    land(d, d.card.getBoundingClientRect(), after);
  }

  function commitReorder(d) {
    var first = new Map();
    d.items.forEach(function (c) { if (c !== d.card) first.set(c.dataset.id, c.getBoundingClientRect().top); });
    els.list.classList.remove('sorting');
    d.items.forEach(function (c) { c.style.transform = ''; });
    var open = D.store.open();
    var toIndex = d.target;
    // s.items mirrors the open list in the Home view; map the slot to the store's open order just in case.
    if (d.items[d.target] && d.items[d.target] !== d.card) {
      var targetId = d.items[d.target].dataset.id;
      for (var i = 0; i < open.length; i++) if (open[i].id === targetId) { toIndex = i; break; }
    }
    D.actions.move(d.id, toIndex, { first: first });
    land(d, d.card.getBoundingClientRect(), function () { d.card.classList.remove('placeholder'); });
  }

  function dropOnNav(d) {
    d.items.forEach(function (c) { if (c !== d.card) c.style.transform = ''; });
    var ir = els.inner.getBoundingClientRect();
    var nr = d.nav.getBoundingClientRect();
    var x = nr.left + nr.width / 2 - ir.left - d.w / 2;
    var y = nr.top + nr.height / 2 - ir.top - d.h / 2;
    var a = d.wrap.animate([
      { transform: d.wrap.style.transform, opacity: 1 },
      { transform: 'translate3d(' + x + 'px, ' + y + 'px, 0) scale(.12)', opacity: 0 }
    ], { duration: U.dur(320), easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' });
    document.body.classList.add('drop-flying');
    a.onfinish = function () {
      d.wrap.remove();
      document.body.classList.remove('drop-flying');
    };
    a.oncancel = a.onfinish;
    D.view.bump(d.nav);
    setTimeout(function () { if (!s) els.list.classList.remove('sorting'); }, 320);
    if (d.view === 'tasks') D.actions.complete(d.id, { fromDrag: true });
    else D.actions.restore(d.id, { fromDrag: true });
  }

  /* ------------------------------------------------------- external text */

  function parseLines(text) {
    var out = [];
    var lines = String(text || '').split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length && out.length < MAX_LINES; i++) {
      var line = lines[i].replace(/[ \t]/g, ' ').trim();
      // drop list markers: "- ", "* ", "• ", "1. ", "2) ", "[ ] ", "[x] "
      for (var n = 0; n < 2; n++) {
        line = line.replace(/^(?:[-*•◦▪‣–—+]\s+|\d{1,3}[.)]\s+|\[[ xX✓✔]?\]\s*)/, '').trim();
      }
      if (line) out.push(line.slice(0, 300));
    }
    return out;
  }

  function hasFiles(dt) {
    if (!dt) return false;
    if (dt.files && dt.files.length > 0) return true;
    var types = dt.types ? Array.prototype.slice.call(dt.types) : [];
    return types.indexOf('Files') >= 0;
  }

  function readText(dt) {
    var text = '';
    try { text = dt.getData('text/plain') || dt.getData('text') || ''; } catch (err) { text = ''; }
    if (!text) {
      try {
        var uris = dt.getData('text/uri-list');
        if (uris) text = uris.split(/\r?\n/).filter(function (l) { return l && l.charAt(0) !== '#'; }).join('\n');
      } catch (err) { /* ignore */ }
    }
    if (!text) {
      try {
        var html = dt.getData('text/html');
        if (html) text = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
      } catch (err) { /* ignore */ }
    }
    return text;
  }

  function showOverlay(files) {
    var mode = files ? 'files' : 'text';
    if (els.overlay.dataset.mode !== mode) {
      els.overlay.dataset.mode = mode;
      els.overlay.classList.toggle('files', files);
      els.dropIcon.replaceChildren(D.icon(files ? 'file-x' : 'download'));
      els.dropTitle.textContent = files ? 'Only text can be added' : 'Drop to add';
      els.dropHint.textContent = files ? 'Files are ignored' : 'Each line becomes a task';
    }
    if (!els.overlay.classList.contains('open')) U.openLayer(els.overlay);
  }

  function hideOverlay() {
    if (els.overlay.classList.contains('visible')) U.closeLayer(els.overlay, 200);
  }

  function initExternalDrop() {
    var internal = false;
    var depth = 0;
    var safety = 0;

    function sheetTakesIt(e) {
      return D.sheet.isOpen() && U.isEditable(e.target);
    }

    document.addEventListener('dragstart', function () { internal = true; });
    document.addEventListener('dragend', function () { internal = false; depth = 0; hideOverlay(); });

    document.addEventListener('dragenter', function (e) {
      if (internal) return;
      if (sheetTakesIt(e)) return;
      e.preventDefault();
      depth++;
      if (!D.sheet.isOpen()) showOverlay(hasFiles(e.dataTransfer));
    });

    document.addEventListener('dragover', function (e) {
      if (internal) {
        if (!U.isEditable(e.target)) e.preventDefault();
        return;
      }
      if (sheetTakesIt(e)) return; // let the title field accept the text natively
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (!D.sheet.isOpen()) showOverlay(hasFiles(e.dataTransfer));
      clearTimeout(safety);
      safety = setTimeout(function () { depth = 0; hideOverlay(); }, 2500);
    });

    document.addEventListener('dragleave', function () {
      if (internal) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        clearTimeout(safety);
        safety = setTimeout(hideOverlay, 60);
      }
    });

    document.addEventListener('drop', function (e) {
      var wasInternal = internal;
      internal = false;
      depth = 0;
      clearTimeout(safety);
      hideOverlay();
      if (sheetTakesIt(e)) return;
      e.preventDefault();
      if (wasInternal || D.sheet.isOpen()) return;
      var dt = e.dataTransfer;
      if (!dt) return;
      if (hasFiles(dt)) { D.view.toast('Files can’t be added. Drop text instead'); return; }
      var titles = parseLines(readText(dt));
      if (!titles.length) { D.view.toast('Nothing to add'); return; }
      D.actions.addMany(titles);
    });
  }

  D.dnd = { init: init, isActive: isActive, parseLines: parseLines };
})();
