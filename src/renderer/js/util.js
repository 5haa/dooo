/* Dooo: small shared helpers (DOM building, dates, motion). */
(function () {
  'use strict';

  var D = window.Dooo = window.Dooo || {};
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* el('div', { class: 'x', text: 'hi', 'data-id': 1 }, [child, 'text']): user text only ever goes in as text nodes. */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (children) {
      children.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  /* "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local time) -> { date, hasTime, day, time } or null. */
  function parseDue(due) {
    if (typeof due !== 'string') return null;
    var m = DUE_RE.exec(due);
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    var hasTime = m[4] !== undefined;
    var hh = hasTime ? +m[4] : 0, mm = hasTime ? +m[5] : 0;
    if (hh > 23 || mm > 59) return null;
    var date = new Date(y, mo, d, hh, mm);
    if (isNaN(date.getTime()) || date.getMonth() !== mo || date.getDate() !== d) return null;
    return { date: date, hasTime: hasTime, day: m[1] + '-' + m[2] + '-' + m[3], time: hasTime ? m[4] + ':' + m[5] : null };
  }

  function formatTime(date) {
    var h = date.getHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + pad(date.getMinutes()) + ' ' + ap;
  }

  /* "Today", "Tomorrow", "Yesterday", "16 Feb" or "16 Feb 2027". */
  function formatDay(date, now) {
    now = now || new Date();
    var k = dateKey(date);
    if (k === dateKey(now)) return 'Today';
    if (k === dateKey(addDays(now, 1))) return 'Tomorrow';
    if (k === dateKey(addDays(now, -1))) return 'Yesterday';
    var s = date.getDate() + ' ' + MONTHS[date.getMonth()];
    if (date.getFullYear() !== now.getFullYear()) s += ' ' + date.getFullYear();
    return s;
  }

  /* -> { label: "Today - 11:00 PM" | "16 Feb", overdue: boolean } or null when there is no (valid) due date. */
  function formatDue(due, now) {
    now = now || new Date();
    var p = parseDue(due);
    if (!p) return null;
    var label = formatDay(p.date, now) + (p.hasTime ? ' - ' + formatTime(p.date) : '');
    var overdue = p.hasTime ? p.date.getTime() < now.getTime() : p.day < dateKey(now);
    return { label: label, overdue: overdue };
  }

  function formatStamp(ms, now) {
    var d = new Date(ms);
    return formatDay(d, now) + ' - ' + formatTime(d);
  }

  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function reducedMotion() { return !!(motionQuery && motionQuery.matches); }

  /* Duration helper for JS-driven animations. */
  function dur(ms) { return reducedMotion() ? 0 : ms; }

  function stripTestIds(root) {
    if (!root) return;
    if (root.removeAttribute) root.removeAttribute('data-testid');
    if (root.querySelectorAll) {
      var nodes = root.querySelectorAll('[data-testid]');
      for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('data-testid');
    }
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function isEditable(t) {
    return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  }

  /* Overlay layers use display:none when closed (so they never take part in drag-region maths). */
  function openLayer(node) {
    clearTimeout(node._layerTimer);
    if (!node.classList.contains('visible')) {
      node.classList.add('visible');
      void node.offsetWidth; // commit display before the opening transition
    }
    node.classList.add('open');
  }

  function closeLayer(node, ms) {
    node.classList.remove('open');
    clearTimeout(node._layerTimer);
    node._layerTimer = setTimeout(function () { node.classList.remove('visible'); }, dur(ms || 250));
  }

  D.util = {
    MONTHS: MONTHS,
    el: el,
    pad: pad,
    dateKey: dateKey,
    addDays: addDays,
    parseDue: parseDue,
    formatTime: formatTime,
    formatDay: formatDay,
    formatDue: formatDue,
    formatStamp: formatStamp,
    uid: uid,
    reducedMotion: reducedMotion,
    dur: dur,
    stripTestIds: stripTestIds,
    clamp: clamp,
    isEditable: isEditable,
    openLayer: openLayer,
    closeLayer: closeLayer
  };
})();
