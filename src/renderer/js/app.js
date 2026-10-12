/* One project per window. Completed rows settle beneath unfinished tasks. */
(function () {
  'use strict';
  var D = window.Dooo, S = D.store, U = D.util, api = window.dooo;
  var state, latest, editing = null, draft = null, undo = null, toastTimer, drag = null, suppressClick = false, rowDrag = null;
  var pendingAi = new Set(), editedDuringAi = new Set();
  function $(id) { return document.getElementById(id); }
  function command(action, value) { return api.desktop(action, value).catch(function (err) { notify(err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }); }
  function notify(message, action) {
    clearTimeout(toastTimer); undo = action || null;
    $('toast-text').textContent = message; $('toast-undo').hidden = !undo; $('toast').hidden = false;
    toastTimer = setTimeout(function () { $('toast').hidden = true; undo = null; }, 4000);
  }
  function readDraft() { return { title: $('task-input').value, priority: $('task-priority').value, date: $('due-date').value, time: $('due-time').value, details: !$('task-details').hidden }; }
  function populate(value) {
    value = value || {};
    $('task-input').value = value.title || ''; $('task-priority').value = value.priority || 'none';
    $('due-date').value = value.date || ''; $('due-time').value = value.time || '';
    details(!!value.details);
    $('edit-cancel').hidden = !editing;
    $('ai-toggle').hidden = !state.aiAvailable || !!editing;
    $('task-submit').replaceChildren(D.icon(editing ? 'check' : 'arrow-up'));
    $('task-submit').setAttribute('aria-label', editing ? 'Save task' : 'Add task');
    $('task-submit').title = editing ? 'Save task' : 'Add task'; inputChanged();
  }
  function details(open) {
    $('task-details').hidden = !open; $('details-toggle').setAttribute('aria-expanded', String(open));
    $('details-toggle').setAttribute('aria-label', open ? 'Hide task details' : 'Task details');
    $('details-toggle').title = open ? 'Hide task details' : 'Task details';
  }
  function inputChanged() {
    $('composer-status').hidden = true;
    var input = $('task-input');
    $('task-submit').hidden = !input.value.trim(); $('task-submit').disabled = !input.value.trim();
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 94) + 'px';
  }
  function edit(task) {
    if (pendingAi.has(task.id)) editedDuringAi.add(task.id);
    if (!editing) draft = readDraft();
    editing = task.id;
    var due = U.parseDue(task.due);
    populate({ title: task.title, priority: task.priority, date: due && due.day, time: due && due.time });
    $('task-input').focus();
  }
  function cancelEdit() { editing = null; populate(draft); draft = null; $('task-input').focus(); }
  function save(e) {
    e.preventDefault();
    var title = $('task-input').value.replace(/\s+/g, ' ').trim();
    if (!title || !$('sheet').reportValidity()) return;
    var day = $('due-date').value || ($('due-time').value ? U.dateKey(new Date()) : '');
    var fields = { title: title, priority: $('task-priority').value, due: day ? day + ($('due-time').value ? 'T' + $('due-time').value : '') : null };
    if (editing) { S.update(editing, fields); cancelEdit(); }
    else {
      var useAi = state.aiAvailable && state.settings.aiRewriteEnabled !== false;
      if (useAi) fields.originalText = title;
      var added = S.add(fields).task;
      populate(); $('task-input').focus();
      if (useAi) simplify(added.id, title);
    }
    render();
  }
  async function simplify(id, original) {
    pendingAi.add(id); render();
    var result;
    try { result = await api.rewriteTask(original); } catch { result = { error: 'unavailable' }; }
    pendingAi.delete(id);
    var task = S.get(id), edited = editedDuringAi.has(id); editedDuringAi.delete(id);
    if (task && !edited && task.title === original && result.title) {
      S.update(id, { title: result.title });
      if (result.title !== original) notify('Task wording simplified', function () { S.update(id, { title: original }); render(); });
    } else if (task && result.error) {
      $('composer-status').textContent = 'AI unavailable · saved your wording'; $('composer-status').hidden = false;
    }
    render();
  }
  function toggle(id) {
    var task = S.get(id), wasDone = task.done;
    var reverse = wasDone ? S.restore(id) : S.complete(id);
    render();
    var row = rowFor(id);
    if (!wasDone && row && !U.reducedMotion()) {
      row.classList.remove('just-completed'); void row.offsetWidth; row.classList.add('just-completed');
    }
    notify(wasDone ? 'Task restored' : 'Task completed', function () { reverse(); render(); });
  }
  function rowFor(id) { return Array.from($('list').children).find(function (el) { return el.dataset.id === id; }); }
  function createRow(task) {
    var row = U.el('div', { class: 'task-row', role: 'listitem', tabindex: '0', 'data-testid': 'task-card' }, [
      U.el('div', { class: 'task-body' }, [U.el('span', { class: 'task-title' }), D.icon('loader', 'ai-working'), U.el('div', { class: 'task-meta' })]),
      U.el('button', { type: 'button', class: 'task-delete icon-btn', 'aria-label': 'Delete task', title: 'Delete task' }, [D.icon('x')]),
      U.el('button', { type: 'button', class: 'task-check', 'data-testid': 'task-toggle' }, [D.icon('check')])
    ]);
    row.dataset.id = task.id;
    return row;
  }
  function render() {
    var tasks = S.tasks.filter(function (t) { return t.projectId === S.activeProjectId; }).sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.done ? (a.completedAt || 0) - (b.completedAt || 0) : 0;
    });
    var done = tasks.filter(function (t) { return t.done; }).length, percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    $('project-name').textContent = state.projects.find(function (p) { return p.id === state.projectId; }).name;
    $('project-subtitle').textContent = tasks.length ? done + ' of ' + tasks.length + ' completed' : 'No tasks yet';
    $('project-toggle').dataset.complete = String(tasks.length > 0 && done === tasks.length);
    $('task-count').textContent = tasks.length + (tasks.length === 1 ? ' Task' : ' Tasks');
    $('progress-number').textContent = percent + '%';
    $('project-progress').setAttribute('aria-label', percent + '% complete');
    $('progress-value').style.stroke = state.color;
    $('progress-value').style.strokeDashoffset = String(100 - percent);
    $('progress-value').style.opacity = percent ? '1' : '0';
    var existing = new Map(Array.from($('list').children).map(function (row) { return [row.dataset.id, row]; }));
    var focused = document.activeElement;
    var positions = new Map(Array.from($('list').children).map(function (row) { return [row.dataset.id, row.getBoundingClientRect().top]; }));
    existing.forEach(function (row) { if (row.moveAnimation) { row.moveAnimation.cancel(); row.moveAnimation = null; } });
    var added = [];
    tasks.forEach(function (task, i) {
      var isNew = !existing.has(task.id);
      var row = existing.get(task.id) || createRow(task); existing.delete(task.id);
      if (isNew) added.push(row);
      row.classList.toggle('is-done', task.done); row.draggable = !task.done;
      row.querySelector('.ai-working').classList.toggle('visible', pendingAi.has(task.id));
      row.setAttribute('aria-busy', String(pendingAi.has(task.id)));
      row.querySelector('.task-title').textContent = task.title;
      row.querySelector('.task-title').title = task.originalText && task.originalText !== task.title ? 'Original: ' + task.originalText : '';
      row.querySelector('.task-check').setAttribute('aria-label', (task.done ? 'Restore: ' : 'Complete: ') + task.title);
      row.querySelector('.task-check').setAttribute('aria-pressed', String(task.done));
      var meta = row.querySelector('.task-meta'); meta.replaceChildren();
      if (task.priority !== 'none') meta.append(U.el('span', { class: 'task-tag prio-' + task.priority }, [task.priority[0].toUpperCase() + task.priority.slice(1)]));
      var due = U.formatDue(task.due);
      if (due) meta.append(U.el('span', { class: due.overdue && !task.done ? 'overdue' : '' }, [due.label]));
      meta.hidden = !meta.childNodes.length;
      if ($('list').children[i] !== row) {
        var next = $('list').children[i] || null;
        if (row.isConnected && $('list').moveBefore) $('list').moveBefore(row, next);
        else $('list').insertBefore(row, next);
      }
    });
    existing.forEach(function (row) { row.remove(); });
    if (focused && focused.isConnected && focused !== document.activeElement) focused.focus({ preventScroll: true });
    if (document.documentElement.dataset.ready === 'true' && !U.reducedMotion()) {
      Array.from($('list').children).forEach(function (row) {
        var top = positions.get(row.dataset.id), dy = top === undefined ? 0 : top - row.getBoundingClientRect().top;
        if (Math.abs(dy) > .5) row.moveAnimation = row.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
      });
      added.forEach(function (row) { row.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' }); });
    }
  }
  function applyState(value) {
    var wasExpanded = state && state.expanded;
    if (state && state.cloudVersion !== value.cloudVersion) S.tasks = value.tasks;
    state = value;
    $('ai-toggle').hidden = !state.aiAvailable || !!editing;
    $('ai-toggle').setAttribute('aria-pressed', String(state.settings.aiRewriteEnabled !== false));
    $('ai-toggle').title = state.settings.aiRewriteEnabled !== false ? 'AI wording on · click to keep your exact words' : 'AI wording off · click to simplify new tasks';
    var folder = (state.settings.projectFolders || {})[state.projectId];
    $('link-folder').title = folder && folder.path ? folder.path + '\nClick to change project folder' : folder && folder.status === 'ambiguous' ? 'Several folders match · choose project folder' : 'Link project folder';
    $('refresh-context').hidden = !folder || !folder.path;
    $('panel').classList.toggle('expanded', !!state.expanded);
    $('project-toggle').setAttribute('aria-expanded', String(!!state.expanded));
    $('task-dropdown').inert = !state.expanded;
    $('resize-grip').hidden = !state.expanded;
    if (!state.expanded) {
      closeMenu();
      if (wasExpanded && $('task-dropdown').contains(document.activeElement)) $('project-toggle').focus({ preventScroll: true });
    }
    render();
  }
  function closeMenu() { $('task-menu').hidden = true; $('task-menu-toggle').setAttribute('aria-expanded', 'false'); }
  function initDrag() {
    var button = $('project-toggle');
    button.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { pointerId: e.pointerId, x: e.screenX, y: e.screenY, dx: 0, dy: 0, moved: false, bounds: null };
      var current = drag; button.setPointerCapture(e.pointerId); D.win.suspend();
      api.window.getBounds().then(function (b) { if (drag === current) drag.bounds = b; });
    });
    button.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.dx = e.screenX - drag.x; drag.dy = e.screenY - drag.y;
      if (Math.abs(drag.dx) + Math.abs(drag.dy) > 5) drag.moved = true;
      if (drag.moved && drag.bounds) api.window.move(drag.bounds.x + drag.dx, drag.bounds.y + drag.dy);
    });
    function end() {
      if (!drag) return;
      suppressClick = drag.moved; drag = null; D.win.resume();
      setTimeout(function () { suppressClick = false; }, 0);
    }
    button.addEventListener('pointerup', end); button.addEventListener('pointercancel', end);
    button.addEventListener('lostpointercapture', end);
    button.addEventListener('click', function () { if (!suppressClick) command('expand', !state.expanded); });
  }
  function boot(data) {
    state = latest || data;
    S.init(Object.assign({}, state, { settings: Object.assign({}, state.settings, { activeProjectId: state.projectId }) }));
    S.activeProjectId = state.projectId;
    D.hydrateIcons(document); D.win.init(); initDrag();
    $('task-input').disabled = false;
    applyState(state); document.documentElement.dataset.ready = 'true';
    S.on('tasks', render);
    $('sheet').addEventListener('submit', save);
    $('task-input').addEventListener('input', inputChanged);
    $('task-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) save(e); });
    $('details-toggle').addEventListener('click', function () { details($('task-details').hidden); });
    $('ai-toggle').addEventListener('click', function () { api.updateSettings({ aiRewriteEnabled: state.settings.aiRewriteEnabled === false }); });
    $('link-folder').addEventListener('click', function () { closeMenu(); command('link-folder'); });
    $('refresh-context').addEventListener('click', function () { closeMenu(); command('refresh-context'); });
    $('details-clear').addEventListener('click', function () { $('task-priority').value = 'none'; $('due-date').value = ''; $('due-time').value = ''; });
    $('edit-cancel').addEventListener('click', cancelEdit);
    $('toast-undo').addEventListener('click', function () { var action = undo; undo = null; $('toast').hidden = true; if (action) action(); });
    $('hide-project').addEventListener('click', function () { command('hide'); });
    $('menu-minimize').addEventListener('click', function () { closeMenu(); command('hide'); });
    $('task-menu-toggle').addEventListener('click', function () {
      var open = $('task-menu').hidden; $('task-menu').hidden = !open; $('task-menu-toggle').setAttribute('aria-expanded', String(open));
      if (open) $('clear-completed').focus();
    });
    $('clear-completed').addEventListener('click', function () { closeMenu(); var result = S.clearDone(); render(); if (result.count) notify('Completed tasks cleared', function () { result.undo(); render(); }); });
    $('rename-project').addEventListener('click', function () { $('rename-form').hidden = false; $('rename-input').value = $('project-name').textContent; $('rename-input').focus(); $('rename-input').select(); });
    $('rename-cancel').addEventListener('click', function () { $('rename-form').hidden = true; });
    $('rename-input').addEventListener('input', function () { $('rename-input').setCustomValidity(''); });
    $('rename-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      try { await api.desktop('rename', $('rename-input').value); $('rename-form').hidden = true; }
      catch (err) { $('rename-input').setCustomValidity('Use a different project name.'); $('rename-input').reportValidity(); }
    });
    $('list').addEventListener('click', function (e) {
      var row = e.target.closest('.task-row');
      if (!row) { $('task-input').focus(); return; }
      if (e.target.closest('.task-check')) toggle(row.dataset.id);
      else if (e.target.closest('.task-delete')) { var action = S.remove(row.dataset.id); render(); notify('Task deleted', function () { action(); render(); }); }
      else edit(S.get(row.dataset.id));
    });
    $('list').addEventListener('keydown', function (e) {
      var row = e.target.closest('.task-row'); if (!row || e.target !== row) return;
      if (e.key === ' ') { e.preventDefault(); toggle(row.dataset.id); }
      if (e.key === 'Enter') { e.preventDefault(); edit(S.get(row.dataset.id)); }
      if (e.key === 'Delete') { var action = S.remove(row.dataset.id); render(); notify('Task deleted', function () { action(); render(); }); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); var direction = e.key === 'ArrowUp' ? -1 : 1;
        if (e.altKey) { var open = S.open(), index = open.findIndex(function (t) { return t.id === row.dataset.id; }); if (index >= 0) { S.moveOpen(row.dataset.id, index + direction); render(); row.focus(); } }
        else { var next = direction > 0 ? row.nextElementSibling : row.previousElementSibling; if (next) next.focus(); }
      }
    });
    $('list').addEventListener('dragstart', function (e) {
      var row = e.target.closest('.task-row'); if (!row || S.get(row.dataset.id).done) { e.preventDefault(); return; }
      rowDrag = row.dataset.id; row.classList.add('dragging'); e.dataTransfer.setData('application/x-dooo-task', rowDrag); e.dataTransfer.effectAllowed = 'move';
    });
    $('list').addEventListener('dragover', function (e) { e.preventDefault(); var row = e.target.closest('.task-row'); document.querySelectorAll('.drag-over').forEach(function (n) { n.classList.remove('drag-over'); }); if (row && rowDrag) row.classList.add('drag-over'); });
    document.addEventListener('dragend', function () { rowDrag = null; document.querySelectorAll('.dragging,.drag-over').forEach(function (n) { n.classList.remove('dragging','drag-over'); }); });
    document.addEventListener('dragover', function (e) { if (e.target !== $('task-input')) e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      if (e.target === $('task-input') && !rowDrag) return;
      e.preventDefault();
      if (rowDrag) {
        var row = e.target.closest('.task-row'), id = rowDrag; rowDrag = null;
        if (row && !S.get(row.dataset.id).done) { var open = S.open(); S.moveOpen(id, open.findIndex(function (t) { return t.id === row.dataset.id; })); render(); }
      } else if (state.expanded && e.dataTransfer && !e.dataTransfer.files.length) {
        var lines = e.dataTransfer.getData('text/plain').split(/\r?\n/).map(function (t) { return t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim(); }).filter(Boolean).slice(0,20);
        if (lines.length) { S.addMany(lines, 'none'); render(); }
      }
      document.querySelectorAll('.dragging,.drag-over').forEach(function (n) { n.classList.remove('dragging','drag-over'); });
    });
    document.addEventListener('pointerdown', function (e) { if (!e.target.closest('#task-menu,#task-menu-toggle')) closeMenu(); });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); command('expand', true).then(function () { $('task-input').focus(); }); }
      if (e.key === 'Escape') { if (!$('task-menu').hidden) closeMenu(); else if (!$('rename-form').hidden) $('rename-form').hidden = true; else if (editing) cancelEdit(); else if (!$('task-details').hidden) details(false); else command('expand', false); }
    });
    setInterval(render, 30000);
  }
  api.onDesktopChanged(function (value) { latest = value; if (document.documentElement.dataset.ready === 'true') applyState(value); });
  api.onVisibility(function (visible) { document.body.classList.toggle('leaving', !visible); });
  api.loadState().then(boot).catch(function (err) { console.error(err); });
})();
