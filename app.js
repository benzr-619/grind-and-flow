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
  { id: 'doing',  label: 'Doing',  color: 'var(--blue)' },
  { id: 'done',   label: 'Done',   color: 'var(--text-3)' },
];

const App = (() => {
  let view = 'projects';
  let chatOpen = false;
  let archiveOpen = false;
  let searchOpen = false;
  let searchQuery = '';
  let chatHistory = [];
  let openItemId = null;

  // ── Drag state ──
  let dragId = null;
  let dragEl = null;
  let placeholder = null;

  // ── Init ──
  async function init() {
    await Data.load();
    updateDateDisplay();
    setInterval(updateDateDisplay, 60000);
    render();
    checkModel();
  }

  function updateDateDisplay() {
    const el = document.getElementById('date-display');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function render() {
    renderBoard();
  }

  // ── View switching ──
  function switchView(v) {
    view = v;
    archiveOpen = false;
    document.getElementById('tab-projects').classList.toggle('active', v === 'projects');
    document.getElementById('tab-tasks').classList.toggle('active', v === 'tasks');
    document.getElementById('add-label').textContent = v === 'projects' ? 'Add project' : 'Add task';
    renderBoard();
  }

  // ── Board rendering ──
  function renderBoard() {
    const board = document.getElementById('board');
    if (archiveOpen) { renderArchive(board); return; }

    const cols = view === 'projects' ? PROJECT_COLS : TASK_COLS;
    const state = Data.get();
    const allItems = view === 'projects' ? state.projects : state.tasks;

    let items = allItems;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = allItems.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.notes || '').toLowerCase().includes(q) ||
        (i.parentProject && (Data.findProject(i.parentProject)?.title || '').toLowerCase().includes(q))
      );
    }

    board.innerHTML = cols.map(col => {
      const colItems = items.filter(i => i.status === col.id);
      const cards = colItems.map(i => renderCard(i)).join('');
      return `<div class="column" data-col="${col.id}"
        ondragover="App._onDragOver(event,'${col.id}')"
        ondragleave="App._onDragLeave(event)"
        ondrop="App._onDrop(event,'${col.id}')">
        <div class="col-header">
          <div class="col-title" style="color:${col.color}">${col.label}</div>
          <div class="col-meta">${colItems.length} item${colItems.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="col-body" data-col="${col.id}">
          ${cards}
          <button class="add-col-btn" onclick="App.openNewModal('${col.id}')">+ add</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderArchive(board) {
    const state = Data.get();
    const archive = state.archive || [];
    const filteredView = view === 'projects'
      ? archive.filter(i => i.type === 'project')
      : archive.filter(i => i.type === 'task' || i.type === 'standalone');

    if (filteredView.length === 0) {
      board.innerHTML = `<div style="padding:40px;color:var(--text-3);font-size:13px;">No archived ${view} yet.</div>`;
      return;
    }

    const items = filteredView.map(item => `
      <div class="archive-item">
        <span class="archive-item-title">${item.title}</span>
        <span class="archive-item-date">${item.archivedAt || ''}</span>
        <button class="restore-btn" onclick="App.restoreItem('${item.id}')">restore</button>
        <button class="st-del" onclick="App.deleteArchiveItem('${item.id}')" title="Delete permanently">✕</button>
      </div>`).join('');

    board.innerHTML = `<div class="column" style="width:100%;max-width:560px;max-height:calc(100vh - 100px);">
      <div class="archive-header">Archive — ${view}</div>
      <div class="archive-list">${items}</div>
    </div>`;
  }

  function renderCard(item) {
    const badges = buildBadges(item);
    const ageDot = buildAgeDot(item);
    const subtaskRow = buildSubtaskRow(item);
    const projectLink = (item.parentProject)
      ? `<div class="project-link">↳ ${Data.findProject(item.parentProject)?.title || ''}</div>` : '';

    const allCols = [...PROJECT_COLS, ...TASK_COLS];
    const col = allCols.find(c => c.id === item.status);
    const accentColor = col ? col.color : 'var(--text-3)';

    return `<div class="card" style="--card-accent:${accentColor}" draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)"
      onclick="App.openDetail('${item.id}')">
      <div class="card-title">${esc(item.title)}</div>
      ${projectLink}
      ${badges || ageDot ? `<div class="card-meta">${badges}${ageDot}</div>` : ''}
      ${subtaskRow}
    </div>`;
  }

  function buildBadges(item) {
    let out = '';
    if (item.blocked) out += `<span class="badge badge-coral">blocked</span>`;
    if (item.dueDate) {
      const over = isOverdue(item.dueDate);
      out += `<span class="badge ${over ? 'badge-red' : 'badge-amber'}">${over ? 'overdue' : 'due'} ${fmtDate(item.dueDate)}</span>`;
    }
    if (item.scheduledDate) {
      out += `<span class="badge badge-green">→ ${fmtDate(item.scheduledDate)}</span>`;
    }
    return out;
  }

  function buildAgeDot(item) {
    if (item.type === 'project') return '';
    const d = daysDiff(item.dateAdded);
    if (d > 30) return `<span class="age-dot old" title="${d} days in list"></span>`;
    if (d > 14) return `<span class="age-dot stale" title="${d} days in list"></span>`;
    return '';
  }

  function buildSubtaskRow(item) {
    if (!item.subtasks || !item.subtasks.length) return '';
    const done = item.subtasks.filter(s => s.done).length;
    const pct = Math.round((done / item.subtasks.length) * 100);
    return `<div class="subtask-row">
      <span class="subtask-label">${done}/${item.subtasks.length}</span>
      <div class="subtask-bar"><div class="subtask-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  // ── Archive toggle ──
  function toggleArchive() {
    archiveOpen = !archiveOpen;
    const btn = document.getElementById('archive-btn');
    btn.style.color = archiveOpen ? 'var(--blue)' : '';
    renderBoard();
  }

  function restoreItem(id) {
    Data.restoreFromArchive(id);
    renderBoard();
  }

  function deleteArchiveItem(id) {
    Data.deleteFromArchive(id);
    renderBoard();
  }

  // ── Search ──
  function toggleSearch() {
    searchOpen = !searchOpen;
    const wrap = document.getElementById('search-bar-wrap');
    wrap.style.display = searchOpen ? 'flex' : 'none';
    if (searchOpen) {
      setTimeout(() => document.getElementById('search-input')?.focus(), 50);
    } else {
      searchQuery = '';
      renderBoard();
    }
  }

  function onSearch(val) {
    searchQuery = val;
    renderBoard();
  }

  // ── Detail modal ──
  function openDetail(id) {
    const item = Data.findItem(id);
    if (!item) return;
    openItemId = id;
    const isProject = item.type === 'project';
    const cols = isProject ? PROJECT_COLS : TASK_COLS;

    const moveBtns = cols.map(c =>
      `<button class="move-btn ${item.status === c.id ? 'current' : ''}" style="${item.status === c.id ? '' : `color:${c.color}`}" onclick="App._moveItem('${id}','${c.id}',this)">${c.label}</button>`
    ).join('');

    const noClass = !item.blocked ? 'active-no' : '';
    const yesClass = item.blocked ? 'active-yes' : '';

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
            <button class="seg-opt ${noClass}" id="bno" onclick="App._setBlocked('${id}',false)">✓ Clear</button>
            <button class="seg-opt ${yesClass}" id="byes" onclick="App._setBlocked('${id}',true)">⏸ Blocked</button>
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
    const rows = (item.subtasks || []).map(st => {
      const promoted = st.promoted;
      return `<div class="st-item" id="sti-${st.id}">
        <input type="checkbox" ${st.done ? 'checked' : ''} ${promoted ? 'disabled' : ''}
          onchange="App._toggleSubtask('${item.id}','${st.id}',this.checked)" />
        <span class="st-title ${st.done ? 'done' : ''}" id="stspan-${st.id}">${esc(st.title)}</span>
        <button id="promote-${st.id}" class="promote-btn ${promoted ? 'done-state' : ''}"
          ${promoted ? 'disabled' : ''}
          onclick="App._promoteSubtask('${item.id}','${st.id}')">
          ${promoted ? '✓ on task board' : '→ task board'}
        </button>
        ${!promoted ? `<button class="st-del" onclick="App._removeSubtask('${item.id}','${st.id}')">✕</button>` : ''}
      </div>`;
    }).join('');

    return `<div class="section">
      <label class="label">Subtasks <span class="label-hint">promote to send to your task board</span></label>
      <div class="subtask-list" id="stlist-${item.id}">
        ${rows || '<div style="font-size:12px;color:var(--text-3);padding:4px 0;">No subtasks yet</div>'}
      </div>
      <div class="add-st-row">
        <input type="text" id="new-st-${item.id}" placeholder="Add subtask..." onkeydown="if(event.key==='Enter')App._addSubtask('${item.id}')" />
        <button onclick="App._addSubtask('${item.id}')">+ add</button>
      </div>
    </div>`;
  }

  function _closeDetail() {
    if (openItemId) {
      _autoSave(openItemId);
      openItemId = null;
    }
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

  function _archiveItem(id) {
    Data.archiveItem(id);
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
    const newTask = {
      id: 't' + Date.now(),
      type: 'task',
      title: st.title,
      status: 'inbox',
      parentProject: projId,
      dueDate: '',
      scheduledDate: '',
      notes: '',
      dateAdded: today(),
      blocked: false
    };
    Data.upsertTask(newTask);
    Data.save();
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
      const div = document.createElement('div');
      div.className = 'st-item'; div.id = 'sti-' + st.id;
      div.innerHTML = `<input type="checkbox" onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
        <span class="st-title" id="stspan-${st.id}">${esc(st.title)}</span>
        <button id="promote-${st.id}" class="promote-btn" onclick="App._promoteSubtask('${projId}','${st.id}')">→ task board</button>
        <button class="st-del" onclick="App._removeSubtask('${projId}','${st.id}')">✕</button>`;
      list.appendChild(div);
    }
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

  function _cancelNew() {
    document.getElementById('modal-root').innerHTML = '';
  }

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
      const type = _newType;
      const parent = type === 'task' ? (document.getElementById('f-parent')?.value || null) : null;
      Data.upsertTask({ id, type, title, status, parentProject: parent, dueDate: due, scheduledDate: sched, notes, dateAdded: today(), blocked: false });
    }
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  // ── Modal helper ──
  function showModal(content, itemId) {
    openItemId = itemId || null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay" id="moverlay"><div class="modal">${content}</div></div>`;
    document.getElementById('moverlay').addEventListener('click', e => {
      if (e.target.id === 'moverlay') {
        if (openItemId) _closeDetail();
        else { document.getElementById('modal-root').innerHTML = ''; }
      }
    });
  }

  // ── Drag & drop ──
  function _onDragStart(e, id) {
    dragId = id;
    dragEl = e.currentTarget;
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
    else { const btn = body.querySelector('.add-col-btn'); body.insertBefore(placeholder, btn); }
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
    if (item) {
      // If dropping into done column on tasks view, offer to archive
      if (colId === 'done' && item.status !== 'done') {
        item.status = 'done';
        Data.save();
      } else {
        item.status = colId;
        Data.save();
      }
    }
    placeholder?.remove(); placeholder = null;
    document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
    renderBoard();
  }

  // ── Chat ──
  function toggleChat() {
    chatOpen = !chatOpen;
    document.getElementById('chat-panel').classList.toggle('open', chatOpen);
    if (chatOpen) checkModel();
  }

  async function checkModel() {
    const dot = document.getElementById('model-dot');
    try {
      const r = await fetch('http://localhost:1234/v1/models');
      dot.className = 'model-dot ' + (r.ok ? 'online' : 'offline');
    } catch { dot.className = 'model-dot offline'; }
  }

  function getBoardContext() {
    const state = Data.get();
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const ps = PROJECT_COLS.map(col => {
      const items = state.projects.filter(p => p.status === col.id);
      if (!items.length) return null;
      return `${col.label}: ${items.map(p => {
        let s = p.title;
        if (p.dueDate) s += ` (due ${p.dueDate}${isOverdue(p.dueDate) ? ' — OVERDUE' : ''})`;
        if (p.scheduledDate) s += ` (scheduled ${p.scheduledDate})`;
        if (p.blocked) s += ' [BLOCKED]';
        if (p.subtasks?.length) s += ` [${p.subtasks.filter(x => x.done).length}/${p.subtasks.length} subtasks done]`;
        if (p.notes) s += ` — "${p.notes}"`;
        return s;
      }).join('; ')}`;
    }).filter(Boolean).join('\n');

    const ts = TASK_COLS.map(col => {
      const items = state.tasks.filter(t => t.status === col.id);
      if (!items.length) return null;
      return `${col.label}: ${items.map(t => {
        let s = t.title;
        if (t.parentProject) s += ` [project: ${Data.findProject(t.parentProject)?.title}]`;
        if (t.dueDate) s += ` (due ${t.dueDate}${isOverdue(t.dueDate) ? ' — OVERDUE' : ''})`;
        if (t.scheduledDate) s += ` (scheduled ${t.scheduledDate})`;
        if (t.blocked) s += ' [BLOCKED]';
        const age = daysDiff(t.dateAdded);
        if (age > 14) s += ` [sitting in list ${age} days]`;
        return s;
      }).join('; ')}`;
    }).filter(Boolean).join('\n');

    return `Today is ${todayStr}.\n\nPROJECTS:\n${ps}\n\nTASKS:\n${ts}`;
  }

  function sendQuick(prompt) {
    document.getElementById('chat-input').value = prompt;
    sendChat();
  }

  function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  }

  async function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendMsg(text, 'user');
    chatHistory.push({ role: 'user', content: text });
    const typing = appendMsg('', 'ai', true);

    const system = `You are a focused productivity assistant. The user has a kanban-style project and task board. Help them think through priorities, next steps, and project breakdown. Be concise and direct — 2-4 sentences unless they ask for more. You know today's date and can reference it when discussing deadlines and scheduling.\n\n${getBoardContext()}`;

    try {
      const res = await fetch('http://localhost:1234/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local-model',
          messages: [{ role: 'system', content: system }, ...chatHistory],
          max_tokens: 500,
          stream: false
        })
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || 'No response.';
      typing.remove();
      appendMsg(reply, 'ai');
      chatHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      typing.remove();
      appendMsg('Could not reach LM Studio. Make sure it\'s running on localhost:1234 with CORS enabled in Server settings.', 'ai');
    }
  }

  function appendMsg(text, role, typing = false) {
    const msgs = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (typing) div.innerHTML = `<div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    else div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
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
    openDetail, openNewModal, toggleChat, sendQuick, handleChatKey, sendChat,
    restoreItem, deleteArchiveItem,
    // internal (called from HTML)
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
    _closeDetail, _autoSave, _setBlocked, _moveItem,
    _showDelConfirm, _resetDelZone, _deleteItem, _archiveItem,
    _toggleSubtask, _promoteSubtask, _addSubtask, _removeSubtask,
    _setNewType, _cancelNew, _saveNew,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
