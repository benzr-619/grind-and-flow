// app.js — Grind & Flow

// ── Column definitions ──
const PROJECT_COLS = [
  { id: 'active',  label: 'Active',  hint: 'working on' },
  { id: 'up-next', label: 'Up Next', hint: 'queued' },
  { id: 'on-hold', label: 'On Hold', hint: 'paused' },
  { id: 'someday', label: 'Someday', hint: 'maybe' },
];
const TASK_COLS = [
  { id: 'backlog',   label: 'Backlog',    hint: 'oldest top' },
  { id: 'this-week', label: 'This Week',  hint: 'committed' },
  { id: 'next',      label: 'Next',       hint: 'lined up' },
  { id: 'done',      label: 'Done',       hint: 'today' },
];

// ── Timer sequence ──
const TIMER_SEQ = [
  { kind:'work',  m:5,  label:'5m'  },
  { kind:'break', m:5,  label:'5'   },
  { kind:'work',  m:10, label:'10m' },
  { kind:'break', m:5,  label:'5'   },
  { kind:'work',  m:25, label:'25m' },
  { kind:'break', m:5,  label:'5'   },
  { kind:'work',  m:50, label:'50m' },
  { kind:'break', m:5,  label:'5'   },
  { kind:'work',  m:50, label:'50m' },
];

// ── Default + user-defined tags stored in localStorage ──
const TAG_STORAGE_KEY = 'gf-tags';
function _loadTags() {
  try { return JSON.parse(localStorage.getItem(TAG_STORAGE_KEY)) || ['work','personal','school']; }
  catch { return ['work','personal','school']; }
}
function _saveTags(tags) {
  localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(tags));
}

