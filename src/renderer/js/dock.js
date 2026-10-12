(function () {
  'use strict';
  var api = window.dooo, D = window.Dooo, open = false, layout, drag = null, suppressClick = false, frame = 0, ignoring = false;
  function $(id) { return document.getElementById(id); }
  D.hydrateIcons(document);
  function setLayout(value) {
    layout = value;
    var root = document.documentElement;
    ['buttonLeft','buttonTop','panelLeft','panelTop'].forEach(function (key) {
      root.style.setProperty('--' + key.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }), value[key] + 'px');
    });
    document.body.dataset.edge = value.edge; document.body.dataset.side = value.side;
  }
  function setOpen(value) {
    open = value; document.body.classList.toggle('open', open);
    $('edge-toggle').setAttribute('aria-expanded', String(open)); $('edge-toggle').setAttribute('aria-label', open ? 'Close project controls' : 'Open project controls');
    $('dock-menu').inert = !open;
    if (!open && $('dock-menu').contains(document.activeElement)) $('edge-toggle').focus({ preventScroll: true });
    if (!open) {
      $('new-project-form').hidden = true; $('dock-settings').hidden = true;
      $('new-project-toggle').setAttribute('aria-expanded', 'false'); $('settings-toggle').setAttribute('aria-expanded', 'false');
    }
  }
  function showError(err) { $('dock-error').textContent = err.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); $('dock-error').hidden = false; }
  function command(action,value) { return api.desktop(action,value).catch(showError); }
  function ignore(value) { if (ignoring === value) return; ignoring = value; api.window.setIgnoreMouse(value); }
  function render(data) {
    $('always-on-top').setAttribute('aria-pressed', String(!!data.settings.alwaysOnTop));
    $('launch-at-login').setAttribute('aria-pressed', String(!!data.settings.launchAtLogin));
    var existing = new Map(Array.from($('dock-projects').children).map(function (el) { return [el.dataset.projectId, el]; }));
    data.projects.forEach(function (project, i) {
      var button = existing.get(project.id);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'dock-project'; button.dataset.projectId = project.id;
        var dot = document.createElement('span'); dot.className = 'project-dot'; dot.setAttribute('aria-hidden', 'true');
        button.append(D.icon('folder'), dot);
      }
      existing.delete(project.id); button.setAttribute('aria-label', 'Show ' + project.name);
      button.title = project.name + ' · ' + project.done + '/' + project.total + (project.visible ? '' : ' · Hidden');
      button.dataset.visible = String(project.visible);
      button.querySelector('.project-dot').style.backgroundColor = project.color;
      if ($('dock-projects').children[i] !== button) $('dock-projects').insertBefore(button, $('dock-projects').children[i] || null);
    });
    existing.forEach(function (el) { el.remove(); });
  }
  function sendMove(finish) {
    if (!drag || !drag.moved) return;
    command('move-dock', { x: drag.anchor.x + drag.dx, y: drag.anchor.y + drag.dy, finish: !!finish });
  }
  $('edge-toggle').addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || !layout) return;
    drag = { id: e.pointerId, sx: e.screenX, sy: e.screenY, dx: 0, dy: 0, anchor: layout.anchor, moved: false };
    $('edge-toggle').setPointerCapture(e.pointerId); ignore(false);
  });
  $('edge-toggle').addEventListener('pointermove', function (e) {
    if (!drag || drag.id !== e.pointerId) return;
    drag.dx = e.screenX - drag.sx; drag.dy = e.screenY - drag.sy;
    if (Math.abs(drag.dx) + Math.abs(drag.dy) > 5) { drag.moved = true; document.body.classList.add('dragging'); }
    if (drag.moved && !frame) frame = requestAnimationFrame(function () { frame = 0; sendMove(false); });
  });
  function endDrag() {
    if (!drag) return;
    cancelAnimationFrame(frame); frame = 0;
    suppressClick = drag.moved; sendMove(true); drag = null; document.body.classList.remove('dragging');
    setTimeout(function () { suppressClick = false; }, 0);
  }
  $('edge-toggle').addEventListener('pointerup', endDrag);
  $('edge-toggle').addEventListener('pointercancel', endDrag);
  $('edge-toggle').addEventListener('lostpointercapture', endDrag);
  $('edge-toggle').addEventListener('click', function () { if (!suppressClick) command('dock', !open); });
  $('edge-toggle').addEventListener('keydown', function (e) {
    if (!layout || ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(e.key) < 0) return;
    e.preventDefault(); var step = e.shiftKey ? 40 : 10;
    command('move-dock', { x: layout.anchor.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
      y: layout.anchor.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0), finish: true, snap: false });
  });
  $('dock-projects').addEventListener('click', function (e) { var button = e.target.closest('.dock-project'); if (button) command('show-project', button.dataset.projectId); });
  $('dock-projects').addEventListener('wheel', function (e) {
    if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); e.currentTarget.scrollLeft += e.deltaY; }
  }, { passive: false });
  document.querySelector('.dock-actions').addEventListener('click', function (e) { var button = e.target.closest('[data-action]'); if (button) command(button.dataset.action); });
  $('new-project-toggle').addEventListener('click', function () {
    var show = $('new-project-form').hidden; $('new-project-form').hidden = !show;
    $('new-project-toggle').setAttribute('aria-expanded', String(show));
    if (show) { $('dock-settings').hidden = true; $('settings-toggle').setAttribute('aria-expanded','false'); $('new-project-name').focus(); }
  });
  $('settings-toggle').addEventListener('click', function () {
    var show = $('dock-settings').hidden; $('dock-settings').hidden = !show;
    $('settings-toggle').setAttribute('aria-expanded', String(show));
    if (show) { $('new-project-form').hidden = true; $('new-project-toggle').setAttribute('aria-expanded','false'); }
  });
  $('new-project-form').addEventListener('submit', async function (e) {
    e.preventDefault(); if (!$('new-project-name').value.trim()) return;
    try {
      await api.desktop('create', $('new-project-name').value); $('new-project-name').value = '';
      $('new-project-form').hidden = true; $('new-project-toggle').setAttribute('aria-expanded','false');
      $('dock-error').hidden = true; await api.desktop('dock', false);
    } catch (err) { showError(err); }
  });
  $('pair-phone').addEventListener('click', async function () {
    var button = $('pair-phone'); button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { await command('pair-phone'); } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  });
  ['always-on-top', 'launch-at-login'].forEach(function (id, i) {
    $(id).addEventListener('click', function () { var patch = {}; patch[i ? 'launchAtLogin' : 'alwaysOnTop'] = $(id).getAttribute('aria-pressed') !== 'true'; api.updateSettings(patch).catch(showError); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('new-project-form').hidden) { $('new-project-form').hidden = true; $('new-project-toggle').setAttribute('aria-expanded','false'); $('new-project-toggle').focus(); }
    else if (!$('dock-settings').hidden) { $('dock-settings').hidden = true; $('settings-toggle').setAttribute('aria-expanded','false'); $('settings-toggle').focus(); }
    else command('dock', false);
  });
  document.addEventListener('mousemove', function (e) { if (!drag) ignore(!e.target.closest('button,.dock-menu')); }, { passive: true });
  window.addEventListener('pointerdown', function () { ignore(false); }, true);
  api.onDockLayout(setLayout); api.onDockOpen(setOpen); api.onDesktopChanged(render);
  var lastHeight = 0;
  new ResizeObserver(function () {
    // Ignore transforms so opening motion cannot feed back into native window sizing.
    var height = $('dock-menu').offsetHeight;
    if (height !== lastHeight) { lastHeight = height; command('dock-height', height); }
  }).observe($('dock-menu'));
  api.loadState().then(function (data) { render(data); setLayout(data.dockLayout); setOpen(data.dockOpen); document.documentElement.dataset.ready = 'true'; }).catch(showError);
})();
