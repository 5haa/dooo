/* Dooo: rendering (header, task cards, nav, views, toast, card menu). */
(function () {
  'use strict';

  var D = window.Dooo;
  var U = D.util;
  var S = D.store;

  var PRIO = {
    high: { label: 'High', icon: 'trend-up' },
    medium: { label: 'Medium', icon: 'trend-flat' },
    low: { label: 'Low', icon: 'trend-down' }
  };
  var VIEWS = ['tasks', 'done', 'settings'];
  var EASE = 'cubic-bezier(.2, .8, .2, 1)';
  var NAV_EASE = 'cubic-bezier(.3, .8, .2, 1)';

  var els = {};
  var current = 'tasks';
  var indAnim = null;

  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------------ init */

  function init() {
    els.panel = $('panel');
    els.inner = $('panel-inner');
    els.avatar = $('avatar');
    els.greetName = $('greet-name');
    els.countPill = $('count-pill');
    els.countNum = $('count-num');
    els.countWord = $('count-word');
    els.pin = $('pin-btn');
    els.viewList = $('view-list');
    els.viewSettings = $('view-settings');
    els.settingsScroll = $('settings-scroll');
    els.list = $('list');
    els.empty = $('empty');
    els.emptyIcon = $('empty-icon');
    els.emptyTitle = $('empty-title');
    els.emptyHint = $('empty-hint');
    els.doneCount = $('done-count');
    els.clearAll = $('clear-all');
    els.nav = $('nav');
    els.navInd = $('nav-indicator');
    els.navItems = Array.prototype.slice.call(els.nav.querySelectorAll('.nav-item'));
    els.fab = $('fab');
    els.toast = $('toast');
    els.toastText = $('toast-text');
    els.toastUndo = $('toast-undo');
    els.menu = $('menu');

    els.list.addEventListener('click', onListClick);
    els.list.addEventListener('keydown', onListKey);
    els.list.addEventListener('scroll', function () { menu.close(); }, { passive: true });
    els.nav.addEventListener('click', function (e) {
      var b = e.target.closest('.nav-item');
      if (b) setView(b.dataset.view);
    });
    els.fab.addEventListener('click', function () { D.sheet.open(); });
    els.pin.addEventListener('click', function () { S.updateSettings({ alwaysOnTop: !S.settings.alwaysOnTop }); });
    els.clearAll.addEventListener('click', function () { D.actions.clearDone(); });

    els.toastUndo.addEventListener('click', undoToast);
    els.toast.addEventListener('mouseenter', function () { clearTimeout(toastState.timer); });
    els.toast.addEventListener('mouseleave', function () {
      if (els.toast.classList.contains('open')) armToast(2000);
    });

    els.menu.addEventListener('click', onMenuClick);
    els.menu.addEventListener('keydown', onMenuKey);
    document.addEventListener('pointerdown', function (e) {
      if (!menu.id) return;
      if (els.menu.contains(e.target) || (menu.anchor && menu.anchor.contains(e.target))) return;
      menu.close();
    }, true);
    window.addEventListener('blur', function () { menu.close(); });
    window.addEventListener('resize', function () { menu.close(false, true); });

    if (window.ResizeObserver) new ResizeObserver(function () { placeIndicator(); }).observe(els.nav);
  }

  /* --------------------------------------------------------------- header */

  function initialOf(name) {
    var n = typeof name === 'string' ? name.trim() : '';
    if (!n) return '';
    return Array.from(n)[0].toLocaleUpperCase();
  }

  function renderAvatar(node, s) {
    var src = typeof s.avatar === 'string' && s.avatar.indexOf('data:image/') === 0 ? s.avatar : null;
    var key = src ? 'img:' + src.length + ':' + src.slice(-32) : 'txt:' + initialOf(s.name);
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.classList.toggle('has-photo', !!src);
    if (src) {
      var img = new Image();
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.src = src;
      node.replaceChildren(img);
    } else {
      var ini = initialOf(s.name);
      node.replaceChildren(ini ? document.createTextNode(ini) : D.icon('user'));
    }
  }

  function renderHeader() {
    var s = S.settings;
    var name = typeof s.name === 'string' ? s.name.trim() : '';
    els.greetName.textContent = name || 'there';
    renderAvatar(els.avatar, s);
    var on = !!s.alwaysOnTop;
    els.pin.setAttribute('aria-pressed', String(on));
    els.pin.setAttribute('aria-label', 'Keep on top');
    els.pin.title = on ? 'Keep on top: on' : 'Keep on top: off';
  }

  function renderCounts() {
    var open = 0, done = 0;
    S.tasks.forEach(function (t) { if (t.done) done++; else open++; });
    els.countPill.classList.toggle('all-done', open === 0);
    els.countNum.textContent = open ? String(open) : '';
    els.countWord.textContent = open ? 'to do' : 'All done';
    els.countPill.setAttribute('aria-label', open ? open + ' to do' : 'All done');
    els.doneCount.textContent = done ? String(done) : '';
    els.clearAll.hidden = !done;
    if (D.settingsView) D.settingsView.renderCounts();
  }

  /* ---------------------------------------------------------------- cards */

  function createCard(task, now) {
    var card = U.el('article', { class: 'card', role: 'listitem', tabindex: '0' });
    var tag = U.el('span', { class: 'tag' });
    var menuBtn = U.el('button', {
      type: 'button', class: 'card-menu', 'data-action': 'menu',
      'aria-label': 'Task options', 'aria-haspopup': 'menu', 'aria-expanded': 'false'
    }, [D.icon('ellipsis')]);
    var title = U.el('div', { class: 'card-title' });
    var meta = U.el('div', { class: 'card-meta' }, [D.icon('calendar'), U.el('span')]);
    var check = U.el('button', { type: 'button', class: 'check', 'data-action': 'toggle' }, [D.icon('check')]);
    card.append(tag, menuBtn, title, meta, check);
    updateCard(card, task, now);
    return card;
  }

  function updateCard(card, task, now) {
    now = now || new Date();
    var done = !!task.done;
    card.dataset.id = task.id;
    card.setAttribute('data-testid', 'task-card');
    card.setAttribute('tabindex', '0');
    card.classList.remove('completing');
    card.classList.toggle('is-done', done);

    var menuBtn = card.querySelector('.card-menu');
    menuBtn.setAttribute('data-testid', 'task-menu');

    var p = PRIO[task.priority] ? task.priority : 'medium';
    var tag = card.querySelector('.tag');
    if (tag.dataset.prio !== p) {
      tag.dataset.prio = p;
      tag.className = 'tag prio-' + p;
      tag.replaceChildren(document.createTextNode(PRIO[p].label), D.icon(PRIO[p].icon));
    }

    var title = card.querySelector('.card-title');
    if (title.textContent !== task.title) title.textContent = task.title;

    var meta = card.querySelector('.card-meta');
    var text = '', overdue = false, iconName = 'calendar';
    if (done) {
      iconName = 'circle-check';
      text = task.completedAt ? 'Done ' + U.formatStamp(task.completedAt, now).replace(/^(Today|Tomorrow|Yesterday)/, function (w) { return w.toLowerCase(); }) : '';
    } else {
      var f = U.formatDue(task.due, now);
      if (f) { text = f.label; overdue = f.overdue; }
    }
    meta.hidden = !text;
    meta.classList.toggle('overdue', overdue);
    if (meta.dataset.icon !== iconName) {
      meta.dataset.icon = iconName;
      meta.firstChild.replaceWith(D.icon(iconName));
    }
    var span = meta.lastChild;
    if (span.textContent !== text) span.textContent = text;
    meta.title = overdue ? 'Overdue' : '';

    var check = card.querySelector('.check');
    check.setAttribute('data-testid', 'task-toggle');
    check.classList.toggle('on', done);
    check.setAttribute('aria-pressed', String(done));
    check.setAttribute('aria-label', done ? 'Mark as not done' : 'Mark as done');
    check.title = done ? 'Restore' : 'Complete';
  }

  function cardFor(id) {
    var cards = els.list.children;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.dataset.id === id && !c.classList.contains('leaving')) return c;
    }
    return null;
  }

  function leave(card, animate) {
    card.classList.add('leaving');
    U.stripTestIds(card);
    card.removeAttribute('tabindex');
    if (card._flip) card._flip.cancel();
    if (!animate) { card.remove(); return; }
    var cs = getComputedStyle(card);
    var startOpacity = card.classList.contains('placeholder') ? 0 : 1;
    var a = card.animate([
      { height: card.offsetHeight + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: cs.marginBottom, opacity: startOpacity, transform: 'scale(1)' },
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '0px', opacity: 0, transform: 'scale(.96)' }
    ], { duration: 300, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    a.onfinish = function () { card.remove(); };
    a.oncancel = a.onfinish;
  }

  /* Keyed render of the current list (Home = open tasks in manual order, Done = completed, newest first).
   * Existing cards are reused, new ones fade in, removed ones collapse out, moved ones slide (FLIP).
   * opts.first: Map(id -> previous visual top) supplied by drag and drop. opts.instant: no animation. */
  function renderList(opts) {
    opts = opts || {};
    if (current === 'settings') { renderCounts(); return; }
    var isDone = current === 'done';
    var tasks = isDone ? S.done() : S.open();
    var animate = !opts.instant && !U.reducedMotion();
    var list = els.list;

    var existing = new Map();
    Array.prototype.forEach.call(list.children, function (c) {
      if (c.classList.contains('card') && !c.classList.contains('leaving') && c.dataset.id) existing.set(c.dataset.id, c);
    });

    var first = opts.first || null;
    if (animate && !first) {
      first = new Map();
      existing.forEach(function (c, id) { first.set(id, c.getBoundingClientRect().top); });
    }

    var now = new Date();
    var next = [];
    var added = [];
    tasks.forEach(function (t) {
      var c = existing.get(t.id);
      if (c) {
        existing.delete(t.id);
        updateCard(c, t, now);
      } else {
        c = createCard(t, now);
        added.push(c);
      }
      next.push(c);
    });

    existing.forEach(function (c) { leave(c, animate); });

    var cursor = list.firstElementChild;
    next.forEach(function (c) {
      while (cursor && cursor.classList.contains('leaving')) cursor = cursor.nextElementSibling;
      if (cursor === c) { cursor = c.nextElementSibling; return; }
      list.insertBefore(c, cursor);
    });

    if (animate) {
      next.forEach(function (c) {
        if (!first || c.classList.contains('placeholder')) return;
        var f = first.get(c.dataset.id);
        if (f === undefined) return;
        var dy = f - c.getBoundingClientRect().top;
        if (Math.abs(dy) < 0.5) return;
        if (c._flip) c._flip.cancel();
        c._flip = c.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 320, easing: EASE });
      });
      added.forEach(function (c, i) {
        c.animate([
          { opacity: 0, transform: 'translateY(-10px) scale(.97)' },
          { opacity: 1, transform: 'none' }
        ], { duration: 340, delay: Math.min(i, 10) * 40, easing: EASE, fill: 'backwards' });
      });
    }

    els.viewList.classList.toggle('is-empty', tasks.length === 0);
    renderCounts();
  }

  /* Re-evaluate "Today"/"Tomorrow"/overdue labels as time passes. */
  function refreshDue() {
    if (current === 'settings') return;
    var now = new Date();
    Array.prototype.forEach.call(els.list.children, function (c) {
      if (c.classList.contains('leaving') || c.classList.contains('completing')) return;
      var t = S.get(c.dataset.id);
      if (t) updateCard(c, t, now);
    });
  }

  function restartAnim(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    var done = function (ev) {
      if (ev.target !== node || ev.pseudoElement) return;
      node.classList.remove(cls);
      node.removeEventListener('animationend', done);
    };
    node.addEventListener('animationend', done);
  }

  /* The check pops and draws before the card leaves; test ids go at once (the card no longer represents an open task). */
  function playComplete(card) {
    U.stripTestIds(card);
    card.classList.add('completing');
    var check = card.querySelector('.check');
    check.classList.add('on');
    restartAnim(check, 'pop');
  }

  function playRestore(card) {
    U.stripTestIds(card);
    card.classList.add('completing');
    var check = card.querySelector('.check');
    check.classList.remove('on');
    restartAnim(check, 'unpop');
  }

  function bump(node) { restartAnim(node, 'bump'); }

  /* ------------------------------------------------------------ list input */

  function onListClick(e) {
    var card = e.target.closest('.card');
    if (!card || !els.list.contains(card) || card.classList.contains('leaving') || card.classList.contains('completing')) return;
    var id = card.dataset.id;
    if (e.target.closest('[data-action="toggle"]')) { D.actions.toggle(id); return; }
    var mb = e.target.closest('[data-action="menu"]');
    if (mb) { menu.toggle(card, mb, e.detail === 0); return; }
    if (current === 'tasks') {
      var t = S.get(id);
      if (t) D.sheet.open(t);
    }
  }

  function siblingCard(card, dir) {
    var n = dir < 0 ? card.previousElementSibling : card.nextElementSibling;
    while (n && n.classList.contains('leaving')) n = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
    return n;
  }

  function onListKey(e) {
    var card = e.target;
    if (!card.classList || !card.classList.contains('card') || card.classList.contains('leaving')) return;
    var id = card.dataset.id;
    var k = e.key;
    if (k === 'Enter') {
      e.preventDefault();
      if (current === 'tasks') { var t = S.get(id); if (t) D.sheet.open(t); }
    } else if (k === ' ') {
      e.preventDefault();
      D.actions.toggle(id);
    } else if (k === 'Delete') {
      e.preventDefault();
      var near = siblingCard(card, 1) || siblingCard(card, -1);
      D.actions.remove(id);
      if (near) near.focus();
    } else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      if (current !== 'tasks') return;
      var open = S.open();
      var i = open.findIndex(function (x) { return x.id === id; });
      var to = i + (k === 'ArrowUp' ? -1 : 1);
      if (i < 0 || to < 0 || to >= open.length) return;
      D.actions.move(id, to);
      var c = cardFor(id);
      if (c) c.focus();
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      var sib = siblingCard(card, k === 'ArrowUp' ? -1 : 1);
      if (sib) sib.focus();
    }
  }

  /* ----------------------------------------------------------- nav + views */

  function placeIndicator() {
    var a = els.nav.querySelector('.nav-item.active');
    if (!a) return null;
    var x = a.offsetLeft, w = a.offsetWidth;
    els.navInd.style.transform = 'translateX(' + x + 'px)';
    els.navInd.style.width = w + 'px';
    return { x: x, w: w };
  }

  function setNavActive(view, animate) {
    var items = els.navItems;
    var doAnim = animate && !U.reducedMotion() && els.navInd.offsetWidth > 0;
    var before = null;
    if (doAnim) {
      var nr = els.nav.getBoundingClientRect();
      var ir = els.navInd.getBoundingClientRect();
      before = {
        x: ir.left - nr.left - els.nav.clientLeft,
        w: ir.width,
        icons: items.map(function (it) { return it.querySelector('.icon').getBoundingClientRect().left; })
      };
    }
    var active = null;
    items.forEach(function (it) {
      var on = it.dataset.view === view;
      it.classList.toggle('active', on);
      if (on) { it.setAttribute('aria-current', 'page'); active = it; } else it.removeAttribute('aria-current');
    });
    var to = placeIndicator();
    if (!doAnim || !to) return;
    if (indAnim) indAnim.cancel();
    indAnim = els.navInd.animate([
      { transform: 'translateX(' + before.x + 'px)', width: before.w + 'px' },
      { transform: 'translateX(' + to.x + 'px)', width: to.w + 'px' }
    ], { duration: 340, easing: NAV_EASE });
    items.forEach(function (it, k) {
      var ic = it.querySelector('.icon');
      var dx = before.icons[k] - ic.getBoundingClientRect().left;
      if (Math.abs(dx) > 0.5) ic.animate([{ transform: 'translateX(' + dx + 'px)' }, { transform: 'none' }], { duration: 340, easing: NAV_EASE });
    });
    var label = active && active.querySelector('.nav-label');
    if (label) {
      label.animate([{ opacity: 0, transform: 'translateX(-6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 240, delay: 90, easing: 'ease-out', fill: 'backwards' });
    }
  }

  function updateEmptyCopy() {
    var done = current === 'done';
    if (els.empty.dataset.mode === current) return;
    els.empty.dataset.mode = current;
    els.emptyIcon.replaceChildren(D.icon(done ? 'circle-check' : 'coffee'));
    els.emptyTitle.textContent = done ? 'Nothing completed yet' : 'Nothing to do';
    els.emptyHint.textContent = done ? 'Finished tasks land here' : 'Tap + or drop text here';
  }

  function setView(view, opts) {
    opts = opts || {};
    if (VIEWS.indexOf(view) < 0) return;
    var prev = current;
    if (view === prev && !opts.force) {
      if (view !== 'settings' && els.list.scrollTop > 0) els.list.scrollTo({ top: 0, behavior: U.reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    menu.close(false, true);
    current = view;
    setNavActive(view, !opts.instant);
    var listMode = view !== 'settings';
    els.viewList.classList.toggle('active', listMode);
    els.viewSettings.classList.toggle('active', !listMode);
    els.viewList.classList.toggle('is-done', view === 'done');
    els.list.replaceChildren();
    els.list.scrollTop = 0;
    if (listMode) {
      updateEmptyCopy();
      renderList({ instant: true });
    } else {
      els.viewList.classList.remove('is-empty');
      if (D.settingsView) D.settingsView.render();
      els.settingsScroll.scrollTop = 0;
      renderCounts();
    }
    if (!opts.instant && prev !== view && !U.reducedMotion()) {
      var dir = VIEWS.indexOf(view) > VIEWS.indexOf(prev) ? 1 : -1;
      (listMode ? els.viewList : els.viewSettings).animate([
        { opacity: 0, transform: 'translateX(' + (dir * 16) + 'px)' },
        { opacity: 1, transform: 'none' }
      ], { duration: 260, easing: EASE });
    }
  }

  /* ---------------------------------------------------------------- toast */

  var toastState = { timer: 0, undo: null };

  function armToast(ms) {
    clearTimeout(toastState.timer);
    toastState.timer = setTimeout(hideToast, ms);
  }

  function toast(text, undo, ms) {
    els.toastText.textContent = text;
    toastState.undo = typeof undo === 'function' ? undo : null;
    els.toast.classList.toggle('no-undo', !toastState.undo);
    var wasOpen = els.toast.classList.contains('open');
    U.openLayer(els.toast);
    if (wasOpen && !U.reducedMotion()) {
      els.toast.animate([{ transform: 'translate(-50%, 0) scale(.95)' }, { transform: 'translate(-50%, 0) scale(1)' }], { duration: 200, easing: EASE });
    }
    armToast(ms || 4000);
  }

  function hideToast() {
    clearTimeout(toastState.timer);
    toastState.undo = null;
    U.closeLayer(els.toast, 260);
  }

  function undoToast() {
    var fn = toastState.undo;
    hideToast();
    if (fn) fn();
  }

  function toastHasUndo() { return !!toastState.undo && els.toast.classList.contains('open'); }

  /* ----------------------------------------------------------------- menu */

  function menuItem(cmd, icon, label, testid, danger) {
    return U.el('button', {
      type: 'button', class: 'menu-item' + (danger ? ' danger' : ''), role: 'menuitem',
      'data-cmd': cmd, 'data-testid': testid
    }, [D.icon(icon), label]);
  }

  function buildMenu(task) {
    var m = els.menu;
    m.replaceChildren();
    if (!task.done) {
      m.append(menuItem('edit', 'pencil', 'Edit', 'menu-edit'));
      m.append(U.el('div', { class: 'menu-label', text: 'Priority' }));
      var row = U.el('div', { class: 'menu-prio', role: 'group', 'aria-label': 'Priority' });
      ['high', 'medium', 'low'].forEach(function (p) {
        var cur = task.priority === p;
        row.append(U.el('button', {
          type: 'button', class: 'menu-prio-btn prio-' + p + (cur ? ' current' : ''), role: 'menuitemradio',
          'aria-checked': String(cur), 'data-cmd': 'prio', 'data-prio': p, 'data-testid': 'menu-priority-' + p
        }, [PRIO[p].label]));
      });
      m.append(row);
    } else {
      m.append(menuItem('restore', 'rotate-ccw', 'Restore', 'menu-restore'));
    }
    m.append(U.el('div', { class: 'menu-sep', role: 'separator' }));
    m.append(menuItem('delete', 'trash', 'Delete', 'menu-delete', true));
  }

  var menu = {
    id: null,
    anchor: null,
    isOpen: function () { return !!this.id; },
    toggle: function (card, btn, viaKeyboard) {
      if (this.id && this.id === card.dataset.id) { this.close(); return; }
      this.open(card, btn, viaKeyboard);
    },
    open: function (card, btn, viaKeyboard) {
      var task = S.get(card.dataset.id);
      if (!task) return;
      this.close(false, true);
      this.id = task.id;
      this.anchor = btn;
      btn.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      buildMenu(task);
      var m = els.menu;
      clearTimeout(m._layerTimer);
      m.classList.remove('open');
      m.classList.add('visible');
      var inner = els.inner.getBoundingClientRect();
      var b = btn.getBoundingClientRect();
      var mw = m.offsetWidth, mh = m.offsetHeight;
      var left = U.clamp(b.right - inner.left - mw + 2, 10, inner.width - mw - 10);
      var top = b.bottom - inner.top + 6;
      var up = false;
      if (top + mh > inner.height - 12) { top = b.top - inner.top - mh - 6; up = true; }
      top = U.clamp(top, 10, Math.max(10, inner.height - mh - 10));
      m.style.left = left + 'px';
      m.style.top = top + 'px';
      m.classList.toggle('up', up);
      U.openLayer(m);
      if (viaKeyboard) {
        var firstBtn = m.querySelector('button');
        if (firstBtn) firstBtn.focus();
      }
    },
    close: function (focusAnchor, immediate) {
      if (!this.id) return;
      var a = this.anchor;
      this.id = null;
      this.anchor = null;
      if (a) { a.classList.remove('open'); a.setAttribute('aria-expanded', 'false'); }
      U.stripTestIds(els.menu);
      if (immediate) {
        clearTimeout(els.menu._layerTimer);
        els.menu.classList.remove('open', 'visible');
      } else {
        U.closeLayer(els.menu, 200);
      }
      if (focusAnchor && a && a.isConnected) a.focus();
    }
  };

  function onMenuClick(e) {
    var b = e.target.closest('[data-cmd]');
    if (!b || !menu.id) return;
    var id = menu.id;
    var cmd = b.dataset.cmd;
    menu.close(false, cmd === 'edit');
    if (cmd === 'edit') { var t = S.get(id); if (t) D.sheet.open(t); }
    else if (cmd === 'prio') D.actions.setPriority(id, b.dataset.prio);
    else if (cmd === 'delete') D.actions.remove(id);
    else if (cmd === 'restore') D.actions.restore(id);
  }

  function onMenuKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    var btns = Array.prototype.slice.call(els.menu.querySelectorAll('button'));
    var i = btns.indexOf(document.activeElement);
    var n = btns.length;
    var next = btns[((i < 0 ? -1 : i) + (e.key === 'ArrowDown' ? 1 : -1) + n) % n];
    if (next) next.focus();
  }

  D.menu = menu;
  D.view = {
    init: init,
    current: function () { return current; },
    renderHeader: renderHeader,
    renderAvatar: renderAvatar,
    renderCounts: renderCounts,
    renderList: renderList,
    refreshDue: refreshDue,
    setView: setView,
    placeIndicator: placeIndicator,
    cardFor: cardFor,
    playComplete: playComplete,
    playRestore: playRestore,
    bump: bump,
    toast: toast,
    hideToast: hideToast,
    undoToast: undoToast,
    toastHasUndo: toastHasUndo,
    els: els
  };
})();