const App = (() => {
  let _initialized = false;  // guarded by auth.js — prevents double-init on token refresh

  let view = 'tasks';
  let archiveOpen = false;
  let searchQuery = '';
  let openItemId = null;
  let dragId = null, dragEl = null, placeholder = null;
  let _pendingFade = false;

  // Filter state
  let filterTags = [];       // active tag filters
  let filterDate = '';       // scheduled date filter

  // Timer
  let timerTask = null;
  let timerSegIdx = 0;
  let timerSecsRemaining = 0;
  let timerRunning = false;
  let timerAtBoundary = false; // true when a segment just ended and the next hasn't started yet
  let timerInterval = null;
  let timerElapsedInterval = null;
  // Wall-clock references — used to correct for browser background throttling
  let _timerStartedAt = 0;   // Date.now() when current segment was started/resumed
  let _timerStartSecs = 0;   // timerSecsRemaining at that moment
  let _notifPermissionAsked = false; // only prompt once per session

  // Clock
  let clockInterval = null;

  // Subtask drag
  let stDragId = null, stProjId = null, stPlaceholder = null, stDragEl = null;

  // ── Data migration (handle old status values) ──
  function _migrateData() {
    const state = Data.get();
    const STATUS_MAP = { 'inbox': 'backlog', 'on-deck': 'up-next' };
    let dirty = false;
    [...state.tasks, ...state.projects].forEach(item => {
      if (STATUS_MAP[item.status]) { item.status = STATUS_MAP[item.status]; dirty = true; }
      // Seed backlogEnteredAt for existing backlog items that don't have it
      if (item.status === 'backlog' && !item.backlogEnteredAt) {
        item.backlogEnteredAt = item.dateAdded || _today(); dirty = true;
      }
      // Seed tags array
      if (!item.tags) { item.tags = []; dirty = true; }
    });
    if (dirty) Data.syncAll(); // push any migrated status/tag fixes to Supabase
  }

  // ── Init ──
  async function init() {
    _initialized = true;
    await Data.load();   // async: fetches from Supabase
    _migrateData();
    _updateTopbarDate();
    setInterval(_updateTopbarDate, 60000);
    _renderFocusRow();
    _renderTimerTrack();
    _startClock();
    renderBoard();

    window.addEventListener('beforeunload', () => Data.saveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        Data.saveNow();
      } else if (timerRunning) {
        // Tab came back into view — re-sync from wall clock so any time that passed
        // while the browser throttled setInterval is applied at once
        _timerTick();
      }
    });
  }

  function _updateTopbarDate() {
    const el = document.getElementById('topbar-date');
    if (!el) return;
    const d = new Date();
    const day   = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const month = d.toLocaleDateString('en-US', { month: 'short'  }).toUpperCase();
    const date  = d.getDate();
    el.textContent = `${day} · ${month} ${date}`;
  }

  // ── View switching ──
  function switchView(v) {
    if (v === 'archive') { toggleArchive(); return; }
    view = v;
    archiveOpen = false;
    _pendingFade = true;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + v)?.classList.add('active');
    document.getElementById('tab-archive')?.classList.remove('active');
    renderBoard();
  }

  function toggleArchive() {
    archiveOpen = !archiveOpen;
    _pendingFade = true;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (archiveOpen) document.getElementById('tab-archive')?.classList.add('active');
    else document.getElementById('tab-' + view)?.classList.add('active');
    renderBoard();
  }

  // ── Export / Import ──
  function exportData() {
    Data.saveNow();
    const blob = new Blob([JSON.stringify(Data.get(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `gf-backup-${_today()}.json`; a.click();
    URL.revokeObjectURL(url); dismissBanner();
  }
  function importData() { document.getElementById('import-file').click(); }
  function onImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.projects || !data.tasks) throw new Error();
        _showConfirm('Import backup?', 'This will replace your current data.', 'Import', () => { Data.replaceAll(data); renderBoard(); });
      } catch { alert('Invalid backup file.'); }
    };
    reader.readAsText(file); e.target.value = '';
  }
  function dismissBanner() { const b = document.getElementById('save-banner'); if (b) b.style.display = 'none'; }

  // ── Render ──
  function renderBoard() {
    const board = document.getElementById('board');
    if (!board) return;

    // Board title
    const titleEl = document.getElementById('board-title');
    if (titleEl) {
      titleEl.textContent = archiveOpen ? 'Archive' : view === 'projects' ? 'Projects' : 'Tasks';
    }

    // Board actions
    const actEl = document.getElementById('board-actions');
    if (actEl) {
      if (!archiveOpen) {
        actEl.innerHTML = `
          <button class="btn" onclick="App.openNewModal()">+ New ${view === 'projects' ? 'Project' : 'Task'}</button>
          <button class="btn btn-primary" id="filter-btn" onclick="App.toggleFilter(event)">Filters${filterTags.length || filterDate ? ' · ' + (filterTags.length + (filterDate ? 1 : 0)) : ''}</button>`;
      } else {
        actEl.innerHTML = '';
      }
    }

    if (archiveOpen) {
      _renderArchive(board);
    } else {
      const cols = view === 'projects' ? PROJECT_COLS : TASK_COLS;
      const state = Data.get();
      let items = view === 'projects' ? state.projects : state.tasks;

      // Apply search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        items = items.filter(i =>
          i.title.toLowerCase().includes(q) ||
          (i.notes || '').toLowerCase().includes(q)
        );
      }

      // Apply tag filter
      if (filterTags.length) {
        items = items.filter(i => {
          const itags = i.tags || [];
          return filterTags.some(ft => itags.includes(ft));
        });
      }

      // Apply date filter
      if (filterDate) {
        items = items.filter(i => i.scheduledDate === filterDate);
      }

      board.innerHTML = `<div class="columns">${cols.map(col => {
        let colItems = items.filter(i => i.status === col.id);
        // Backlog: sort oldest first
        if (col.id === 'backlog') {
          colItems = [...colItems].sort((a, b) => {
            const ad = a.backlogEnteredAt || a.dateAdded || '';
            const bd = b.backlogEnteredAt || b.dateAdded || '';
            return ad.localeCompare(bd);
          });
        }
        return `<div class="col-wrap">
          <div class="col-head${col.id === 'this-week' ? ' this-week' : ''}">
            <span class="col-name">
              ${col.label.toUpperCase()} <span class="col-count">${String(colItems.length).padStart(2,'0')}</span>
            </span>
            <span class="col-hint">${col.hint}</span>
          </div>
          <div class="col-body" data-col="${col.id}"
            ondragover="App._onDragOver(event,'${col.id}')"
            ondragleave="App._onDragLeave(event)"
            ondrop="App._onDrop(event,'${col.id}')">
            ${colItems.map(i => view === 'projects' ? _renderProjCard(i) : _renderTaskCard(i, col.id)).join('')}
            ${colItems.length === 0 ? `<div class="col-empty">empty</div>` : ''}
            ${col.id !== 'done' ? `<button class="add-col-btn" onclick="App.openNewModal('${col.id}')">+ add</button>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`;
    }

    // Board crossfade — only fires on explicit tab/view switches
    if (_pendingFade) {
      _pendingFade = false;
      board.classList.remove('board-fade-in');
      void board.offsetWidth; // force reflow to restart animation
      board.classList.add('board-fade-in');
    }
  }

  // ── Task card ──
  function _renderTaskCard(item, colId) {
    const isDone = colId === 'done';
    const tags   = item.tags || [];
    const firstTag = tags[0] || '';
    const tagClass = firstTag ? `tag-${firstTag}` : '';

    // Days in backlog counter (resets when leaving/re-entering backlog)
    let ageHtml = '';
    if (!isDone && item.backlogEnteredAt) {
      const days = _daysDiff(item.backlogEnteredAt);
      const ageClass = days >= 14 ? 'old' : days >= 7 ? 'stale' : '';
      ageHtml = `<span class="age-counter${ageClass ? ' ' + ageClass : ''}">${days}d</span>`;
    }

    const blockedHtml = item.blocked
      ? `<span class="blocked-badge">Blocked</span>` : '';

    // Blocked reason
    const blockedReasonHtml = item.blocked && item.blockedReason
      ? `<div class="card-blocked-reason"><span class="card-blocked-arrow">↳</span>${esc(item.blockedReason)}</div>` : '';

    // Parent project
    const projHtml = item.parentProject
      ? `<div class="card-project"><span class="card-project-box"></span>${esc(Data.findProject(item.parentProject)?.title?.toUpperCase() || '')}</div>` : '';

    // Tags bottom-left
    const tagPills = tags.map(t =>
      `<span class="tag-pill tag-${t}">${t.toUpperCase()}</span>`
    ).join('');

    // Subtask count
    const subHtml = (item.subtasks && item.subtasks.length)
      ? `<span class="card-subtask-count">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <rect x="1.5" y="2.5" width="13" height="3" rx="0.5"/>
            <rect x="1.5" y="7" width="13" height="3" rx="0.5"/>
            <rect x="1.5" y="11.5" width="13" height="3" rx="0.5"/>
          </svg> ${item.subtasks.length}
        </span>` : '';

    // Scheduled day + time
    let schedHtml = '', dayHtml = '';
    if (item.scheduledDate) {
      const schedD  = new Date(item.scheduledDate + 'T00:00:00');
      const today   = new Date(); today.setHours(0,0,0,0);
      const tmrw    = new Date(today); tmrw.setDate(tmrw.getDate()+1);
      const dayName = schedD.toLocaleDateString('en-US', { weekday: 'short' });
      const isToday = schedD.getTime() === today.getTime();
      const isTmrw  = schedD.getTime() === tmrw.getTime();
      const dotClass = isToday ? 'urgent' : isTmrw ? '' : 'future';
      if ((isToday || isTmrw) && item.scheduledTime) {
        schedHtml = `<span class="card-sched-time">${esc(item.scheduledTime)}</span>`;
      }
      dayHtml = `<span class="card-day"><span class="card-day-dot ${dotClass}"></span>${dayName}</span>`;
    }

    // Done card — minimal
    if (isDone) {
      return `<div class="card done-card ${tagClass}" data-id="${item.id}"
        onclick="App.openDetail('${item.id}')">
        <div class="card-top">
          <span class="card-title">${esc(item.title)}</span>
          <span class="done-check">✓</span>
        </div>
      </div>`;
    }

    const isActive = timerTask && timerTask.id === item.id;
    const focusBtn = colId === 'next' && !isActive
      ? `<button class="focus-btn" onclick="event.stopPropagation();App.startTask('${item.id}')">start →</button>` : '';

    return `<div class="card ${tagClass}${isActive ? ' card-active' : ''}" draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)"
      onclick="App.openDetail('${item.id}')">
      <div class="card-top">
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(item.title)}</div>
          ${blockedReasonHtml}
          ${projHtml}
        </div>
        <div class="card-top-right">
          ${blockedHtml}
          ${ageHtml}
        </div>
      </div>
      <div class="card-bottom">
        <div class="card-bottom-left">
          ${tagPills}
          ${subHtml}
          ${schedHtml}
        </div>
        <div class="card-bottom-right">
          ${dayHtml}
        </div>
      </div>
      ${focusBtn}
    </div>`;
  }

  // ── Project card ──
  function _renderProjCard(item) {
    const totalTasks = (item.subtasks || []).length;
    const doneTasks  = (item.subtasks || []).filter(s => s.done).length;
    const pct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const tags = item.tags || [];
    const firstTag = tags[0] || '';
    const tagClass = firstTag ? `tag-${firstTag}` : '';

    const blockedBadge = item.blocked ? `<span class="blocked-badge">Blocked</span>` : '';
    const blockedReason = item.blocked && item.blockedReason
      ? `<div class="proj-blocked-reason"><span>↳</span> ${esc(item.blockedReason)}</div>` : '';
    const tagPills = tags.map(t => `<span class="tag-pill tag-${t}">${t.toUpperCase()}</span>`).join('');
    const isOpen = !!item._open;

    return `<div class="proj-card ${tagClass}${item.status === 'on-hold' ? ' on-hold' : ''}${isOpen ? ' open' : ''}"
      draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)">
      <div class="proj-card-head" onclick="App.openDetail('${item.id}')">
        <div class="proj-title-row">
          <div class="proj-title-and-blocked">
            <div class="proj-name">${esc(item.title)}</div>
            ${blockedBadge}
          </div>
          <button class="proj-toggle" onclick="event.stopPropagation();App._toggleProjOpen('${item.id}')">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
              style="transform:${isOpen ? 'rotate(0deg)':'rotate(-90deg)'}">
              <path d="M4 6l4 5 4-5z"/>
            </svg>
          </button>
        </div>
        <div class="proj-meta">
          ${tagPills}
          ${item.dateAdded ? `<span class="proj-meta-sep">·</span><span>${_ageLabel(item.dateAdded)}</span>` : ''}
        </div>
        ${blockedReason}
      </div>
      <div class="proj-progress" onclick="App.openDetail('${item.id}')">
        ${totalTasks === 0
          ? `<div class="proj-no-tasks">no tasks yet</div>`
          : `<div class="proj-progress-row">
              <span>${doneTasks}/${totalTasks} tasks</span>
              <span>${pct}%</span>
            </div>
            <div class="proj-bar"><div class="proj-bar-fill" style="width:${pct}%"></div></div>`}
      </div>
      ${isOpen ? `
        <div class="proj-subtasks">
          <div class="proj-subtasks-head">Tasks</div>
          <div id="stlist-${item.id}"
            ondragover="App._stListDragOver(event,'${item.id}')"
            ondrop="App._stListDrop(event,'${item.id}')">
            ${(item.subtasks || []).map(st => _renderSubtaskRow(st, item.id)).join('')}
          </div>
          <div class="add-inline-st" onclick="event.stopPropagation()">
            <input type="text" placeholder="Add task..." id="inline-st-${item.id}"
              onkeydown="if(event.key==='Enter')App._inlineAddSubtask('${item.id}')" />
            <button onclick="App._inlineAddSubtask('${item.id}')">+ add</button>
          </div>
        </div>` : ''}
    </div>`;
  }

  function _renderSubtaskRow(st, projId) {
    const locTag = st.promoted ? 'ON BOARD' : (st.loc || 'BACKLOG').toUpperCase();
    return `<div class="subtask-row-item" id="sti-${st.id}" draggable="true"
      ondragstart="App._stDragStart(event,'${projId}','${st.id}')"
      ondragend="App._stDragEnd(event)">
      <span class="st-handle" title="Drag to reorder">⠿</span>
      <input type="checkbox" ${st.done ? 'checked' : ''} ${st.promoted ? 'disabled' : ''}
        onclick="event.stopPropagation()"
        onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
      <span class="st-title${st.done ? ' done' : ''}" id="stspan-${st.id}">${esc(st.title)}</span>
      <span class="st-loc-tag">${locTag}</span>
      ${!st.promoted
        ? `<button class="st-promote" onclick="event.stopPropagation();App._promoteSubtask('${projId}','${st.id}')">→ this week</button>
           <button class="st-del" onclick="event.stopPropagation();App._removeSubtask('${projId}','${st.id}')">✕</button>`
        : `<span class="st-promote promoted">✓ on board</span>`}
    </div>`;
  }

  function _toggleProjOpen(id) {
    const item = Data.findProject(id);
    if (!item) return;
    if (item._open) {
      // Animate collapse before removing from DOM
      const subtasksEl = document.querySelector(`[data-id="${id}"] .proj-subtasks`);
      if (subtasksEl) {
        subtasksEl.classList.add('collapsing');
        setTimeout(() => { item._open = false; renderBoard(); }, 130);
        return;
      }
    }
    item._open = !item._open;
    renderBoard();
  }

  function _inlineAddSubtask(projId) {
    const input = document.getElementById('inline-st-' + projId);
    const title = input?.value.trim(); if (!title) return;
    const proj = Data.findProject(projId); if (!proj) return;
    proj.subtasks = proj.subtasks || [];
    proj.subtasks.push({ id: 'st' + Date.now(), title, done: false, promoted: false, loc: 'backlog' });
    Data.upsertProject(proj); renderBoard();
  }

  // ── Archive ──
  function _renderArchive(board) {
    const archive = (Data.get().archive || []);
    if (!archive.length) { board.innerHTML = `<div class="archive-empty">No archived items yet.</div>`; return; }
    board.innerHTML = `<div class="archive-section">
      <div class="archive-group">
        <div class="archive-group-head"><span>Archive</span><span>${archive.length} items</span></div>
        ${archive.map(item => `
          <div class="archive-row ${item.type === 'project' ? 'is-project' : ''}">
            <span class="archive-dot"></span>
            <span class="archive-name">${esc(item.title)}</span>
            <span class="archive-date">${item.archivedAt || ''}</span>
            <button class="archive-restore" onclick="App.restoreItem('${item.id}')">restore</button>
            <button class="archive-del" onclick="App.deleteArchiveItem('${item.id}')">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  function restoreItem(id) { Data.restoreFromArchive(id); renderBoard(); }
  function deleteArchiveItem(id) { Data.deleteFromArchive(id); renderBoard(); }
  function onSearch(val) { searchQuery = val; renderBoard(); }

  // ── Filter ──
  function toggleFilter(e) {
    const existing = document.getElementById('filter-popover');
    if (existing) { existing.remove(); return; }
    const allTags = _loadTags();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.id = 'filter-popover';
    pop.className = 'filter-popover';
    pop.style.top = (rect.bottom + 6) + 'px';
    pop.style.right = (window.innerWidth - rect.right) + 'px';
    pop.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase">Filters</span>
        <button class="filter-close" onclick="document.getElementById('filter-popover')?.remove()">✕</button>
      </div>
      <div class="filter-section-title">By tag</div>
      <div class="filter-tag-row" id="filter-tag-row">
        ${allTags.map(t => `<button class="filter-tag${filterTags.includes(t) ? ' active' : ''}" onclick="App._filterToggleTag('${t}')">${t.toUpperCase()}</button>`).join('')}
      </div>
      <div class="filter-section-title" style="margin-top:12px">By scheduled date</div>
      <input type="date" class="modal-input" style="margin-top:4px" value="${filterDate}"
        onchange="App._filterSetDate(this.value)" />
      <button class="btn" style="margin-top:10px;width:100%" onclick="App.clearFilters()">Clear all</button>`;
    document.body.appendChild(pop);
    const close = (ev) => { if (!pop.contains(ev.target) && ev.target.id !== 'filter-btn') { pop.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 10);
  }

  function _filterToggleTag(tag) {
    if (filterTags.includes(tag)) filterTags = filterTags.filter(t => t !== tag);
    else filterTags.push(tag);
    // Re-render filter popover tags in place
    const row = document.getElementById('filter-tag-row');
    if (row) {
      const allTags = _loadTags();
      row.innerHTML = allTags.map(t =>
        `<button class="filter-tag${filterTags.includes(t) ? ' active' : ''}" onclick="App._filterToggleTag('${t}')">${t.toUpperCase()}</button>`
      ).join('');
    }
    renderBoard();
  }

  function _filterSetDate(val) { filterDate = val; renderBoard(); }
  function clearFilters() {
    filterTags = []; filterDate = '';
    document.getElementById('filter-popover')?.remove();
    renderBoard();
  }

  // ── Doing row ──
  function _renderFocusRow() {
    const sec = document.getElementById('doing-section');
    if (!sec) return;
    const state = Data.get();
    const doingTasks = state.tasks.filter(t => t.status === 'doing');
    const task = doingTasks[0] || null;

    if (!task) {
      sec.innerHTML = `
        <div class="doing-label-row"><span class="doing-label">Doing</span></div>
        <div class="doing-strip">
          <div class="doing-drop-hint" id="doing-cards-row"
            ondragover="App._onDoingDragOver(event)"
            ondragleave="App._onDoingDragLeave(event)"
            ondrop="App._onDoingDrop(event)">
            drag a task here to commit
          </div>
        </div>`;
    } else {
      const isActive = timerTask && timerTask.id === task.id;
      const isRunning = isActive && timerRunning;
      const isCalm  = timerAtBoundary && isActive && TIMER_SEQ[timerSegIdx].kind === 'break';
      const isPushy = timerAtBoundary && isActive && TIMER_SEQ[timerSegIdx].kind !== 'break';
      const tags = task.tags || [];
      sec.innerHTML = `
        <div class="doing-label-row"><span class="doing-label">Doing</span></div>
        <div class="doing-strip">
          <button class="doing-flank doing-flank-left"
            onclick="event.stopPropagation();App.removeFromDoing('${task.id}')"
            title="Back to Next">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            <span>next</span>
          </button>
          <div class="doing-band${isActive ? ' now' : ''}${isCalm ? ' boundary-calm' : ''}${isPushy ? ' boundary-pushy' : ''}"
            id="doing-cards-row" data-id="${task.id}"
            ondragover="App._onDoingDragOver(event)"
            ondragleave="App._onDoingDragLeave(event)"
            ondrop="App._onDoingDrop(event)">
            <button class="doing-play-btn${isRunning ? ' running' : ''}"
              onclick="${isRunning ? 'App.timerTogglePlay()' : `App.activateTask('${task.id}')`}">
              ${isRunning
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8-13-8z"/></svg>`}
            </button>
            <div class="doing-identity">
              <div class="doing-meta-top">
                ${isActive ? `<span class="tag-pill" style="font-size:8px;padding:1px 5px;background:var(--sage-pale);border-color:var(--sage-deep);color:var(--sage-deep)">● NOW</span>` : ''}
                ${tags.slice(0,1).map(t => `<span class="tag-pill tag-${t}" style="font-size:8px;padding:1px 5px">${t.toUpperCase()}</span>`).join('')}
              </div>
              <div class="doing-task-title">${esc(task.title)}</div>
            </div>
            <div class="doing-divider"></div>
            <div class="doing-timer-zone">
              <div class="focus-clock">
                <div class="focus-clock-label">Focus</div>
                <div class="focus-clock-time-row">
                  <div class="focus-clock-time" id="focus-clock-time">--<span class="fc-colon">:</span>--</div>
                  <span class="focus-clock-remaining">remaining</span>
                </div>
              </div>
              ${isActive ? `<div class="doing-elapsed">
                <div class="doing-elapsed-lbl">Elapsed</div>
                <div class="doing-elapsed-val">${timerTask._elapsed || 0}<span style="font-size:11px;color:var(--muted);font-style:normal;margin-left:1px">m</span></div>
              </div>` : ''}
            </div>
          </div>
          <button class="doing-flank doing-flank-right"
            onclick="event.stopPropagation();App.markDoingDone('${task.id}')"
            title="Mark Done">
            <span>done</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>`;
    }
    _renderClock();
  }

  // ── Doing drop zone handlers ──
  function _onDoingDragOver(e) {
    e.preventDefault();
    // Always allow drop — existing task will be bumped back to next
    document.getElementById('doing-cards-row')?.classList.add('doing-drag-over');
  }

  function _onDoingDragLeave(e) {
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
      document.getElementById('doing-cards-row')?.classList.remove('doing-drag-over');
    }
  }

  function _onDoingDrop(e) {
    e.preventDefault();
    const row = document.getElementById('doing-cards-row');
    row?.classList.remove('doing-drag-over');
    placeholder?.remove(); placeholder = null;
    if (!dragId) return;
    const state = Data.get();
    const item = Data.findItem(dragId);
    if (!item || item.type === 'project' || item.status === 'doing') return;
    // Bump any existing doing task back to next
    state.tasks.filter(t => t.status === 'doing').forEach(t => { t.status = 'next'; Data.upsertTask(t); });
    item.status = 'doing';
    Data.upsertTask(item);
    activateTask(item.id);
  }

  function removeFromDoing(id) {
    const item = Data.findItem(id);
    if (!item) return;
    if (timerTask && timerTask.id === id) {
      clearInterval(timerInterval);
      clearInterval(timerElapsedInterval);
      timerTask = null;
      timerRunning = false;
      timerSecsRemaining = 0;
      _renderTimerTrack();
    }
    item.status = 'next';
    Data.upsertTask(item);
    _renderFocusRow();
    renderBoard();
  }

  function markDoingDone(id) {
    const item = Data.findItem(id);
    if (!item) return;
    if (timerTask && timerTask.id === id) {
      clearInterval(timerInterval);
      clearInterval(timerElapsedInterval);
      timerTask = null;
      timerRunning = false;
      timerSecsRemaining = 0;
      _renderTimerTrack();
    }
    item.status = 'done';
    Data.upsertTask(item);
    _renderFocusRow();
    renderBoard();
  }

  // ── Timer track ──
  function _renderTimerTrack() {
    const track = document.getElementById('timer-track');
    if (!track) return;
    const segs = TIMER_SEQ.map((seg, i) => {
      const done = i < timerSegIdx;
      const cur  = i === timerSegIdx;
      const isBreak = seg.kind === 'break';
      const w = isBreak ? 'tseg-brk' : `tseg-${seg.m}`;
      const fillPct = cur ? Math.max(0, 1 - timerSecsRemaining / (seg.m * 60)) : 0;
      return `<div class="tseg ${w}${isBreak ? ' break' : ''}${done ? ' done' : ''}${cur ? ' current' : ''}"
        onclick="App._timerJump(${i})"
        title="${seg.m}-min ${seg.kind}">
        ${cur ? `<div class="fill" style="transform:scaleX(${fillPct})"></div>` : ''}
      </div>`;
    }).join('');
    const labels = TIMER_SEQ.map((seg, i) => {
      const w = seg.kind === 'break' ? 'tl-brk' : `tseg-${seg.m}`;
      return `<div class="tl-seg ${w}${i === timerSegIdx ? ' active' : ''}">${seg.kind !== 'break' ? seg.label : ''}</div>`;
    }).join('');
    // Boundary state banner (shown when a segment just finished and user must start the next)
    let boundaryBanner = '';
    if (timerAtBoundary && timerTask) {
      const nextSeg = TIMER_SEQ[timerSegIdx];
      if (nextSeg.kind === 'break') {
        // Calm: work just ended — gentle nudge toward a break
        boundaryBanner = `<div class="timer-boundary calm">
          <span class="timer-boundary-msg">✓ Focus block done. Take five — you earned it.</span>
          <button class="timer-boundary-btn" onclick="App.startNextSegment()">START ${nextSeg.m}-MIN BREAK</button>
        </div>`;
      } else {
        // Pushy: break just ended — firm call back to work
        boundaryBanner = `<div class="timer-boundary pushy">
          <span class="timer-boundary-msg">Break's over. Time to get back to it.</span>
          <button class="timer-boundary-btn" onclick="App.startNextSegment()">START ${nextSeg.m}-MIN WORK ›</button>
        </div>`;
      }
    }

    track.innerHTML = `
      <div class="timer-segments">
        ${segs}
        <div class="timer-loops">
          <button class="timer-loops-btn" title="Loop">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5"/>
            </svg>
          </button>
          <span class="timer-loops-lbl">loops</span>
        </div>
      </div>
      <div class="timer-labels">${labels}<div style="width:56px"></div></div>
      ${boundaryBanner}`;
  }

  // ── Timer logic ──
  function _startClock() {
    clearInterval(clockInterval);
    clockInterval = setInterval(_renderClock, 1000);
    _renderClock();
  }

  function _renderClock() {
    const el = document.getElementById('focus-clock-time');
    if (!el) return;
    if (timerTask && timerSecsRemaining >= 0) {
      const m = String(Math.floor(timerSecsRemaining / 60)).padStart(2,'0');
      const s = String(timerSecsRemaining % 60).padStart(2,'0');
      el.innerHTML = `${m}<span class="fc-colon">:</span>${s}`;
    } else {
      const now = new Date();
      const m = String(now.getHours()).padStart(2,'0');
      const s = String(now.getMinutes()).padStart(2,'0');
      el.innerHTML = `${m}<span class="fc-colon">:</span>${s}`;
    }
  }

  function startTask(id) {
    const item = Data.findItem(id);
    if (!item || item.type === 'project') return;
    const state = Data.get();
    if (item.status !== 'doing') {
      // Bump any existing doing task back to next
      state.tasks.filter(t => t.status === 'doing').forEach(t => { t.status = 'next'; Data.upsertTask(t); });
      item.status = 'doing';
      Data.upsertTask(item);
    }
    activateTask(id);
  }

  function activateTask(id) {
    const item = Data.findItem(id); if (!item) return;
    if (timerTask && timerTask.id === id) { timerAtBoundary = false; _startTimer(); return; }
    clearInterval(timerInterval); clearInterval(timerElapsedInterval);
    timerTask = { ...item, _elapsed: 0 };
    timerSegIdx = 0;
    timerSecsRemaining = TIMER_SEQ[0].m * 60;
    timerAtBoundary = false;
    timerRunning = true;
    _requestNotifPermission();
    _startTimer();
    _renderFocusRow(); _renderTimerTrack(); renderBoard();
  }

  function _startTimer() {
    clearInterval(timerInterval);
    timerRunning = true;
    timerAtBoundary = false;
    // Snapshot wall-clock so background throttling can't cause drift
    _timerStartedAt = Date.now();
    _timerStartSecs = timerSecsRemaining;
    timerInterval = setInterval(_timerTick, 1000);
    clearInterval(timerElapsedInterval);
    timerElapsedInterval = setInterval(() => {
      if (timerTask) {
        timerTask._elapsed = (timerTask._elapsed || 0) + 1;
        const el = document.querySelector('.doing-elapsed-val');
        if (el) el.innerHTML = `${timerTask._elapsed}<span style="font-size:12px;color:var(--muted);font-style:normal;margin-left:1px">m</span>`;
      }
    }, 60000);
  }

  function _timerTick() {
    // Derive remaining time from wall clock — immune to interval throttling in background tabs
    const wallElapsed = Math.floor((Date.now() - _timerStartedAt) / 1000);
    timerSecsRemaining = Math.max(0, _timerStartSecs - wallElapsed);
    if (timerSecsRemaining > 0) {
      _renderClock();
      _updateSegFill();
    } else {
      // Segment complete — stop and wait for user to start the next one
      clearInterval(timerInterval);
      clearInterval(timerElapsedInterval);
      timerRunning = false;
      timerAtBoundary = true;
      // Advance index to the next segment (loop back to 0 at the end)
      timerSegIdx = (timerSegIdx + 1) % TIMER_SEQ.length;
      timerSecsRemaining = TIMER_SEQ[timerSegIdx].m * 60;
      _fireSegmentNotification();
      _renderTimerTrack(); _renderFocusRow();
    }
  }

  function timerTogglePlay() {
    if (timerRunning) {
      clearInterval(timerInterval); clearInterval(timerElapsedInterval);
      timerRunning = false;
    } else { _startTimer(); }
    _renderFocusRow();
  }

  function _timerJump(idx) {
    timerSegIdx = idx; timerSecsRemaining = TIMER_SEQ[idx].m * 60;
    timerAtBoundary = false;
    if (timerTask && timerRunning) _startTimer();
    _renderTimerTrack(); _renderClock();
  }

  function startNextSegment() {
    if (!timerTask) return;
    timerAtBoundary = false;
    _startTimer();
    _renderTimerTrack(); _renderFocusRow();
  }

  function _updateSegFill() {
    const fillEl = document.querySelector('.tseg.current .fill');
    if (!fillEl) return;
    const seg = TIMER_SEQ[timerSegIdx];
    fillEl.style.transform = `scaleX(${Math.max(0, 1 - timerSecsRemaining / (seg.m * 60))})`;
  }

  function _requestNotifPermission() {
    if (_notifPermissionAsked || !('Notification' in window)) return;
    _notifPermissionAsked = true;
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  function _fireSegmentNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // timerSegIdx has already advanced — if the next seg is a break, work just finished (calm);
    // if it's a work seg, the break just finished (pushy)
    const nextKind = TIMER_SEQ[timerSegIdx].kind;
    const isBreakNext = nextKind === 'break';
    const title = 'Grind & Flow';
    const body  = isBreakNext
      ? '✓ Focus block done. Take five — you earned it.'
      : "Break's over. Time to get back to it.";
    try {
      new Notification(title, { body, icon: 'icon-192.png' });
    } catch(e) {}
  }

  // ── Drag & drop (columns) ──
  function _onDragStart(e, id) {
    dragId = id; dragEl = e.currentTarget;
    setTimeout(() => dragEl?.classList.add('is-dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  }
  function _onDragEnd(e) {
    dragEl?.classList.remove('is-dragging');
    placeholder?.remove(); placeholder = null;
    document.querySelectorAll('.col-body').forEach(c => c.classList.remove('drag-over'));
    dragId = null; dragEl = null;
  }
  function _onDragOver(e, colId) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
    if (!placeholder) { placeholder = document.createElement('div'); placeholder.className = 'drag-placeholder'; }
    const after = _dragAfterEl(e.currentTarget, e.clientY);
    const addBtn = e.currentTarget.querySelector('.add-col-btn');
    if (after) e.currentTarget.insertBefore(placeholder, after);
    else e.currentTarget.insertBefore(placeholder, addBtn || null);
  }
  function _onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
  function _dragAfterEl(container, y) {
    return [...container.querySelectorAll('.card:not(.is-dragging),.proj-card:not(.is-dragging)')].reduce((closest, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      return (offset < 0 && offset > closest.offset) ? { offset, element: el } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }
  function _onDrop(e, colId) {
    e.preventDefault(); if (!dragId) return;
    const item = Data.findItem(dragId);
    if (item) {
      const oldStatus = item.status;
      item.status = colId;
      // Backlog date tracking
      if (colId === 'backlog' && oldStatus !== 'backlog') {
        item.backlogEnteredAt = _today();
      } else if (colId !== 'backlog') {
        // Don't clear it — reset happens when re-entering backlog
      }
      item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item);
    }
    placeholder?.remove(); placeholder = null;
    document.querySelectorAll('.col-body').forEach(c => c.classList.remove('drag-over'));
    renderBoard();
  }

  // ── Subtask drag (modal + inline) ──
  function _stDragStart(e, projId, stId) {
    stDragId = stId; stProjId = projId; stDragEl = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => stDragEl?.classList.add('is-dragging'), 0);
  }
  function _stDragEnd(e) {
    stDragEl?.classList.remove('is-dragging');
    stPlaceholder?.remove(); stPlaceholder = null;
    stDragId = null; stProjId = null; stDragEl = null;
  }
  function _stListDragOver(e, projId) {
    e.preventDefault();
    if (!stPlaceholder) { stPlaceholder = document.createElement('div'); stPlaceholder.className = 'st-placeholder'; }
    const list = document.getElementById('stlist-' + projId); if (!list) return;
    const afterEl = _stAfterEl(list, e.clientY);
    if (afterEl) list.insertBefore(stPlaceholder, afterEl); else list.appendChild(stPlaceholder);
  }
  function _stListDrop(e, projId) {
    e.preventDefault(); if (!stDragId) return;
    const list = document.getElementById('stlist-' + projId); if (!list) return;
    const placeholderIdx = [...list.children].indexOf(stPlaceholder);
    const newIdx = [...list.children].slice(0, placeholderIdx).filter(el => el.classList.contains('subtask-row-item') || el.classList.contains('subtask-item')).length;
    // Pending (new-project modal) path
    if (projId === _pendingProjectId) {
      const fromIdx = _pendingSubtasks.findIndex(s => s.id === stDragId);
      if (fromIdx >= 0) {
        const [moved] = _pendingSubtasks.splice(fromIdx, 1);
        _pendingSubtasks.splice(newIdx > fromIdx ? newIdx - 1 : newIdx, 0, moved);
      }
      stPlaceholder?.remove(); stPlaceholder = null;
      list.innerHTML = _pendingSubtasks.map(st => _buildModalSubtaskRow(st, projId, true)).join('');
      return;
    }
    const proj = Data.findProject(projId); if (!proj) return;
    const fromIdx = proj.subtasks.findIndex(s => s.id === stDragId);
    if (fromIdx >= 0) {
      const [moved] = proj.subtasks.splice(fromIdx, 1);
      proj.subtasks.splice(newIdx > fromIdx ? newIdx - 1 : newIdx, 0, moved);
      Data.upsertProject(proj);
    }
    stPlaceholder?.remove(); stPlaceholder = null;
    list.innerHTML = proj.subtasks.map(st => _renderSubtaskRow(st, projId)).join('');
  }
  function _stAfterEl(container, y) {
    return [...container.querySelectorAll('.subtask-row-item:not(.is-dragging),.subtask-item:not(.is-dragging)')].reduce((closest, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: el };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // ── Subtask actions ──
  function _toggleSubtask(projId, stId, checked) {
    // Pending (new-project modal) path
    if (projId === _pendingProjectId) {
      const st = _pendingSubtasks.find(s => s.id === stId);
      if (st) st.done = checked;
      const span = document.getElementById('stspan-' + stId);
      if (span) span.className = 'st-title' + (checked ? ' done' : '');
      return;
    }
    const proj = Data.findProject(projId); if (!proj) return;
    const st = proj.subtasks.find(s => s.id === stId);
    if (st) { st.done = checked; Data.upsertProject(proj); }
    const span = document.getElementById('stspan-' + stId);
    if (span) span.className = 'st-title' + (checked ? ' done' : '');
    renderBoard();
  }
  function _promoteSubtask(projId, stId) {
    const proj = Data.findProject(projId); if (!proj) return;
    const st = proj.subtasks.find(s => s.id === stId);
    if (!st || st.promoted) return;
    const newTaskId = 't' + Date.now();
    st.promoted = true; st.loc = 'this-week'; st.promotedTaskId = newTaskId;
    Data.upsertProject(proj);
    Data.upsertTask({ id: newTaskId, type:'task', title:st.title, status:'this-week',
      parentProject:projId, dueDate:'', scheduledDate:'', notes:'', dateAdded:_today(), blocked:false, tags:[...(proj.tags||[])] });
    // Instant DOM update — no waiting for renderBoard
    const row = document.getElementById('sti-' + stId);
    if (row) {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.disabled = true;
      row.querySelectorAll('.st-promote, .st-del').forEach(b => b.remove());
      row.insertAdjacentHTML('beforeend',
        `<button class="st-promote promoted" title="Click to recall from task board" onclick="App._recallSubtask('${projId}','${stId}')">✓ on board</button>`);
    }
    renderBoard();
  }
  function _recallSubtask(projId, stId) {
    const proj = Data.findProject(projId); if (!proj) return;
    const st = proj.subtasks.find(s => s.id === stId);
    if (!st || !st.promoted) return;
    const promotedTaskId = st.promotedTaskId;
    st.promoted = false; st.loc = 'backlog';
    delete st.promotedTaskId;
    Data.upsertProject(proj); // persist un-promoted state before deleteItem runs
    if (promotedTaskId) Data.deleteItem(promotedTaskId);
    // Instant DOM update
    const row = document.getElementById('sti-' + stId);
    if (row) {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.disabled = false;
      row.querySelectorAll('.st-promote, .st-del').forEach(b => b.remove());
      row.insertAdjacentHTML('beforeend',
        `<button class="st-promote" onclick="App._promoteSubtask('${projId}','${stId}')">→ task board</button>
         <button class="st-del" onclick="App._removeSubtask('${projId}','${stId}')">✕</button>`);
    }
    renderBoard();
  }
  function _addSubtask(projId) {
    const input = document.getElementById('new-st-' + projId);
    const title = input?.value.trim(); if (!title) return;
    const st = { id:'st'+Date.now(), title, done:false, promoted:false, loc:'backlog' };
    // Pending (new-project modal) path — project not yet saved
    if (projId === _pendingProjectId) {
      _pendingSubtasks.push(st);
      input.value = '';
      const list = document.getElementById('stlist-' + projId);
      if (list) {
        document.getElementById('st-empty-hint')?.remove();
        list.insertAdjacentHTML('beforeend', _buildModalSubtaskRow(st, projId, true));
      }
      input.focus();
      return;
    }
    const proj = Data.findProject(projId); if (!proj) return;
    proj.subtasks = proj.subtasks || [];
    proj.subtasks.push(st); Data.upsertProject(proj);
    input.value = '';
    const list = document.getElementById('stlist-' + projId);
    if (list) list.insertAdjacentHTML('beforeend', _buildModalSubtaskRow(st, projId));
    input.focus(); renderBoard();
  }
  function _removeSubtask(projId, stId) {
    // Pending (new-project modal) path
    if (projId === _pendingProjectId) {
      _pendingSubtasks = _pendingSubtasks.filter(s => s.id !== stId);
      document.getElementById('sti-' + stId)?.remove();
      const list = document.getElementById('stlist-' + projId);
      if (list && !_pendingSubtasks.length) {
        list.insertAdjacentHTML('afterbegin', '<div id="st-empty-hint" style="font-size:12px;color:var(--muted);font-style:italic;padding:4px 0;font-family:var(--font-body)">No tasks yet</div>');
      }
      return;
    }
    const proj = Data.findProject(projId); if (!proj) return;
    proj.subtasks = proj.subtasks.filter(s => s.id !== stId); Data.upsertProject(proj);
    document.getElementById('sti-' + stId)?.remove(); renderBoard();
  }

  // Modal subtask row (slightly different from inline card row — used inside modal editor)
  // hidePromote = true when the project isn't saved yet (new-project modal)
  function _buildModalSubtaskRow(st, projId, hidePromote = false) {
    return `<div class="subtask-row-item" id="sti-${st.id}" draggable="true"
      ondragstart="App._stDragStart(event,'${projId}','${st.id}')"
      ondragend="App._stDragEnd(event)">
      <span class="st-handle">⠿</span>
      <input type="checkbox" ${st.done ? 'checked' : ''} ${st.promoted ? 'disabled' : ''}
        onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
      <span class="st-title${st.done ? ' done' : ''}" id="stspan-${st.id}">${esc(st.title)}</span>
      ${st.promoted
        ? `<button class="st-promote promoted" title="Click to recall from task board" onclick="App._recallSubtask('${projId}','${st.id}')">✓ on board</button>`
        : hidePromote
          ? `<button class="st-del" onclick="App._removeSubtask('${projId}','${st.id}')">✕</button>`
          : `<button class="st-promote" onclick="App._promoteSubtask('${projId}','${st.id}')">→ task board</button>
             <button class="st-del" onclick="App._removeSubtask('${projId}','${st.id}')">✕</button>`}
    </div>`;
  }

  // ── Detail modal ──
  function openDetail(id) {
    const item = Data.findItem(id); if (!item) return;
    openItemId = id;
    const isProject = item.type === 'project';
    const cols = isProject ? PROJECT_COLS : TASK_COLS;
    const allTags = _loadTags();
    const itemTags = item.tags || [];

    const moveBtns = cols.map(c =>
      `<button class="move-btn${item.status === c.id ? ' current' : ''}"
        onclick="App._moveItem('${id}','${c.id}',this)">${c.label}</button>`
    ).join('');

    const projLinkHtml = !isProject && item.parentProject
      ? `<div class="fg"><label class="modal-label">Project</label>
         <div style="font-size:12.5px;color:var(--steel);padding:5px 0;font-family:var(--font-body)">${esc(Data.findProject(item.parentProject)?.title || '—')}</div></div>`
      : '';

    const tagPillsHtml = allTags.map(t =>
      `<button class="modal-tag-pill tag-${t}${itemTags.includes(t) ? ' active' : ''}"
        onclick="App._toggleItemTag('${id}','${t}',this)">${t.toUpperCase()}</button>`
    ).join('');

    const subtaskHtml = isProject ? `
      <div class="modal-section">
        <label class="modal-label">Tasks <span class="modal-label-hint">drag to reorder · promote to task board</span></label>
        <div class="subtask-list" id="stlist-${item.id}"
          ondragover="App._stListDragOver(event,'${item.id}')"
          ondrop="App._stListDrop(event,'${item.id}')">
          ${(item.subtasks || []).map(st => _buildModalSubtaskRow(st, item.id)).join('') || '<div style="font-size:12px;color:var(--muted);font-style:italic;padding:4px 0;font-family:var(--font-body)">No tasks yet</div>'}
        </div>
        <div style="display:flex;gap:5px;margin-top:7px">
          <input type="text" class="modal-input" id="new-st-${item.id}" placeholder="Add task..."
            onkeydown="if(event.key==='Enter')App._addSubtask('${item.id}')" />
          <button class="btn-close" onclick="App._addSubtask('${item.id}')">+ add</button>
        </div>
      </div>` : '';

    _showModal(`
      <div class="modal-title">${esc(item.title)}</div>
      <div class="modal-section">
        <label class="modal-label">Move to</label>
        <div class="move-row">${moveBtns}</div>
      </div>
      <div class="modal-section">
        <div class="fg"><label class="modal-label">Title</label>
          <input type="text" class="modal-input" id="d-title" value="${esc(item.title)}" /></div>
        ${projLinkHtml}
        <div class="fg"><label class="modal-label">Tags</label>
          <div class="modal-tags-row" id="modal-tags-row">${tagPillsHtml}</div>
          <div class="modal-tag-add" style="margin-top:7px">
            <input type="text" id="new-tag-input" placeholder="New tag..." />
            <button onclick="App._addCustomTag('${id}')">+ add tag</button>
          </div>
        </div>
        <div class="field-row">
          <div class="fg"><label class="modal-label">Scheduled date</label>
            <input type="date" class="modal-input" id="d-sched" value="${item.scheduledDate || ''}" /></div>
          <div class="fg"><label class="modal-label">Scheduled time</label>
            <input type="time" class="modal-input" id="d-time" value="${item.scheduledTime || ''}" /></div>
        </div>
        <div class="fg"><label class="modal-label">Due date</label>
          <input type="date" class="modal-input" id="d-due" value="${item.dueDate || ''}" /></div>
        <div class="fg"><label class="modal-label">Notes</label>
          <textarea class="modal-input" id="d-notes">${esc(item.notes || '')}</textarea></div>
        <div class="fg"><label class="modal-label">Blocked?</label>
          <div class="blocked-toggle">
            <button class="blocked-opt${!item.blocked ? ' active-no' : ''}" id="bno" onclick="App._setBlocked('${id}',false)">✓ Clear</button>
            <button class="blocked-opt${item.blocked ? ' active-yes' : ''}" id="byes" onclick="App._setBlocked('${id}',true)">⏸ Blocked</button>
          </div>
          <input type="text" class="modal-input" id="d-blocked-reason"
            placeholder="Reason (optional)..." value="${esc(item.blockedReason || '')}"
            style="margin-top:7px;display:${item.blocked ? 'block' : 'none'}" />
        </div>
      </div>
      ${subtaskHtml}
      <div class="modal-footer">
        <div id="del-zone"><button class="btn-danger" onclick="App._showDelConfirm('${id}')">Delete</button></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="App._closeDetail()">Close</button>
          <button class="btn-save" onclick="App._saveDetail('${id}');App._closeDetail()">Save</button>
        </div>
      </div>`, id);
  }

  function _toggleItemTag(id, tag, btn) {
    const item = Data.findItem(id); if (!item) return;
    item.tags = item.tags || [];
    if (item.tags.includes(tag)) item.tags = item.tags.filter(t => t !== tag);
    else item.tags.push(tag);
    btn.classList.toggle('active');
    item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item);
  }

  function _addCustomTag(itemId) {
    const input = document.getElementById('new-tag-input');
    const tag = input?.value.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
    if (!tag) return;
    const allTags = _loadTags();
    if (!allTags.includes(tag)) { allTags.push(tag); _saveTags(allTags); }
    const item = Data.findItem(itemId);
    if (item) { item.tags = item.tags || []; if (!item.tags.includes(tag)) item.tags.push(tag); item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item); }
    // Refresh tags row
    const row = document.getElementById('modal-tags-row');
    if (row) {
      const itemTags = item?.tags || [];
      row.innerHTML = _loadTags().map(t =>
        `<button class="modal-tag-pill tag-${t}${itemTags.includes(t) ? ' active' : ''}"
          onclick="App._toggleItemTag('${itemId}','${t}',this)">${t.toUpperCase()}</button>`
      ).join('');
    }
    if (input) input.value = '';
  }

  function _setBlocked(id, val) {
    const item = Data.findItem(id);
    if (item) { item.blocked = val; item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item); }
    document.getElementById('bno')?.classList.toggle('active-no', !val);
    document.getElementById('byes')?.classList.toggle('active-yes', val);
    const reasonInput = document.getElementById('d-blocked-reason');
    if (reasonInput) reasonInput.style.display = val ? 'block' : 'none';
  }

  function _moveItem(id, status, btn) {
    const item = Data.findItem(id);
    if (item) {
      const old = item.status; item.status = status;
      if (status === 'backlog' && old !== 'backlog') item.backlogEnteredAt = _today();
      item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item);
    }
    document.querySelectorAll('.move-btn').forEach(b => b.classList.remove('current'));
    btn?.classList.add('current');
    renderBoard();
  }

  function _saveDetail(id) {
    const item = Data.findItem(id); if (!item) return;
    const t = document.getElementById('d-title');
    const d = document.getElementById('d-due');
    const s = document.getElementById('d-sched');
    const tm = document.getElementById('d-time');
    const n = document.getElementById('d-notes');
    const r = document.getElementById('d-blocked-reason');
    if (t && t.value.trim()) item.title = t.value.trim();
    if (d) item.dueDate = d.value || '';
    if (s) item.scheduledDate = s.value || '';
    if (tm) item.scheduledTime = tm.value || '';
    if (n) item.notes = n.value || '';
    if (r) item.blockedReason = r.value || '';
    if (item.type === 'project') Data.upsertProject(item);
    else Data.upsertTask(item);
  }

  function _closeDetail() {
    openItemId = null;
    document.getElementById('modal-root').innerHTML = '';
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
    document.getElementById('del-zone').innerHTML = `<button class="btn-danger" onclick="App._showDelConfirm('${id}')">Delete</button>`;
  }
  function _deleteItem(id) {
    Data.deleteItem(id); openItemId = null;
    document.getElementById('modal-root').innerHTML = ''; renderBoard();
  }

  // ── New item modal ──
  let _newType = 'standalone';
  let _pendingProjectId = null;   // pre-generated ID for the new-project modal
  let _pendingSubtasks  = [];     // subtasks accumulated before the project is saved

  function openNewModal(defaultStatus) {
    openItemId = null;
    _newType = view === 'projects' ? 'project' : 'standalone';
    _pendingProjectId = view === 'projects' ? 'p' + Date.now() : null;
    _pendingSubtasks  = [];
    const cols = view === 'projects' ? PROJECT_COLS : TASK_COLS;
    const statusOpts = cols.map(c =>
      `<option value="${c.id}"${c.id === defaultStatus ? ' selected' : ''}>${c.label}</option>`
    ).join('');
    const projOpts = Data.get().projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    const allTags = _loadTags();

    const taskExtra = view === 'tasks' ? `
      <div class="fg"><label class="modal-label">Type</label>
        <div class="type-toggle" id="type-seg">
          <button class="type-opt active" data-t="standalone" onclick="App._setNewType('standalone',this)">Standalone</button>
          <button class="type-opt" data-t="task" onclick="App._setNewType('task',this)">Linked to project</button>
        </div></div>
      <div class="fg" id="proj-link-group" style="display:none">
        <label class="modal-label">Project</label>
        <select class="modal-input" id="f-parent">${projOpts}</select>
      </div>` : '';

    const newProjSubtaskHtml = view === 'projects' ? `
      <div class="modal-section">
        <label class="modal-label">Tasks <span class="modal-label-hint">drag to reorder</span></label>
        <div class="subtask-list" id="stlist-${_pendingProjectId}"
          ondragover="App._stListDragOver(event,'${_pendingProjectId}')"
          ondrop="App._stListDrop(event,'${_pendingProjectId}')">
          <div id="st-empty-hint" style="font-size:12px;color:var(--muted);font-style:italic;padding:4px 0;font-family:var(--font-body)">No tasks yet</div>
        </div>
        <div style="display:flex;gap:5px;margin-top:7px">
          <input type="text" class="modal-input" id="new-st-${_pendingProjectId}" placeholder="Add task..."
            onkeydown="if(event.key==='Enter')App._addSubtask('${_pendingProjectId}')" />
          <button class="btn-close" onclick="App._addSubtask('${_pendingProjectId}')">+ add</button>
        </div>
      </div>` : '';

    _showModal(`
      <div class="modal-title">New ${view === 'projects' ? 'Project' : 'Task'}</div>
      <div class="fg"><label class="modal-label">Title</label>
        <input type="text" class="modal-input" id="f-title" placeholder="Name..." /></div>
      ${taskExtra}
      <div class="fg"><label class="modal-label">Tags</label>
        <div class="modal-tags-row">
          ${allTags.map(t => `<button class="modal-tag-pill tag-${t}" data-tag="${t}"
            onclick="this.classList.toggle('active')">${t.toUpperCase()}</button>`).join('')}
        </div></div>
      <div class="fg"><label class="modal-label">Status</label>
        <select class="modal-input" id="f-status">${statusOpts}</select></div>
      <div class="field-row">
        <div class="fg"><label class="modal-label">Scheduled date</label>
          <input type="date" class="modal-input" id="f-sched" /></div>
        <div class="fg"><label class="modal-label">Scheduled time</label>
          <input type="time" class="modal-input" id="f-sched-time" /></div>
      </div>
      <div class="fg"><label class="modal-label">Due date</label>
        <input type="date" class="modal-input" id="f-due" /></div>
      <div class="fg"><label class="modal-label">Notes</label>
        <textarea class="modal-input" id="f-notes" placeholder="Optional..."></textarea></div>
      ${newProjSubtaskHtml}
      <div class="modal-footer">
        <div></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn-save" onclick="App._saveNew()">Add</button>
        </div>
      </div>`, null);
    setTimeout(() => document.getElementById('f-title')?.focus(), 50);
  }

  function _setNewType(t, btn) {
    _newType = t;
    document.querySelectorAll('#type-seg .type-opt').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    document.getElementById('proj-link-group').style.display = t === 'task' ? '' : 'none';
  }

  function _saveNew() {
    const title = document.getElementById('f-title')?.value.trim(); if (!title) return;
    const status = document.getElementById('f-status')?.value;
    const due    = document.getElementById('f-due')?.value || '';
    const sched  = document.getElementById('f-sched')?.value || '';
    const schedTime = document.getElementById('f-sched-time')?.value || '';
    const notes  = document.getElementById('f-notes')?.value || '';
    const tags   = [...document.querySelectorAll('.modal-tag-pill.active')].map(b => b.dataset.tag).filter(Boolean);
    const id = view === 'projects' ? (_pendingProjectId || 'p' + Date.now()) : 't' + Date.now();
    if (view === 'projects') {
      const subtasks = [..._pendingSubtasks];
      _pendingProjectId = null; _pendingSubtasks = [];
      Data.upsertProject({ id, type:'project', title, status, tags, dueDate:due, scheduledDate:sched, scheduledTime:schedTime, notes, dateAdded:_today(), subtasks, blocked:false });
    } else {
      const parent = _newType === 'task' ? (document.getElementById('f-parent')?.value || null) : null;
      const backlogEnteredAt = status === 'backlog' ? _today() : '';
      Data.upsertTask({ id, type:_newType, title, status, tags, parentProject:parent, dueDate:due, scheduledDate:sched, scheduledTime:schedTime, notes, dateAdded:_today(), backlogEnteredAt, blocked:false });
    }
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
    // Animate the new card's entrance
    setTimeout(() => {
      const el = document.querySelector(`[data-id="${id}"]`);
      if (el) el.classList.add('card-entering');
    }, 16);
  }

  // ── Confirm modal ──
  function _showConfirm(title, msg, confirmLabel, onConfirm) {
    _showModal(`
      <div class="modal-title">${title}</div>
      <p style="font-size:13px;color:var(--steel);line-height:1.6;margin-bottom:18px;font-family:var(--font-body)">${msg}</p>
      <div class="modal-footer"><div></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn-save" onclick="(${onConfirm.toString()})();document.getElementById('modal-root').innerHTML=''">${confirmLabel}</button>
        </div></div>`, null);
  }

  function _showModal(content, itemId) {
    openItemId = itemId || null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay" id="moverlay"><div class="modal">${content}</div></div>`;
    document.getElementById('moverlay').addEventListener('click', e => {
      if (e.target.id === 'moverlay') {
        if (openItemId) { _saveDetail(openItemId); _closeDetail(); }
        else root.innerHTML = '';
      }
    });
  }

  // ── Helpers ──
  function _today() { return new Date().toISOString().split('T')[0]; }
  function _daysDiff(ds) { if (!ds) return 0; return Math.floor((new Date() - new Date(ds + 'T00:00:00')) / 86400000); }
  function _isOverdue(ds) { if (!ds) return false; return new Date(ds) < new Date(_today()); }
  function _fmtDate(ds) { if (!ds) return ''; return new Date(ds+'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' }); }
  function _ageLabel(ds) {
    const d = _daysDiff(ds);
    if (d === 0) return 'today'; if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`; if (d < 14) return '1w ago';
    if (d < 30) return `${Math.floor(d/7)}w ago`;
    return `${Math.floor(d/30)}mo ago`;
  }
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    get _initialized() { return _initialized; },
    set _initialized(v) { _initialized = v; },
    init, switchView, toggleArchive, onSearch,
    openDetail, openNewModal, toggleFilter, clearFilters,
    exportData, importData, onImportFile, dismissBanner,
    restoreItem, deleteArchiveItem,
    startTask, activateTask, timerTogglePlay, _timerJump, startNextSegment,
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
    _onDoingDragOver, _onDoingDragLeave, _onDoingDrop,
    removeFromDoing, markDoingDone,
    _closeDetail, _saveDetail, _setBlocked, _moveItem,
    _showDelConfirm, _resetDelZone, _deleteItem,
    _toggleSubtask, _promoteSubtask, _recallSubtask, _addSubtask, _removeSubtask,
    _setNewType, _saveNew,
    _stDragStart, _stDragEnd, _stListDragOver, _stListDrop,
    _toggleProjOpen, _inlineAddSubtask,
    _toggleItemTag, _addCustomTag,
    _filterToggleTag, _filterSetDate,
  };
})();

// App.init() is called by auth.js once a valid session is confirmed.
// Do NOT add a DOMContentLoaded auto-init here — auth.js owns that gate.
