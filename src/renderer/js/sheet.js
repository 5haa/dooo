/* Dooo: add / edit sheet (slides up inside the panel). Enter saves, Esc closes, Ctrl+N opens it from anywhere. */
(function () {
  'use strict';

  var D = window.Dooo;
  var U = D.util;
  var S = D.store;

  var els = {};
  var st = { open: false, mode: 'add', id: null, priority: 'medium', date: null, time: null, returnFocus: null };

  function $(id) { return document.getElementById(id); }

  function init() {
    els.wrap = $('sheet-wrap');
    els.backdrop = $('sheet-backdrop');
    els.form = $('sheet');
    els.title = $('sheet-title');
    els.close = $('sheet-close');
    els.input = $('task-input');
    els.segs = Array.prototype.slice.call(els.form.querySelectorAll('.seg-btn'));
    els.chips = Array.prototype.slice.call(els.form.querySelectorAll('.chip[data-due]'));
    els.pickLabel = $('pick-label');
    els.date = $('due-date');
    els.timeChip = $('time-chip');
    els.timeLabel = $('time-label');
    els.time = $('due-time');
    els.timeClear = $('time-clear');
    els.dateClear = $('date-clear');
    els.submit = $('task-submit');

    els.form.addEventListener('submit', function (e) { e.preventDefault(); save(); });
    els.form.addEventListener('keydown', onKey);
    els.close.addEventListener('click', close);
    els.backdrop.addEventListener('click', close);
    els.input.addEventListener('input', onInput);

    els.segs.forEach(function (b) {
      b.addEventListener('click', function () { st.priority = b.dataset.prio; renderPriority(); });
    });
    els.chips.forEach(function (b) {
      b.addEventListener('click', function () { onDueChip(b.dataset.due); });
    });
    els.date.addEventListener('change', function () {
      els.date.classList.remove('fallback');
      if (U.parseDue(els.date.value)) { st.date = els.date.value; renderDue(); }
    });
    els.timeChip.addEventListener('click', pickTime);
    els.time.addEventListener('change', function () {
      els.time.classList.remove('fallback');
      if (/^\d{2}:\d{2}$/.test(els.time.value)) {
        st.time = els.time.value;
        if (!st.date) st.date = U.dateKey(new Date());
        renderDue();
      }
    });
    els.timeClear.addEventListener('click', function () { st.time = null; renderDue(); els.input.focus(); });
    els.dateClear.addEventListener('click', function () { st.date = null; st.time = null; renderDue(); els.input.focus(); });
  }

  /* ------------------------------------------------------------- open/close */

  function open(task) {
    if (D.menu) D.menu.close(false, true);
    var editing = !!(task && task.id && S.get(task.id));
    if (st.open && !editing && st.mode === 'add') { els.input.focus(); return; }
    st.mode = editing ? 'edit' : 'add';
    st.id = editing ? task.id : null;
    st.priority = editing ? task.priority : 'medium';
    var p = editing ? U.parseDue(task.due) : null;
    st.date = p ? p.day : null;
    st.time = p ? p.time : null;
    els.title.textContent = editing ? 'Edit task' : 'New task';
    els.submit.textContent = editing ? 'Save changes' : 'Add task';
    els.input.value = editing ? task.title : '';
    els.date.classList.remove('fallback');
    els.time.classList.remove('fallback');
    renderPriority();
    renderDue();
    onInput();
    if (!st.open) st.returnFocus = document.activeElement;
    st.open = true;
    U.openLayer(els.wrap);
    els.input.focus({ preventScroll: true });
    var end = els.input.value.length;
    els.input.setSelectionRange(end, end);
  }

  function close() {
    if (!st.open) return;
    st.open = false;
    U.closeLayer(els.wrap, 360);
    var back = st.returnFocus;
    st.returnFocus = null;
    if (els.form.contains(document.activeElement)) document.activeElement.blur();
    if (back && back.isConnected && back !== document.body && typeof back.focus === 'function' && !els.form.contains(back)) {
      back.focus({ preventScroll: true });
    }
  }

  function isOpen() { return st.open; }

  /* ------------------------------------------------------------------ save */

  function save() {
    var title = els.input.value.replace(/\s+/g, ' ').trim();
    if (!title) {
      els.input.classList.remove('shake');
      void els.input.offsetWidth;
      els.input.classList.add('shake');
      els.input.focus();
      return;
    }
    var due = st.date ? (st.time ? st.date + 'T' + st.time : st.date) : null;
    var fields = { title: title, priority: st.priority, due: due };
    var mode = st.mode, id = st.id;
    close();
    if (mode === 'edit' && S.get(id)) D.actions.edit(id, fields);
    else D.actions.add(fields);
  }

  /* ----------------------------------------------------------------- input */

  function onInput() {
    var v = els.input.value;
    if (/[\r\n]/.test(v)) {
      var pos = els.input.selectionStart;
      els.input.value = v.replace(/[\r\n]+/g, ' ');
      els.input.setSelectionRange(pos, pos);
    }
    els.input.classList.remove('shake');
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight + 2, 112) + 'px';
    els.submit.classList.toggle('is-disabled', !els.input.value.trim());
  }

  function focusables() {
    return Array.prototype.slice.call(els.form.querySelectorAll('button, textarea, input:not(.picker-input), input.picker-input.fallback'))
      .filter(function (n) { return !n.disabled && n.offsetParent !== null; });
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229) {
      if (e.target === els.close || e.target === els.timeClear) return;
      e.preventDefault();
      save();
      return;
    }
    if (e.key === 'Tab') {
      var f = focusables();
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }

  /* -------------------------------------------------------- priority + due */

  function renderPriority() {
    els.segs.forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.prio === st.priority));
    });
  }

  function dueKind() {
    if (!st.date) return 'none';
    var now = new Date();
    if (st.date === U.dateKey(now)) return 'today';
    if (st.date === U.dateKey(U.addDays(now, 1))) return 'tomorrow';
    return 'pick';
  }

  function onDueChip(kind) {
    var today = new Date();
    if (kind === 'pick') { pickDate(); return; }
    if (kind === dueKind()) { st.date = null; st.time = null; } // tapping the active chip clears it
    else if (kind === 'today') st.date = U.dateKey(today);
    else if (kind === 'tomorrow') st.date = U.dateKey(U.addDays(today, 1));
    renderDue();
  }

  function showPicker(input) {
    try {
      if (typeof input.showPicker !== 'function') throw new Error('no showPicker');
      input.showPicker();
    } catch (err) {
      input.classList.add('fallback');
      input.focus();
    }
  }

  function pickDate() {
    els.date.value = st.date || '';
    showPicker(els.date);
  }

  function pickTime() {
    els.time.value = st.time || '';
    showPicker(els.time);
  }

  function renderDue() {
    var now = new Date();
    var which = dueKind();
    els.chips.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.due === which)); });
    var p = which === 'pick' ? U.parseDue(st.date) : null;
    els.pickLabel.textContent = p ? U.formatDay(p.date, now) : 'Date';
    els.dateClear.classList.toggle('visible', !!st.date);
    var tp = st.time ? U.parseDue(U.dateKey(now) + 'T' + st.time) : null;
    els.timeLabel.textContent = tp ? U.formatTime(tp.date) : 'Add time';
    els.timeChip.setAttribute('aria-pressed', String(!!tp));
    els.timeClear.classList.toggle('visible', !!tp);
  }

  D.sheet = { init: init, open: open, close: close, isOpen: isOpen };
})();
