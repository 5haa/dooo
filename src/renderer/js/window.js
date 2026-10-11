/* Dooo: window integration.
 * - Click-through: over the transparent margin (and the panel's rounded corners) the window ignores the mouse, so
 *   clicks reach the desktop; over the panel it takes them again. Called only on state changes, never during a drag
 *   or resize, and any pointerdown / keydown / focus on the page switches it back off (fail safe).
 * - Resize grip: pointer capture, new size = start size + screen delta, at most one setSize per animation frame.
 * - Hide: the small corner badge hides the window to the tray.
 */
(function () {
  'use strict';

  var D = window.Dooo;

  /* Set to false to disable click-through entirely if it misbehaves on a machine. */
  var CLICK_THROUGH = true;

  var ignoring = false;
  var suspended = 0;
  var broken = false;

  function api() { return window.dooo; }

  function setIgnore(v) {
    if (!CLICK_THROUGH || broken || v === ignoring) return;
    ignoring = v;
    // While click-through is on, the panel drops its drag regions: Electron only forwards mouse moves to the page
    // over client (no-drag) areas, so this lets the page see the cursor come back wherever it re-enters the panel.
    document.documentElement.classList.toggle('click-through', v);
    try {
      api().window.setIgnoreMouse(v);
    } catch (err) {
      broken = true;
      ignoring = false;
      document.documentElement.classList.remove('click-through');
      console.warn('Dooo: click-through disabled', err);
    }
  }

  function insidePanel(target) {
    return !!(target && target.closest && target.closest('#panel'));
  }

  function suspend() { suspended++; setIgnore(false); }
  function resume() { suspended = Math.max(0, suspended - 1); }

  /* ------------------------------------------------------------ resize grip */

  var rs = null;

  function applySize() {
    if (!rs) return;
    rs.raf = 0;
    if (!rs.base) return;
    var w = Math.round(rs.base.width + rs.x - rs.sx);
    var h = Math.round(rs.base.height + rs.y - rs.sy);
    var key = w + 'x' + h;
    if (key === rs.last) return;
    rs.last = key;
    try { api().window.setSize(w, h); } catch (err) { console.error('Dooo: resize failed', err); }
  }

  function scheduleSize() {
    if (rs && !rs.raf) rs.raf = requestAnimationFrame(applySize);
  }

  function initGrip(grip) {
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || rs) return;
      e.preventDefault();
      e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      rs = { id: e.pointerId, sx: e.screenX, sy: e.screenY, x: e.screenX, y: e.screenY, base: null, raf: 0, last: '' };
      suspend();
      grip.classList.add('active');
      document.body.classList.add('is-resizing');
      var session = rs;
      Promise.resolve()
        .then(function () { return api().window.getSize(); })
        .then(function (size) {
          return size && size.width ? size : null;
        }, function () { return null; })
        .then(function (size) {
          if (rs !== session) return;
          rs.base = size || { width: window.innerWidth, height: window.innerHeight };
          rs.last = Math.round(rs.base.width) + 'x' + Math.round(rs.base.height);
          scheduleSize();
        });
    });

    grip.addEventListener('pointermove', function (e) {
      if (!rs || e.pointerId !== rs.id) return;
      rs.x = e.screenX;
      rs.y = e.screenY;
      scheduleSize();
    });

    var end = function (e) {
      if (!rs || e.pointerId !== rs.id) return;
      if (e.type === 'pointerup') { rs.x = e.screenX; rs.y = e.screenY; }
      if (rs.raf) cancelAnimationFrame(rs.raf);
      applySize();
      rs = null;
      try { if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      grip.classList.remove('active');
      document.body.classList.remove('is-resizing');
      resume();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
  }

  /* ------------------------------------------------------------------ init */

  function init() {
    document.addEventListener('mousemove', function (e) {
      if (suspended || rs || (D.dnd && D.dnd.isActive())) return;
      setIgnore(!insidePanel(e.target));
    }, { passive: true });

    window.addEventListener('pointerdown', function () { setIgnore(false); }, true);
    window.addEventListener('keydown', function () { setIgnore(false); }, true);
    window.addEventListener('focus', function () { setIgnore(false); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setIgnore(false); });

    initGrip(document.getElementById('resize-grip'));

    document.getElementById('hide-btn').addEventListener('click', function () {
      setIgnore(false);
      try { api().window.hide(); } catch (err) { console.error('Dooo: hide failed', err); }
    });
  }

  D.win = { init: init, suspend: suspend, resume: resume, isIgnoring: function () { return ignoring; } };
})();
