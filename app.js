// app.js — all UI and interaction logic

const PROJECT_COLS = [
  { id: 'active',   label: 'Active',   color: 'var(--blue)' },
  { id: 'up-next',  label: 'Up next',  color: 'var(--green)' },
  { id: 'on-deck',  label: 'On deck',  color: 'var(--text-2)' },
  { id: 'on-hold',  label: 'On hold',  color: 'var(--amber)' },
  { id: 'someday',  label: 'Someday',  color: 'var(--purple)' },
];

const TASK_COLS = [
  { id: 'inbox',  label: 'Inbox',  color: 'var(--text-2)' },
  { id: 'next',   label: 'Next',   color: 'var(--green)' },
  { id: 'done',   label: 'Done',   color: 'var(--text-3)' },
];

const App = (() => {
  let view = 'projects';
  let archiveOpen = false;
  let searchOpen = false;
  let searchQuery = '';
  let openItemId = null;
  let dragId = null;
  let dragEl = null;
  let placeholder = null;

  // ── Timer state ──
  const SEQUENCE = [5, 10, 25, 50]; // work intervals in minutes
  const BREAK = 5;
  let timerTask = null;       // active task object
  let timerSeqIdx = 0;        // where in sequence (0-3, then stays at 3)
  let timerPhase = 'idle';    // idle | work | work-paused | break-ready | break | break-done
  let timerSeconds = 0;
  let timerInterval = null;

  // ── Init ──
  function init() {
    Data.load();
    updateDateDisplay();
    setInterval(updateDateDisplay, 60000);
    render();
    renderTimer();

    // Warn before closing/refreshing if there are unsaved changes
    window.addEventListener('beforeunload', e => {
      // Auto-save fires immediately so localStorage is always current,
      // but we still warn so the user knows closing is safe
      Data.saveNow();
      // Only show native dialog if somehow still dirty
      if (Data.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Also save immediately when page visibility changes (phone switching apps)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') Data.saveNow();
    });
  }

  function updateDateDisplay() {
    const el = document.getElementById('date-display');
    if (!el) return;
    el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function render() { renderBoard(); }

  // ── View switching ──
  function switchView(v) {
    view = v;
    archiveOpen = false;
    document.getElementById('tab-projects').classList.toggle('active', v === 'projects');
    document.getElementById('tab-tasks').classList.toggle('active', v === 'tasks');
    document.getElementById('add-label').textContent = v === 'projects' ? 'Add project' : 'Add task';
    renderBoard();
  }

  // ── Export / Import ──
  function exportData() {
    Data.saveNow();
    const blob = new Blob([JSON.stringify(Data.get(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `gf-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    dismissBanner();
  }

  function importData() {
    document.getElementById('import-file').click();
  }

  function onImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.projects || !data.tasks) throw new Error('Invalid format');
        showConfirmModal(
          'Import backup?',
          'This will replace your current data with the backup file. Your existing data will be overwritten.',
          'Import',
          () => {
            Data.replaceAll(data);
            renderBoard();
          }
        );
      } catch(err) {
        alert('Invalid backup file. Please use a file exported from Grind & Flow.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function dismissBanner() {
    const b = document.getElementById('save-banner');
    if (b) b.style.display = 'none';
  }

  // ── Board rendering ──
  function renderBoard() {
    const board = document.getElementById('board');
    if (archiveOpen) { renderArchive(board); return; }

    const cols = view === 'projects' ? PROJECT_COLS : TASK_COLS;
    const state = Data.get();
    let items = view === 'projects' ? state.projects : state.tasks;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.notes || '').toLowerCase().includes(q) ||
        (i.parentProject && (Data.findProject(i.parentProject)?.title || '').toLowerCase().includes(q))
      );
    }

    board.innerHTML = cols.map(col => {
      const colItems = items.filter(i => i.status === col.id);
      return `<div class="column" data-col="${col.id}"
        ondragover="App._onDragOver(event,'${col.id}')"
        ondragleave="App._onDragLeave(event)"
        ondrop="App._onDrop(event,'${col.id}')">
        <div class="col-header">
          <div class="col-title" style="color:${col.color}">${col.label}</div>
          <div class="col-meta">${colItems.length} item${colItems.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="col-body" data-col="${col.id}">
          ${colItems.map(i => renderCard(i)).join('')}
          <button class="add-col-btn" onclick="App.openNewModal('${col.id}')">+ add</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderArchive(board) {
    const state = Data.get();
    const archive = (state.archive || []).filter(i =>
      view === 'projects' ? i.type === 'project' : (i.type === 'task' || i.type === 'standalone')
    );
    if (!archive.length) {
      board.innerHTML = `<div style="padding:40px;color:var(--text-3);font-size:13px;">No archived ${view} yet.</div>`;
      return;
    }
    board.innerHTML = `<div class="column" style="width:100%;max-width:560px;max-height:calc(100vh - 110px);">
      <div class="archive-header">Archive — ${view}</div>
      <div class="archive-list">
        ${archive.map(item => `
          <div class="archive-item">
            <span class="archive-item-title">${esc(item.title)}</span>
            <span class="archive-item-date">${item.archivedAt || ''}</span>
            <button class="restore-btn" onclick="App.restoreItem('${item.id}')">restore</button>
            <button class="st-del" onclick="App.deleteArchiveItem('${item.id}')">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  function renderCard(item) {
    const allCols = [...PROJECT_COLS, ...TASK_COLS];
    const col = allCols.find(c => c.id === item.status);
    const accentColor = col ? col.color : 'var(--text-3)';

    let badges = '';
    if (item.blocked) badges += `<span class="badge badge-coral">blocked</span>`;
    if (item.dueDate) {
      const over = isOverdue(item.dueDate);
      badges += `<span class="badge ${over ? 'badge-red' : 'badge-amber'}">${over ? 'overdue' : 'due'} ${fmtDate(item.dueDate)}</span>`;
    }
    if (item.scheduledDate) badges += `<span class="badge badge-green">→ ${fmtDate(item.scheduledDate)}</span>`;

    let ageDot = '';
    if (item.type !== 'project') {
      const d = daysDiff(item.dateAdded);
      if (d > 30) ageDot = `<span class="age-dot old" title="${d} days in list"></span>`;
      else if (d > 14) ageDot = `<span class="age-dot stale" title="${d} days in list"></span>`;
    }

    let subtaskRow = '';
    if (item.subtasks && item.subtasks.length) {
      const done = item.subtasks.filter(s => s.done).length;
      const pct = Math.round((done / item.subtasks.length) * 100);
      subtaskRow = `<div class="subtask-row">
        <span class="subtask-label">${done}/${item.subtasks.length}</span>
        <div class="subtask-bar"><div class="subtask-fill" style="width:${pct}%"></div></div>
      </div>`;
    }

    const projectLink = item.parentProject
      ? `<div class="project-link">↳ ${esc(Data.findProject(item.parentProject)?.title || '')}</div>` : '';
    const meta = (badges || ageDot) ? `<div class="card-meta">${badges}${ageDot}</div>` : '';

    const isActive = timerTask && timerTask.id === item.id;
    const isNextTask = item.status === 'next' && (item.type === 'task' || item.type === 'standalone');
    const focusBtn = isNextTask && !isActive
      ? `<button class="focus-btn" onclick="event.stopPropagation();App.activateTask('${item.id}')">focus →</button>` : '';
    const activeClass = isActive ? ' card-active' : '';

    return `<div class="card${activeClass}" style="--card-accent:${accentColor}" draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)"
      onclick="App.openDetail('${item.id}')">
      <div class="card-title">${esc(item.title)}</div>
      ${projectLink}${meta}${subtaskRow}
      ${focusBtn}
    </div>`;
  }

  // ── Archive ──
  function toggleArchive() {
    archiveOpen = !archiveOpen;
    document.getElementById('archive-btn').style.color = archiveOpen ? 'var(--blue)' : '';
    renderBoard();
  }
  function restoreItem(id) { Data.restoreFromArchive(id); renderBoard(); }
  function deleteArchiveItem(id) { Data.deleteFromArchive(id); renderBoard(); }

  // ── Search ──
  function toggleSearch() {
    searchOpen = !searchOpen;
    const wrap = document.getElementById('search-bar-wrap');
    wrap.style.display = searchOpen ? 'flex' : 'none';
    if (searchOpen) setTimeout(() => document.getElementById('search-input')?.focus(), 50);
    else { searchQuery = ''; renderBoard(); }
  }
  function onSearch(val) { searchQuery = val; renderBoard(); }

  // ── Detail modal ──
  function openDetail(id) {
    const item = Data.findItem(id);
    if (!item) return;
    openItemId = id;
    const isProject = item.type === 'project';
    const cols = isProject ? PROJECT_COLS : TASK_COLS;

    const moveBtns = cols.map(c =>
      `<button class="move-btn ${item.status === c.id ? 'current' : ''}"
        style="${item.status === c.id ? '' : `color:${c.color}`}"
        onclick="App._moveItem('${id}','${c.id}',this)">${c.label}</button>`
    ).join('');

    const projectLinkHtml = (!isProject && item.parentProject)
      ? `<div class="fg"><label class="label">Project</label>
         <div style="font-size:13px;color:var(--text-2);padding:6px 0;">${esc(Data.findProject(item.parentProject)?.title || '—')}</div></div>`
      : '';

    const subtaskHtml = isProject ? buildSubtaskEditor(item) : '';

    showModal(`
      <div class="modal-title">${esc(item.title)}</div>
      <div class="section">
        <label class="label">Move to</label>
        <div class="move-row">${moveBtns}</div>
      </div>
      <div class="section">
        <div class="fg"><label class="label">Title</label>
          <input type="text" id="d-title" value="${esc(item.title)}" /></div>
        ${projectLinkHtml}
        <div class="field-row">
          <div class="fg"><label class="label">Due date</label>
            <input type="date" id="d-due" value="${item.dueDate || ''}" /></div>
          <div class="fg"><label class="label">Scheduled</label>
            <input type="date" id="d-sched" value="${item.scheduledDate || ''}" /></div>
        </div>
        <div class="fg"><label class="label">Notes</label>
          <textarea id="d-notes">${esc(item.notes || '')}</textarea></div>
        <div class="fg">
          <label class="label">Blocked?</label>
          <div class="seg blocked-seg">
            <button class="seg-opt ${!item.blocked ? 'active-no' : ''}" id="bno" onclick="App._setBlocked('${id}',false)">✓ Clear</button>
            <button class="seg-opt ${item.blocked ? 'active-yes' : ''}" id="byes" onclick="App._setBlocked('${id}',true)">⏸ Blocked</button>
          </div>
        </div>
      </div>
      ${subtaskHtml}
      <div class="modal-footer">
        <div id="del-zone"><button class="btn-danger" onclick="App._showDelConfirm('${id}')">Delete</button></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="App._closeDetail()">Close</button>
        </div>
      </div>`, id);
  }

  function buildSubtaskEditor(item) {
    const rows = (item.subtasks || []).map(st => buildSubtaskRow(st, item.id)).join('');
    return `<div class="section">
      <label class="label">Subtasks <span class="label-hint">promote to send to your task board · drag to reorder</span></label>
      <div class="subtask-list" id="stlist-${item.id}"
        ondragover="App._stListDragOver(event,'${item.id}')"
        ondrop="App._stListDrop(event,'${item.id}')">
        ${rows || '<div style="font-size:12px;color:var(--text-3);padding:4px 0;">No subtasks yet</div>'}
      </div>
      <div class="add-st-row">
        <input type="text" id="new-st-${item.id}" placeholder="Add subtask..."
          onkeydown="if(event.key==='Enter')App._addSubtask('${item.id}')" />
        <button onclick="App._addSubtask('${item.id}')">+ add</button>
      </div>
    </div>`;
  }

  function _closeDetail() {
    if (openItemId) { _autoSave(openItemId); openItemId = null; }
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  function _autoSave(id) {
    const item = Data.findItem(id);
    if (!item) return;
    const t = document.getElementById('d-title');
    const d = document.getElementById('d-due');
    const s = document.getElementById('d-sched');
    const n = document.getElementById('d-notes');
    if (t && t.value.trim()) item.title = t.value.trim();
    if (d) item.dueDate = d.value || '';
    if (s) item.scheduledDate = s.value || '';
    if (n) item.notes = n.value || '';
    if (item.type === 'project') Data.upsertProject(item);
    else Data.upsertTask(item);
  }

  function _setBlocked(id, val) {
    const item = Data.findItem(id);
    if (item) { item.blocked = val; Data.save(); }
    const bno = document.getElementById('bno');
    const byes = document.getElementById('byes');
    if (bno) bno.className = 'seg-opt' + (!val ? ' active-no' : '');
    if (byes) byes.className = 'seg-opt' + (val ? ' active-yes' : '');
  }

  function _moveItem(id, status, btn) {
    const item = Data.findItem(id);
    if (item) { item.status = status; Data.save(); }
    document.querySelectorAll('.move-btn').forEach(b => b.classList.remove('current'));
    if (btn) btn.classList.add('current');
    renderBoard();
  }

  function _showDelConfirm(id) {
    document.getElementById('del-zone').innerHTML = `
      <div class="del-confirm">
        <span>Sure?</span>
        <button class="btn-danger-confirm" onclick="App._deleteItem('${id}')">Delete</button>
        <button class="btn-close" onclick="App._resetDelZone('${id}')">Cancel</button>
      </div>`;
  }

  function _resetDelZone(id) {
    document.getElementById('del-zone').innerHTML =
      `<button class="btn-danger" onclick="App._showDelConfirm('${id}')">Delete</button>`;
  }

  function _deleteItem(id) {
    Data.deleteItem(id);
    openItemId = null;
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  // ── Subtask actions ──
  function _toggleSubtask(projId, stId, checked) {
    const proj = Data.findProject(projId);
    if (!proj) return;
    const st = proj.subtasks.find(s => s.id === stId);
    if (st) { st.done = checked; Data.save(); }
    const span = document.getElementById('stspan-' + stId);
    if (span) span.className = 'st-title' + (checked ? ' done' : '');
    renderBoard();
  }

  function _promoteSubtask(projId, stId) {
    const proj = Data.findProject(projId);
    if (!proj) return;
    const st = proj.subtasks.find(s => s.id === stId);
    if (!st || st.promoted) return;
    st.promoted = true;
    Data.upsertTask({
      id: 't' + Date.now(), type: 'task', title: st.title,
      status: 'inbox', parentProject: projId,
      dueDate: '', scheduledDate: '', notes: '',
      dateAdded: today(), blocked: false
    });
    const btn = document.getElementById('promote-' + stId);
    if (btn) { btn.textContent = '✓ on task board'; btn.className = 'promote-btn done-state'; btn.disabled = true; btn.nextElementSibling?.remove(); }
    renderBoard();
  }

  function _addSubtask(projId) {
    const input = document.getElementById('new-st-' + projId);
    const title = input?.value.trim();
    if (!title) return;
    const proj = Data.findProject(projId);
    if (!proj) return;
    const st = { id: 'st' + Date.now(), title, done: false, promoted: false };
    proj.subtasks.push(st);
    Data.save();
    input.value = '';
    const list = document.getElementById('stlist-' + projId);
    if (list) {
      list.insertAdjacentHTML('beforeend', buildSubtaskRow(st, projId));
    }
    input.focus();
    renderBoard();
  }

  function _removeSubtask(projId, stId) {
    const proj = Data.findProject(projId);
    if (!proj) return;
    proj.subtasks = proj.subtasks.filter(s => s.id !== stId);
    Data.save();
    document.getElementById('sti-' + stId)?.remove();
    renderBoard();
  }

  // ── New item modal ──
  let _newType = 'standalone';

  function openNewModal(defaultStatus) {
    openItemId = null;
    _newType = 'standalone';
    const cols = view === 'projects' ? PROJECT_COLS : TASK_COLS;
    const statusOpts = cols.map(c =>
      `<option value="${c.id}" ${c.id === defaultStatus ? 'selected' : ''}>${c.label}</option>`
    ).join('');
    const projOpts = Data.get().projects.map(p =>
      `<option value="${p.id}">${esc(p.title)}</option>`
    ).join('');

    const taskExtra = view === 'tasks' ? `
      <div class="fg"><label class="label">Type</label>
        <div class="seg" id="type-seg">
          <button class="seg-opt active" data-t="standalone" onclick="App._setNewType('standalone',this)">Standalone</button>
          <button class="seg-opt" data-t="task" onclick="App._setNewType('task',this)">Linked to project</button>
        </div>
      </div>
      <div class="fg" id="proj-link-group" style="display:none">
        <label class="label">Project</label>
        <select id="f-parent">${projOpts}</select>
      </div>` : '';

    showModal(`
      <div class="modal-title">New ${view === 'projects' ? 'project' : 'task'}</div>
      <div class="fg"><label class="label">Title</label>
        <input type="text" id="f-title" placeholder="Name..." /></div>
      ${taskExtra}
      <div class="fg"><label class="label">Status</label>
        <select id="f-status">${statusOpts}</select></div>
      <div class="field-row">
        <div class="fg"><label class="label">Due date</label>
          <input type="date" id="f-due" /></div>
        <div class="fg"><label class="label">Scheduled</label>
          <input type="date" id="f-sched" /></div>
      </div>
      <div class="fg"><label class="label">Notes</label>
        <textarea id="f-notes" placeholder="Optional..."></textarea></div>
      <div class="modal-footer">
        <div></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="App._cancelNew()">Cancel</button>
          <button class="btn-primary" onclick="App._saveNew()">Add</button>
        </div>
      </div>`, null);
    setTimeout(() => document.getElementById('f-title')?.focus(), 50);
  }

  function _setNewType(t, btn) {
    _newType = t;
    document.querySelectorAll('#type-seg .seg-opt').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    document.getElementById('proj-link-group').style.display = t === 'task' ? '' : 'none';
  }

  function _cancelNew() { document.getElementById('modal-root').innerHTML = ''; }

  function _saveNew() {
    const title = document.getElementById('f-title')?.value.trim();
    if (!title) return;
    const status = document.getElementById('f-status')?.value;
    const due = document.getElementById('f-due')?.value || '';
    const sched = document.getElementById('f-sched')?.value || '';
    const notes = document.getElementById('f-notes')?.value || '';
    const id = (view === 'projects' ? 'p' : 't') + Date.now();
    if (view === 'projects') {
      Data.upsertProject({ id, type: 'project', title, status, dueDate: due, scheduledDate: sched, notes, dateAdded: today(), subtasks: [], blocked: false });
    } else {
      const parent = _newType === 'task' ? (document.getElementById('f-parent')?.value || null) : null;
      Data.upsertTask({ id, type: _newType, title, status, parentProject: parent, dueDate: due, scheduledDate: sched, notes, dateAdded: today(), blocked: false });
    }
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  // ── Confirm modal ──
  function showConfirmModal(title, message, confirmLabel, onConfirm) {
    showModal(`
      <div class="modal-title">${title}</div>
      <p style="font-size:13px;color:var(--text-2);line-height:1.6;margin-bottom:20px;">${message}</p>
      <div class="modal-footer">
        <div></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn-primary" onclick="(${onConfirm.toString()})();document.getElementById('modal-root').innerHTML='';">${confirmLabel}</button>
        </div>
      </div>`, null);
  }

  // ── Modal helper ──
  function showModal(content, itemId) {
    openItemId = itemId || null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay" id="moverlay"><div class="modal">${content}</div></div>`;
    document.getElementById('moverlay').addEventListener('click', e => {
      if (e.target.id === 'moverlay') {
        if (openItemId) _closeDetail();
        else document.getElementById('modal-root').innerHTML = '';
      }
    });
  }

  // ── Drag & drop ──
  function _onDragStart(e, id) {
    dragId = id; dragEl = e.currentTarget;
    setTimeout(() => dragEl?.classList.add('is-dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  }

  function _onDragEnd(e) {
    dragEl?.classList.remove('is-dragging');
    placeholder?.remove(); placeholder = null;
    document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
    dragId = null; dragEl = null;
  }

  function _onDragOver(e, colId) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
    if (!placeholder) { placeholder = document.createElement('div'); placeholder.className = 'drag-placeholder'; }
    const body = e.currentTarget.querySelector('.col-body');
    const after = _dragAfterEl(body, e.clientY);
    if (after) body.insertBefore(placeholder, after);
    else { body.insertBefore(placeholder, body.querySelector('.add-col-btn')); }
  }

  function _onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

  function _dragAfterEl(container, y) {
    return [...container.querySelectorAll('.card:not(.is-dragging)')].reduce((closest, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      return (offset < 0 && offset > closest.offset) ? { offset, element: el } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function _onDrop(e, colId) {
    e.preventDefault();
    if (!dragId) return;
    const item = Data.findItem(dragId);
    if (item) { item.status = colId; Data.save(); }
    placeholder?.remove(); placeholder = null;
    document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
    renderBoard();
  }

  // ── Subtask drag reorder ──
  // Uses container-level dragover + Y coordinate, same pattern as card drag
  let stDragId = null;
  let stProjId = null;
  let stPlaceholder = null;
  let stDragEl = null;

  function _stDragStart(e, projId, stId) {
    stDragId = stId;
    stProjId = projId;
    stDragEl = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => stDragEl?.classList.add('is-dragging'), 0);
  }

  function _stDragEnd(e) {
    stDragEl?.classList.remove('is-dragging');
    stPlaceholder?.remove(); stPlaceholder = null;
    stDragId = null; stProjId = null; stDragEl = null;
  }

  // Called on the list container, not individual items
  function _stListDragOver(e, projId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!stPlaceholder) {
      stPlaceholder = document.createElement('div');
      stPlaceholder.className = 'st-placeholder';
    }
    const list = document.getElementById('stlist-' + projId);
    if (!list) return;
    const afterEl = _stAfterElement(list, e.clientY);
    if (afterEl) list.insertBefore(stPlaceholder, afterEl);
    else list.appendChild(stPlaceholder);
  }

  function _stListDrop(e, projId) {
    e.preventDefault();
    if (!stDragId) return;
    const proj = Data.findProject(projId);
    if (!proj) return;
    const list = document.getElementById('stlist-' + projId);
    if (!list) return;

    // Figure out new index from placeholder position
    const items = [...list.querySelectorAll('.st-item')];
    const placeholderIdx = [...list.children].indexOf(stPlaceholder);
    const itemsBefore = [...list.children].slice(0, placeholderIdx).filter(el => el.classList.contains('st-item'));
    const newIdx = itemsBefore.length;

    const fromIdx = proj.subtasks.findIndex(s => s.id === stDragId);
    if (fromIdx < 0) { stPlaceholder?.remove(); stPlaceholder = null; return; }

    const [moved] = proj.subtasks.splice(fromIdx, 1);
    const insertAt = newIdx > fromIdx ? newIdx - 1 : newIdx;
    proj.subtasks.splice(insertAt, 0, moved);
    Data.save();

    stPlaceholder?.remove(); stPlaceholder = null;
    list.innerHTML = proj.subtasks.map(st => buildSubtaskRow(st, projId)).join('');
  }

  function _stAfterElement(container, y) {
    const draggables = [...container.querySelectorAll('.st-item:not(.is-dragging)')];
    return draggables.reduce((closest, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: el };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function buildSubtaskRow(st, projId) {
    return `<div class="st-item" id="sti-${st.id}" draggable="true"
      ondragstart="App._stDragStart(event,'${projId}','${st.id}')"
      ondragend="App._stDragEnd(event)">
      <span class="st-handle" title="Drag to reorder">⠿</span>
      <input type="checkbox" ${st.done ? 'checked' : ''} ${st.promoted ? 'disabled' : ''}
        onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
      <span class="st-title ${st.done ? 'done' : ''}" id="stspan-${st.id}">${esc(st.title)}</span>
      <button id="promote-${st.id}" class="promote-btn ${st.promoted ? 'done-state' : ''}"
        ${st.promoted ? 'disabled' : ''}
        onclick="App._promoteSubtask('${projId}','${st.id}')">
        ${st.promoted ? '✓ on task board' : '→ task board'}
      </button>
      ${!st.promoted ? `<button class="st-del" onclick="App._removeSubtask('${projId}','${st.id}')">✕</button>` : ''}
    </div>`;
  }

  // ── Timer ──
  function timerWorkMins() { return SEQUENCE[Math.min(timerSeqIdx, SEQUENCE.length - 1)]; }

  function activateTask(id) {
    const item = Data.findItem(id);
    if (!item) return;
    // If same task already active, just start work interval
    if (timerTask && timerTask.id === id) {
      _startWorkInterval();
      return;
    }
    clearInterval(timerInterval); timerInterval = null;
    timerTask = item;
    timerSeqIdx = 0;
    timerSeconds = timerWorkMins() * 60;
    timerPhase = 'work';
    timerInterval = setInterval(timerTick, 1000);
    renderTimer();
    renderBoard();
  }

  function endSession(action) {
    clearInterval(timerInterval); timerInterval = null;
    if (action === 'done' && timerTask) {
      const item = Data.findItem(timerTask.id);
      if (item) { item.status = 'done'; Data.save(); }
    } else if (action === 'next' && timerTask) {
      const item = Data.findItem(timerTask.id);
      if (item && item.status !== 'next') { item.status = 'next'; Data.save(); }
    }
    timerTask = null; timerPhase = 'idle';
    timerSeqIdx = 0; timerSeconds = 0;
    renderTimer(); renderBoard();
  }

  // Click a work dot — jump to that interval and start immediately
  function timerClickWorkDot(idx) {
    if (!timerTask) return;
    clearInterval(timerInterval); timerInterval = null;
    timerSeqIdx = idx;
    timerSeconds = timerWorkMins() * 60;
    timerPhase = 'work';
    timerInterval = setInterval(timerTick, 1000);
    renderTimer();
  }

  // Click the break dot — start break immediately
  function timerClickBreakDot() {
    if (!timerTask) return;
    clearInterval(timerInterval); timerInterval = null;
    timerSeconds = BREAK * 60;
    timerPhase = 'break';
    timerInterval = setInterval(timerTick, 1000);
    renderTimer();
  }

  function timerTogglePlay() {
    if (timerPhase === 'work') {
      clearInterval(timerInterval); timerInterval = null;
      timerPhase = 'work-paused';
    } else if (timerPhase === 'work-paused') {
      timerPhase = 'work';
      timerInterval = setInterval(timerTick, 1000);
    } else if (timerPhase === 'break') {
      clearInterval(timerInterval); timerInterval = null;
      timerPhase = 'break-paused';
    } else if (timerPhase === 'break-paused') {
      timerPhase = 'break';
      timerInterval = setInterval(timerTick, 1000);
    }
    renderTimer();
  }

  function _startWorkInterval() {
    clearInterval(timerInterval); timerInterval = null;
    timerSeconds = timerWorkMins() * 60;
    timerPhase = 'work';
    timerInterval = setInterval(timerTick, 1000);
    renderTimer();
  }

  function timerTick() {
    if (timerSeconds > 0) {
      timerSeconds--;
      renderTimerDisplay();
    } else {
      clearInterval(timerInterval); timerInterval = null;
      playChime();
      if (timerPhase === 'work') {
        timerPhase = 'break-ready';
      } else if (timerPhase === 'break') {
        // After break: advance sequence, wait for user to click dot
        if (timerSeqIdx < SEQUENCE.length - 1) timerSeqIdx++;
        timerPhase = 'break-done';
        timerSeconds = timerWorkMins() * 60;
      }
      renderTimer();
    }
  }

  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const freqs = [220, 440, 660, 880];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        const vol = 0.18 / (i + 1);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 3.5);
      });
    } catch(e) {}
  }

  function fmtTimer(secs) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function timerBarClass() {
    if (timerPhase === 'break' || timerPhase === 'break-paused' || timerPhase === 'break-ready') return 'timer-bar break-active';
    if (timerPhase === 'break-done') return 'timer-bar break-done';
    return 'timer-bar';
  }

  function renderTimerDisplay() {
    const el = document.getElementById('timer-countdown');
    if (el) el.textContent = fmtTimer(timerSeconds);
    const total = (timerPhase === 'break' || timerPhase === 'break-paused') ? BREAK * 60 : timerWorkMins() * 60;
    const pct = total > 0 ? 1 - (timerSeconds / total) : 0;
    const arc = document.getElementById('timer-arc');
    if (arc) {
      const circ = 2 * Math.PI * 16;
      arc.style.strokeDashoffset = circ * (1 - pct);
    }
  }

  function renderTimer() {
    const bar = document.getElementById('timer-bar');
    if (!bar) return;

    const r = 16;
    const circ = 2 * Math.PI * r;
    const isBreakPhase = timerPhase === 'break' || timerPhase === 'break-paused' || timerPhase === 'break-ready';
    const total = isBreakPhase ? BREAK * 60 : timerWorkMins() * 60;
    const pct = total > 0 ? 1 - (timerSeconds / total) : 0;
    const offset = circ * (1 - pct);

    // Build interleaved dots: work dot, break dot, work dot, break dot...
    // Break dot is clickable only when relevant (just finished a work interval)
    const isRunning = timerPhase === 'work' || timerPhase === 'break' || timerPhase === 'break-paused';
    const isPaused = timerPhase === 'work-paused';

    let dots = '';
    SEQUENCE.forEach((m, i) => {
      const workState = i < timerSeqIdx ? 'done'
        : i === timerSeqIdx && !isBreakPhase ? 'current'
        : 'future';
      dots += `<button class="seq-dot seq-work seq-${workState}" onclick="App.timerClickWorkDot(${i})" title="Start ${m}min work">${m}</button>`;
      // Break dot after each work dot except the last
      // Show break dot as active when we're in a break phase and this is the current work idx
      if (i < SEQUENCE.length) {
        const breakCurrent = isBreakPhase && i === timerSeqIdx;
        const breakDone = i < timerSeqIdx;
        const breakState = breakCurrent ? 'current' : breakDone ? 'done' : 'future';
        dots += `<button class="seq-dot seq-break seq-break-${breakState}" onclick="App.timerClickBreakDot()" title="Start ${BREAK}min break">·</button>`;
      }
    });

    // Play/pause button
    let playPause = '';
    if (timerTask) {
      if (timerPhase === 'work') {
        playPause = `<button class="tbtn tbtn-playpause" onclick="App.timerTogglePlay()">⏸</button>`;
      } else if (timerPhase === 'work-paused' || timerPhase === 'break-paused') {
        playPause = `<button class="tbtn tbtn-playpause tbtn-primary" onclick="App.timerTogglePlay()">▶</button>`;
      } else if (timerPhase === 'break') {
        playPause = `<button class="tbtn tbtn-playpause" onclick="App.timerTogglePlay()">⏸</button>`;
      } else if (timerPhase === 'break-ready') {
        playPause = `<button class="tbtn tbtn-playpause tbtn-break pulse-btn" onclick="App.timerClickBreakDot()">▶</button>`;
      } else if (timerPhase === 'break-done') {
        playPause = `<button class="tbtn tbtn-playpause tbtn-urgent pulse-btn" onclick="App.timerClickWorkDot(${timerSeqIdx})">▶</button>`;
      }
    }

    // Phase label
    let phaseLabel = '';
    if (!timerTask) {
      phaseLabel = `<span class="timer-phase idle-label">No active task — start one from Next or drag a card here</span>`;
    } else {
      const taskName = `<span class="timer-task-name">${esc(timerTask.title)}</span>`;
      if (timerPhase === 'work') phaseLabel = `<span class="timer-phase work-label">Working</span> — ${taskName}`;
      else if (timerPhase === 'work-paused') phaseLabel = `<span class="timer-phase paused-label">Paused</span> — ${taskName}`;
      else if (timerPhase === 'break-ready') phaseLabel = `<span class="timer-phase break-label">Break time — tap · to start</span>`;
      else if (timerPhase === 'break' || timerPhase === 'break-paused') phaseLabel = `<span class="timer-phase break-label">Break</span> — ${taskName}`;
      else if (timerPhase === 'break-done') phaseLabel = `<span class="timer-phase back-label">Back to work — tap a dot to start</span>`;
    }

    const sessionControls = timerTask ? `
      <div class="timer-session-actions">
        <button class="tbtn tbtn-done" onclick="App.endSession('done')">✓ Done</button>
        <button class="tbtn tbtn-next" onclick="App.endSession('next')">→ Next</button>
      </div>` : '';

    bar.className = timerBarClass();
    bar.innerHTML = `
      <div class="timer-left">
        <svg class="timer-ring" width="42" height="42" viewBox="0 0 42 42">
          <circle cx="21" cy="21" r="${r}" fill="none" stroke="var(--timer-ring-bg)" stroke-width="3"/>
          <circle id="timer-arc" cx="21" cy="21" r="${r}" fill="none" stroke="var(--timer-ring-fg)"
            stroke-width="3" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
            transform="rotate(-90 21 21)" style="transition:stroke-dashoffset 0.9s linear"/>
        </svg>
        <span id="timer-countdown" class="timer-countdown">${fmtTimer(timerSeconds)}</span>
        ${playPause}
      </div>
      <div class="timer-mid">
        <div class="timer-seq">${dots}</div>
        <div class="timer-info">${phaseLabel}</div>
      </div>
      <div class="timer-right">
        ${sessionControls}
      </div>`;
  }

    // Drop onto timer bar
  function _timerDragOver(e) {
    e.preventDefault();
    document.getElementById('timer-bar')?.classList.add('timer-drop-target');
  }
  function _timerDragLeave(e) {
    document.getElementById('timer-bar')?.classList.remove('timer-drop-target');
  }
  function _timerDrop(e) {
    e.preventDefault();
    document.getElementById('timer-bar')?.classList.remove('timer-drop-target');
    if (!dragId) return;
    const item = Data.findItem(dragId);
    if (item && (item.type === 'task' || item.type === 'standalone')) {
      activateTask(dragId);
    }
  }

  // ── Helpers ──
  function today() { return new Date().toISOString().split('T')[0]; }
  function daysDiff(ds) { if (!ds) return 0; return Math.floor((new Date() - new Date(ds)) / 86400000); }
  function isOverdue(ds) { if (!ds) return false; return new Date(ds) < new Date(new Date().toDateString()); }
  function fmtDate(ds) { if (!ds) return ''; return new Date(ds).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    init, switchView, toggleArchive, toggleSearch, onSearch,
    openDetail, openNewModal,
    exportData, importData, onImportFile, dismissBanner,
    restoreItem, deleteArchiveItem,
    activateTask, endSession,
    timerClickWorkDot, timerClickBreakDot, timerTogglePlay,
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
    _timerDragOver, _timerDragLeave, _timerDrop,
    _closeDetail, _autoSave, _setBlocked, _moveItem,
    _showDelConfirm, _resetDelZone, _deleteItem,
    _toggleSubtask, _promoteSubtask, _addSubtask, _removeSubtask,
    _setNewType, _cancelNew, _saveNew,
    _stDragStart, _stDragEnd, _stListDragOver, _stListDrop,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
