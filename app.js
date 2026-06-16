// app.js — Grind & Flow

// ── Column definitions ──
const PROJECT_COLS = [
  { id: 'active',  label: 'Active',  hint: 'working on' },
  { id: 'up-next', label: 'Up Next', hint: 'queued' },
  { id: 'on-hold', label: 'On Hold', hint: 'paused' },
  { id: 'someday', label: 'Someday', hint: 'maybe' },
];
const TASK_COLS = [
  { id: 'backlog',   label: 'Inbox',      hint: 'move or leave' },
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

// ── Completion-date map stored in localStorage ──
// Maps taskId → YYYY-MM-DD string of when that task was marked done.
// This lets the midnight auto-archive know which "done" tasks belong to a previous day.
const COMPLETION_DATES_KEY = 'gf-completion-dates';

// ── Tag definitions and color overrides live in Supabase (Data.get().tags) ──
// Built-in tags are always present; custom tags and any color overrides are
// loaded from the `tags` table and kept in memory via Data._state.
const BUILT_IN_TAGS = ['work', 'personal', 'school'];

function _loadTags() {
  const customTags = (Data.get()?.tags || [])
    .filter(t => !BUILT_IN_TAGS.includes(t.name))
    .map(t => t.name);
  return [...BUILT_IN_TAGS, ...customTags];
}

function _loadTagColors() {
  const overrides = {};
  (Data.get()?.tags || []).forEach(t => {
    if (t.colorSlot !== null && t.colorSlot !== undefined) {
      overrides[t.name] = t.colorSlot;
    }
  });
  return overrides;
}
// Returns the CSS class(es) for a tag.
// Manual color overrides take priority; otherwise built-in tags get tag-{name}
// and custom tags get tag-slot-N from the rotation.
function _tagClasses(t, allTags) {
  const overrides = _loadTagColors();
  if (t in overrides) return `tag-slot-${overrides[t] % 5}`;
  if (BUILT_IN_TAGS.includes(t)) return `tag-${t}`;
  const customTags = allTags.filter(x => !BUILT_IN_TAGS.includes(x));
  const idx = customTags.indexOf(t);
  return `tag-slot-${idx >= 0 ? idx % 5 : 0}`;
}

const App = (() => {
  let _initialized = false;  // guarded by auth.js — prevents double-init on token refresh

  let view = 'tasks';
  let archiveOpen = false;
  let searchQuery = '';
  let openItemId = null;
  let dragId = null, dragEl = null, placeholder = null;
  let _pendingFade = false;

  // Mobile tab state — 'inbox' or 'today'; not persisted
  let mobileTab = 'inbox';

  // Archive: tracks which done-project rows are expanded to show nested tasks
  let _expandedArchiveProjects = new Set();

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
  // PiP float — the Document Picture-in-Picture window holding the orb (null = docked).
  // Shares this JS realm, so the timer keeps running with no cross-window messaging.
  let _pipWin = null;
  const _pipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

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

  // ── Completion-date helpers ──
  function _loadCompletionDates() {
    try { return JSON.parse(localStorage.getItem(COMPLETION_DATES_KEY)) || {}; }
    catch { return {}; }
  }
  function _saveCompletionDate(id) {
    const map = _loadCompletionDates();
    map[id] = _today();
    localStorage.setItem(COMPLETION_DATES_KEY, JSON.stringify(map));
  }
  function _clearCompletionDate(id) {
    const map = _loadCompletionDates();
    delete map[id];
    localStorage.setItem(COMPLETION_DATES_KEY, JSON.stringify(map));
  }

  // ── Midnight auto-archive ──
  // Scans all tasks with status "done". Any task whose completion date is before
  // today gets archived and removed from the done column.
  function _autoArchiveStaleDoneTasks() {
    const today = _today();
    const dates = _loadCompletionDates();
    const state = Data.get();
    const toArchive = state.tasks.filter(t =>
      t.status === 'done' && (!dates[t.id] || dates[t.id] < today)
    );
    toArchive.forEach(t => {
      // Fall back to dateAdded if no completion date recorded (e.g. done on another device)
      const completionDate = dates[t.id] || t.dateAdded || today;
      Data.archiveItemWithDate(t.id, completionDate);
      _clearCompletionDate(t.id);
    });
    return toArchive.length;
  }

  // Schedules auto-archive to fire at the next midnight, then re-schedules itself.
  function _scheduleMidnightArchive() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const ms = midnight - now;
    setTimeout(() => {
      _autoArchiveStaleDoneTasks();
      renderBoard();
      _scheduleMidnightArchive(); // reschedule for the next midnight
    }, ms);
  }

  // ── Init ──
  async function init() {
    _initialized = true;
    await Data.load();   // async: fetches from Supabase
    _migrateData();
    _autoArchiveStaleDoneTasks(); // move any stale done tasks into archive on load
    _updateTopbarDate();
    setInterval(_updateTopbarDate, 60000);
    _renderFocusRow();
    _renderTimerTrack();
    _startClock();
    _scheduleMidnightArchive(); // auto-archive at midnight without needing a page reload
    renderBoard();

    // Deep-link: if the URL contains a project/task hash, open its detail modal
    const hashId = location.hash.slice(1);
    if (hashId && Data.findItem(hashId)) openDetail(hashId);

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
          ${view === 'tasks' ? `<button class="btn btn-review-inbox" onclick="App.openInboxReview()">Review Inbox</button>` : ''}
          <button class="btn btn-primary" id="filter-btn" onclick="App.toggleFilter(event)">Filters${filterTags.length || filterDate ? ' · ' + (filterTags.length + (filterDate ? 1 : 0)) : ''}</button>`;
      } else {
        const archiveCount = (Data.get().archive?.length || 0) +
          (Data.get().projects?.filter(p => p.status === 'done').length || 0);
        actEl.innerHTML = archiveCount > 0
          ? `<button class="btn btn-archive-clear" onclick="App.confirmClearArchive()">Clear Archive</button>`
          : '';
      }
    }

    if (archiveOpen) {
      _renderArchive(board);
    } else {
      // Inbox (backlog) is no longer a board column — it's handled by the Inbox
      // Review overlay. TASK_COLS itself is kept intact (it feeds the New Task
      // status dropdown); we only filter backlog out of the rendered columns.
      const cols = view === 'projects' ? PROJECT_COLS : TASK_COLS.filter(c => c.id !== 'backlog');
      const state = Data.get();
      // Done projects live in Archive view only — exclude from the kanban board
      let items = view === 'projects'
        ? state.projects.filter(p => p.status !== 'done')
        : state.tasks;

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

      board.innerHTML = `<div class="columns" data-cols="${cols.length}">${cols.map(col => {
        let colItems = items.filter(i => i.status === col.id);
        // Backlog: sort oldest first
        if (col.id === 'backlog') {
          colItems = [...colItems].sort((a, b) => {
            const ad = a.backlogEnteredAt || a.dateAdded || '';
            const bd = b.backlogEnteredAt || b.dateAdded || '';
            return ad.localeCompare(bd);
          });
        }
        // This Week / Next: scheduled items first (date + time), unscheduled at bottom
        if (col.id === 'this-week' || col.id === 'next') {
          colItems = [...colItems].sort((a, b) => {
            const aKey = a.scheduledDate ? (a.scheduledDate + (a.scheduledTime || '')) : '9999';
            const bKey = b.scheduledDate ? (b.scheduledDate + (b.scheduledTime || '')) : '9999';
            return aKey.localeCompare(bKey);
          });
        }
        return `<div class="col-wrap">
          <div class="col-head${col.id === 'this-week' ? ' this-week' : ''}">
            <span class="col-name">${col.label.toUpperCase()}</span>
            <span class="col-count">${String(colItems.length).padStart(2,'0')}</span>
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

    // Stamp data-view so CSS can hide the projects board on mobile
    document.querySelector('.board-section')
      ?.setAttribute('data-view', archiveOpen ? 'archive' : view);

    // Board crossfade — only fires on explicit tab/view switches
    if (_pendingFade) {
      _pendingFade = false;
      board.classList.remove('board-fade-in');
      void board.offsetWidth; // force reflow to restart animation
      board.classList.add('board-fade-in');
    }

    _renderMobileInbox();
  }

  // ── Mobile panel (Inbox / Today) ──
  function _renderMobileInbox() {
    const panel = document.getElementById('mobile-inbox');
    if (!panel) return;
    mobileTab === 'today' ? _renderMobileToday(panel) : _renderMobileInboxContent(panel);
  }

  function _renderMobileInboxContent(panel) {
    const _allTags = _loadTags();
    const backlogItems = (Data.get().tasks || [])
      .filter(t => t.status === 'backlog')
      .sort((a, b) => {
        const ad = a.backlogEnteredAt || a.dateAdded || '';
        const bd = b.backlogEnteredAt || b.dateAdded || '';
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      });

    const rows = backlogItems.length === 0
      ? '<div class="mobile-inbox-empty">Nothing in the inbox — capture something above.</div>'
      : backlogItems.map(item => {
          const tags = item.tags || [];
          const firstTag = tags[0] || '';
          const tagClass = firstTag ? _tagClasses(firstTag, _allTags) : '';
          const tagPills = tags.map(t =>
            `<span class="tag-pill ${_tagClasses(t, _allTags)}">${t.toUpperCase()}</span>`
          ).join('');
          let ageHtml = '';
          if (item.backlogEnteredAt) {
            const days = _daysDiff(item.backlogEnteredAt);
            const cls  = days >= 14 ? ' old' : days >= 7 ? ' stale' : '';
            ageHtml = `<span class="age-counter${cls}">${_ageLabel(item.backlogEnteredAt)}</span>`;
          }
          return `<div class="mobile-inbox-row ${tagClass}" onclick="App._openInboxSheet('${item.id}')">
            <div class="mobile-inbox-title">${esc(item.title)}</div>
            <div class="mobile-inbox-meta">${tagPills}${ageHtml}</div>
          </div>`;
        }).join('');

    panel.innerHTML = `
      <div class="mobile-inbox-head">
        Inbox <span class="mobile-inbox-count">${backlogItems.length}</span>
      </div>
      <div class="mobile-inbox-list">${rows}</div>`;
  }

  function _renderMobileToday(panel) {
    const today = _today();
    const _allTags = _loadTags();
    const todayItems = (Data.get().tasks || [])
      .filter(t => t.scheduledDate === today && t.status !== 'done')
      .sort((a, b) => {
        const at = a.scheduledTime || '99:99';
        const bt = b.scheduledTime || '99:99';
        return at < bt ? -1 : at > bt ? 1 : 0;
      });

    const rows = todayItems.length === 0
      ? '<div class="mobile-inbox-empty">Nothing scheduled for today.</div>'
      : todayItems.map(item => {
          const tags = item.tags || [];
          const firstTag = tags[0] || '';
          const tagClass = firstTag ? _tagClasses(firstTag, _allTags) : '';
          const tagPills = tags.map(t =>
            `<span class="tag-pill ${_tagClasses(t, _allTags)}">${t.toUpperCase()}</span>`
          ).join('');
          const timeHtml = item.scheduledTime
            ? `<span class="mobile-today-time">${esc(item.scheduledTime)}</span>`
            : '';
          const statusHtml = item.status !== 'backlog'
            ? `<span class="mobile-today-status">${esc(item.status)}</span>`
            : '';
          return `<div class="mobile-inbox-row ${tagClass}" onclick="App._openInboxSheet('${item.id}')">
            <div class="mobile-inbox-title">${esc(item.title)}</div>
            <div class="mobile-inbox-meta">${tagPills}${timeHtml}${statusHtml}</div>
          </div>`;
        }).join('');

    panel.innerHTML = `
      <div class="mobile-inbox-head">
        Today <span class="mobile-inbox-count">${todayItems.length}</span>
      </div>
      <div class="mobile-inbox-list">${rows}</div>`;
  }

  function switchMobileTab(tab) {
    mobileTab = tab;
    document.getElementById('seg-inbox')?.classList.toggle('active', tab === 'inbox');
    document.getElementById('seg-today')?.classList.toggle('active', tab === 'today');
    _renderMobileInbox();
  }

  // ── Task card ──
  function _renderTaskCard(item, colId) {
    const isDone = colId === 'done';
    const tags   = item.tags || [];
    const firstTag = tags[0] || '';
    const _allTags = _loadTags();
    const tagClass = firstTag ? _tagClasses(firstTag, _allTags) : '';

    // Time-in-inbox counter (resets when leaving/re-entering backlog)
    let ageHtml = '';
    if (!isDone && item.backlogEnteredAt) {
      const days = _daysDiff(item.backlogEnteredAt);
      const ageClass = days >= 14 ? 'old' : days >= 7 ? 'stale' : '';
      ageHtml = `<span class="age-counter${ageClass ? ' ' + ageClass : ''}">${_ageLabel(item.backlogEnteredAt)}</span>`;
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
      `<span class="tag-pill ${_tagClasses(t, _allTags)}">${t.toUpperCase()}</span>`
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
      ? `<button class="focus-btn" onclick="event.stopPropagation();App.startTask('${item.id}')">start →</button>`
      : colId === 'this-week'
        ? `<button class="later-btn" onclick="event.stopPropagation();App._sendToLater('${item.id}')">← later</button>` : '';

    return `<div class="card ${tagClass}${isActive ? ' card-active' : ''}" draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)"
      onclick="App.openDetail('${item.id}')">
      <div class="card-top">
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(item.title)}</div>
          ${projHtml}
        </div>
        <div class="card-top-right">
          ${blockedHtml}
        </div>
      </div>
      <div class="card-meta">
        ${tagPills}${subHtml}${schedHtml}${dayHtml}${ageHtml}
      </div>
      ${focusBtn}
    </div>`;
  }

  // ── Project card ──
  function _renderProjCard(item) {
    const tags = item.tags || [];
    const firstTag = tags[0] || '';
    const _allTags = _loadTags();
    const tagClass = firstTag ? _tagClasses(firstTag, _allTags) : '';
    const tagPills = tags.map(t => `<span class="tag-pill ${_tagClasses(t, _allTags)}">${t.toUpperCase()}</span>`).join('');
    const isOpen = !!item._open;

    // State pill — only render if waiting or blocked
    const statePill = item.blocked
      ? `<span class="proj-pill-blocked">Blocked</span>`
      : item.waiting
        ? `<span class="proj-pill-waiting">Waiting</span>`
        : '';

    // Due date display
    let dueDateHtml = '';
    if (item.dueDate) {
      const dd = new Date(item.dueDate + 'T00:00:00');
      const dueFmt = dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dueDateHtml = `<span class="proj-due">Due ${dueFmt}</span>`;
    }

    const capacitiesIcon = item.capacitiesUrl ? `
      <button class="proj-cap-icon" title="Open in Capacities"
        onclick="event.stopPropagation();window.open('${esc(item.capacitiesUrl)}')">
        <svg width="11" height="13" viewBox="0 0 14 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1h12v14l-6-3.5L1 15V1z" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linejoin="round"/>
        </svg>
      </button>` : '';

    // Sort subtasks: undone first, done below
    const sortedSubs = [...(item.subtasks || [])].sort((a, b) => (a.done === b.done) ? 0 : a.done ? 1 : -1);

    return `<div class="proj-card ${tagClass}${item.status === 'on-hold' ? ' on-hold' : ''}${isOpen ? ' open' : ''}"
      draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)">
      <div class="proj-card-head" onclick="App.openDetail('${item.id}')">
        <div class="proj-title-row">
          <div class="proj-name">${esc(item.title)}</div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
            ${capacitiesIcon}
            <button class="proj-toggle" onclick="event.stopPropagation();App._toggleProjOpen('${item.id}')">
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
                style="transform:${isOpen ? 'rotate(0deg)':'rotate(-90deg)'}">
                <path d="M4 6l4 5 4-5z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="proj-meta">
          ${tagPills}
          ${statePill}
          ${dueDateHtml}
        </div>
      </div>
      ${isOpen ? `
        <div class="proj-subtasks">
          <div class="proj-subtasks-head">Tasks</div>
          <div id="stlist-${item.id}"
            ondragover="App._stListDragOver(event,'${item.id}')"
            ondrop="App._stListDrop(event,'${item.id}')">
            ${sortedSubs.map(st => _renderSubtaskRow(st, item.id)).join('')}
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
    return `<div class="subtask-row-item" id="sti-${st.id}" draggable="true"
      ondragstart="App._stDragStart(event,'${projId}','${st.id}')"
      ondragend="App._stDragEnd(event)">
      <span class="st-handle" title="Drag to reorder">⠿</span>
      <input type="checkbox" ${st.done ? 'checked' : ''}
        onclick="event.stopPropagation()"
        onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
      <span class="st-title${st.done ? ' done' : ''}" id="stspan-${st.id}">${esc(st.title)}</span>
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

  // Returns the Monday of the week containing `date`.
  function _weekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = Sunday
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d;
  }

  function _renderArchive(board) {
    const archive      = (Data.get().archive   || []).slice();
    const doneProjects = (Data.get().projects  || []).filter(p => p.status === 'done');
    const allItems     = [...archive, ...doneProjects];

    if (!allItems.length) {
      board.innerHTML = `<div class="archive-empty">Nothing archived yet.</div>`;
      return;
    }

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const thisWeekStart = _weekStart(now);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const allTags = _loadTags();

    // Canonical date string for grouping/sorting: project uses completedAt, task uses archivedAt
    function _itemDateStr(item) {
      if (item.type === 'project') {
        return item.completedAt ? item.completedAt.split('T')[0] : (item.dateAdded || '');
      }
      return item.archivedAt || '';
    }

    function _archiveGroup(item) {
      const d = _itemDateStr(item);
      if (!d) return 'earlier';
      const dt = new Date(d + 'T00:00:00');
      if (dt >= thisWeekStart) return 'this-week';
      if (dt >= lastWeekStart) return 'last-week';
      return 'earlier';
    }

    function _archiveDateLabel(item) {
      const d = _itemDateStr(item);
      if (!d) return '';
      const dt = new Date(d + 'T00:00:00');
      // This week or last week → day name; earlier → "Jun 4"
      if (dt >= lastWeekStart) return dt.toLocaleDateString('en-US', { weekday: 'short' });
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // Sort newest first within each group
    allItems.sort((a, b) => _itemDateStr(b).localeCompare(_itemDateStr(a)));

    function _tagPills(tags) {
      if (!tags || !tags.length) return '';
      return tags.map(t =>
        `<span class="tag-pill arch-tag ${_tagClasses(t, allTags)}">${t.toUpperCase()}</span>`
      ).join('');
    }

    function _renderTaskRow(item) {
      const tagPills  = _tagPills(item.tags || []);
      const dateLabel = _archiveDateLabel(item);
      let parentRef = '';
      if (item.parentProject) {
        const proj = Data.findProject(item.parentProject)
          || doneProjects.find(p => p.id === item.parentProject);
        if (proj) parentRef = `<span class="arch-parent-proj">${esc(proj.title)}</span>`;
      }
      return `
        <div class="archive-row arch-task-row">
          <div class="arch-icon-slot"></div>
          <span class="archive-name">${esc(item.title)}</span>
          ${tagPills}${parentRef}
          <span class="archive-date">${dateLabel}</span>
          <div class="archive-actions">
            <button class="archive-restore" onclick="App.restoreItem('${item.id}')">restore</button>
            <button class="archive-del" onclick="App.deleteArchiveItem('${item.id}')">✕</button>
          </div>
        </div>`;
    }

    function _renderProjectRow(item) {
      const tagPills   = _tagPills(item.tags || []);
      const dateLabel  = _archiveDateLabel(item);
      const isExpanded = _expandedArchiveProjects.has(item.id);
      const folderIcon = isExpanded
        ? `<i class="ti ti-folder-open" style="font-size:14px;color:#C4BEB4"></i>`
        : `<i class="ti ti-folder"      style="font-size:14px;color:#D5CFC6"></i>`;

      // Nested archived tasks that belong to this project
      let nestedHtml = '';
      if (isExpanded) {
        const nested = archive
          .filter(t => t.parentProject === item.id)
          .sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
        if (nested.length) {
          const lastIdx = nested.length - 1;
          nestedHtml = `<div class="arch-nested-tasks">${nested.map((t, i) => `
            <div class="arch-nested-row${i === lastIdx ? ' last' : ''}">
              <span class="arch-nested-title">${esc(t.title)}</span>
              <span class="archive-date">${_archiveDateLabel(t)}</span>
            </div>`).join('')}</div>`;
        } else {
          nestedHtml = `<div class="arch-nested-tasks"><div class="arch-nested-empty">No completed tasks</div></div>`;
        }
      }

      return `
        <div class="archive-proj-block${isExpanded ? ' expanded' : ''}">
          <div class="archive-row arch-proj-row" onclick="App._toggleArchiveProject('${item.id}')">
            <div class="arch-icon-slot">${folderIcon}</div>
            <span class="archive-name arch-proj-name">${esc(item.title)}</span>
            ${tagPills}
            <span class="archive-date">${dateLabel}</span>
            <div class="archive-actions" onclick="event.stopPropagation()">
              <button class="archive-restore" onclick="App._restoreDoneProject('${item.id}')">restore</button>
              <button class="archive-del" onclick="App._deleteDoneProject('${item.id}')">✕</button>
            </div>
          </div>
          ${nestedHtml}
        </div>`;
    }

    const GROUPS = [
      { key: 'this-week', label: 'This Week' },
      { key: 'last-week', label: 'Last Week' },
      { key: 'earlier',   label: 'Earlier'   },
    ];

    let html = '<div class="archive-section">';
    GROUPS.forEach(g => {
      const items = allItems.filter(i => _archiveGroup(i) === g.key);
      if (!items.length) return;
      html += `
        <div class="archive-group">
          <div class="archive-group-head">
            <span>${g.label.toUpperCase()}</span>
            <span>${items.length} done</span>
          </div>
          ${items.map(item => item.type === 'project' ? _renderProjectRow(item) : _renderTaskRow(item)).join('')}
        </div>`;
    });
    html += '</div>';
    board.innerHTML = html;
  }

  function _toggleArchiveProject(id) {
    if (_expandedArchiveProjects.has(id)) _expandedArchiveProjects.delete(id);
    else _expandedArchiveProjects.add(id);
    const board = document.getElementById('board');
    if (board) _renderArchive(board);
  }

  function _restoreDoneProject(id) {
    const proj = Data.findProject(id); if (!proj) return;
    proj.status = 'active';
    proj.completedAt = null;
    Data.upsertProject(proj);
    _expandedArchiveProjects.delete(id);
    renderBoard();
  }

  function _deleteDoneProject(id) {
    Data.deleteItem(id);
    _expandedArchiveProjects.delete(id);
    renderBoard();
  }

  function confirmClearArchive() {
    _showConfirm(
      'Clear archive?',
      'This permanently deletes all archived items and cannot be undone.',
      'Clear all',
      () => { Data.clearArchive(); _expandedArchiveProjects.clear(); renderBoard(); }
    );
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

  // ── Focus Mode orb (full-screen overlay) ──
  function _renderFocusRow() {
    const fz = document.getElementById('focus-zone');
    const meta = document.getElementById('focus-meta');
    const controls = document.getElementById('focus-orb-controls');
    // The orb subtree may live in the PiP window — resolve in whichever doc holds it.
    const fdoc = _focusDoc();
    const orbEl = fdoc.getElementById('focus-orb');
    const glowEl = fdoc.getElementById('focus-orb-glow');
    if (!fz || !meta || !controls) return;

    const state = Data.get();
    const task = state.tasks.filter(t => t.status === 'doing')[0] || null;

    if (!task) {
      if (_pipWin) closeFocusPip();
      fz.style.display = 'none';
      fz.classList.remove('active', 'break');
      meta.innerHTML = '';
      controls.innerHTML = '';
      _renderClock();
      return;
    }

    const isActive    = timerTask && timerTask.id === task.id;
    const isRunning   = isActive && timerRunning;
    const atBoundary  = isActive && timerAtBoundary;
    // At a boundary, timerSegIdx has already advanced to the NEXT segment — its
    // kind drives the orb colour and copy (work just ended → break next = calm).
    const isBreak     = isActive ? TIMER_SEQ[timerSegIdx].kind === 'break' : false;
    const isCalm      = atBoundary && isBreak;
    const paused      = isActive && !timerRunning && !timerAtBoundary;
    const stateClass  = isBreak ? 'break' : 'work';

    // Show overlay + drive orb visuals via class swaps (keeps colour/breathe smooth)
    // display:flex overrides the base .focus-zone{display:none}; mobile hides via !important
    fz.style.display = 'flex';
    requestAnimationFrame(() => fz.classList.add('active'));
    fz.classList.toggle('break', isBreak);
    if (orbEl)  orbEl.className  = `orb ${stateClass}${paused ? ' paused' : ''}`;
    if (glowEl) glowEl.className = `orb-glow ${stateClass}${paused ? ' paused' : ''}`;
    fdoc.getElementById('doing-cards-row')?.setAttribute('data-id', task.id);
    if (_pipWin) {
      // At a boundary, keep a slow settle-pulse ring on the PiP stage (the brief
      // attention grab is fired once in _timerTick). Cleared when not at a boundary.
      const stage = _pipWin.document.getElementById('pip-stage');
      stage?.classList.toggle('boundary-settle', atBoundary);
      if (!atBoundary) stage?.classList.remove('boundary-nudge');
    }

    // Top-left meta: label · tags · title · big timer · sub (work/break + elapsed, or boundary copy)
    const boundaryMsg = isCalm
      ? '✓ Focus block done. Take five — you earned it.'
      : "Break's over. Time to get back to it.";
    const elapsed = (isActive && timerTask ? timerTask._elapsed : 0) || 0;
    const subHtml = atBoundary
      ? `<span class="fmeta-boundary ${isCalm ? 'calm' : 'pushy'}">${boundaryMsg}</span>`
      : isBreak
        ? 'break · step away'
        : `work · <span class="doing-elapsed-val">${elapsed}m</span> elapsed`;
    meta.innerHTML = `
      <p class="fmeta-label">${isBreak ? 'Breathe' : 'Flow state'}</p>
      <p class="fmeta-title">${esc(task.title)}</p>
      <div class="focus-clock-time" id="focus-clock-time">--<span class="fc-colon">:</span>--</div>
      <p class="fmeta-sub">${subHtml}</p>`;

    // Bottom controls — minimal, low contrast.
    // Layout reads spatially: Return to Next (backward) left · main action middle · Done (forward) right.
    const backBtn = `<button class="oc-btn" onclick="App.removeFromDoing('${task.id}')">Return to Next</button>`;
    const doneBtn = `<button class="oc-btn" onclick="App.markDoingDone('${task.id}')">Done</button>`;
    // Float/Dock — only when Document PiP is available (Chromium). Pops the orb into
    // an always-on-top window that follows the user across apps.
    const floatBtn = !_pipSupported ? ''
      : _pipWin ? `<button class="oc-btn" onclick="App.closeFocusPip()">Dock orb</button>`
      : `<button class="oc-btn" onclick="App.openFocusPip()">Float ↗</button>`;
    if (atBoundary) {
      const n = TIMER_SEQ[timerSegIdx].m;
      controls.innerHTML = `${backBtn}
        <button class="oc-btn primary" onclick="App.startNextSegment()">Start ${n}-min ${isBreak ? 'break' : 'work'} ›</button>${doneBtn}${floatBtn}`;
    } else if (!isActive) {
      controls.innerHTML = `${backBtn}
        <button class="oc-btn primary" onclick="App.activateTask('${task.id}')">Start focus</button>${doneBtn}${floatBtn}`;
    } else {
      controls.innerHTML = `${backBtn}
        <button class="oc-btn primary" onclick="App.timerTogglePlay()">${isRunning ? 'Pause' : 'Resume'}</button>
        <button class="oc-btn" onclick="App.skipSegment()">Skip</button>${doneBtn}${floatBtn}`;
    }

    if (_pipWin) _renderPipExtras(task, { isActive, isRunning, atBoundary, isBreak });
    _renderClock();
  }

  // ── PiP float — detach the orb into an always-on-top window ──
  // Document PiP shares this JS realm, so the live timer keeps running; we just
  // relocate the orb DOM (#doing-cards-row) between #focus-zone and the PiP body.
  function _focusDoc() { return _pipWin ? _pipWin.document : document; }

  async function openFocusPip() {
    if (!_pipSupported || _pipWin) return;
    const orbArea = document.getElementById('doing-cards-row');
    if (!orbArea) return;
    let pip;
    try {
      pip = await window.documentPictureInPicture.requestWindow({ width: 220, height: 220 });
    } catch (e) { return; } // gesture/permission rejected — stay docked
    _pipWin = pip;
    // Carry the stylesheet across (tokens, .orb gradients, keyframes) + compact layer.
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => {
      pip.document.head.appendChild(node.cloneNode(true));
    });
    pip.document.body.className = 'pip-orb';
    // Inline onclick="App.*" handlers in the PiP doc resolve App via the PiP global.
    pip.App = App;
    // Stage: the relocated orb subtree + a hover overlay (remaining time + controls).
    const stage = pip.document.createElement('div');
    stage.className = 'pip-stage';
    stage.id = 'pip-stage';
    const hover = pip.document.createElement('div');
    hover.className = 'pip-hover';
    hover.id = 'pip-hover';
    stage.appendChild(orbArea);   // moves the live node into the PiP document
    stage.appendChild(hover);
    pip.document.body.appendChild(stage);
    pip.addEventListener('pagehide', closeFocusPip);
    _renderFocusRow();
  }

  function closeFocusPip() {
    const pip = _pipWin;
    if (!pip) return;
    _pipWin = null; // null first so re-entrancy from pagehide is a no-op
    // Return the orb subtree to the full-screen overlay, before the controls section.
    const orbArea = pip.document.getElementById('doing-cards-row');
    const fz = document.getElementById('focus-zone');
    const anchor = document.getElementById('doing-section');
    if (orbArea && fz) fz.insertBefore(orbArea, anchor);
    try { pip.close(); } catch (e) {}
    _renderFocusRow();
  }

  // Render the PiP hover overlay (remaining time + compact controls) to current state.
  function _renderPipExtras(task, { isActive, isRunning, atBoundary, isBreak }) {
    const hover = _pipWin && _pipWin.document.getElementById('pip-hover');
    if (!hover) return;
    // Uniform buttons (no .primary emphasis) — the tiny float reads calmer, and
    // every control only brightens on hover. The PiP title bar's native
    // back-to-tab button already docks the orb, so no custom Dock button here.
    const back = `<button class="oc-btn" onclick="App.removeFromDoing('${task.id}')">Return</button>`;
    const done = `<button class="oc-btn" onclick="App.markDoingDone('${task.id}')">Done</button>`;
    let mid;
    if (atBoundary) {
      const n = TIMER_SEQ[timerSegIdx].m;
      mid = `<button class="oc-btn" onclick="App.startNextSegment()">Start ${n}m ${isBreak ? 'break' : 'work'} ›</button>`;
    } else if (!isActive) {
      mid = `<button class="oc-btn" onclick="App.activateTask('${task.id}')">Start</button>`;
    } else {
      mid = `<button class="oc-btn" onclick="App.timerTogglePlay()">${isRunning ? 'Pause' : 'Resume'}</button>
        <button class="oc-btn" onclick="App.skipSegment()">Skip</button>`;
    }
    hover.innerHTML = `
      <div class="pip-clock" id="pip-clock-time">--<span class="fc-colon">:</span>--</div>
      <div class="pip-controls">${back}${mid}${done}</div>`;
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
    _saveCompletionDate(item.id);
    _syncSubtaskFromTask(item.id);
    Data.upsertTask(item);
    _renderFocusRow();
    renderBoard();
  }

  // ── Timer track ──
  // Superseded by the Focus Mode orb. Kept as a no-op so the ~9 existing call
  // sites (activate/tick/jump/boundary) don't need to change. Orb state is
  // rendered by _renderFocusRow(); segment progress lives in the orb itself.
  function _renderTimerTrack() {}

  // ── Timer logic ──
  function _startClock() {
    clearInterval(clockInterval);
    clockInterval = setInterval(_renderClock, 1000);
    _renderClock();
  }

  function _renderClock() {
    // The remaining-time readout exists on the main screen and, while floating,
    // also in the PiP hover overlay (#pip-clock-time). Write to whichever exist.
    let html;
    if (timerTask && timerSecsRemaining >= 0) {
      const m = String(Math.floor(timerSecsRemaining / 60)).padStart(2,'0');
      const s = String(timerSecsRemaining % 60).padStart(2,'0');
      html = `${m}<span class="fc-colon">:</span>${s}`;
    } else {
      const now = new Date();
      const m = String(now.getHours()).padStart(2,'0');
      const s = String(now.getMinutes()).padStart(2,'0');
      html = `${m}<span class="fc-colon">:</span>${s}`;
    }
    const el = document.getElementById('focus-clock-time');
    if (el) el.innerHTML = html;
    const pipEl = _pipWin && _pipWin.document.getElementById('pip-clock-time');
    if (pipEl) pipEl.innerHTML = html;
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
    if (timerTask && timerTask.id === id) { timerAtBoundary = false; _startTimer(); _renderFocusRow(); _renderTimerTrack(); return; }
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

  function _playStartChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
        [880, 1100].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.13);
          osc.connect(gain);
          osc.start(ctx.currentTime + i * 0.13);
          osc.stop(ctx.currentTime + i * 0.13 + 0.6);
        });
      };
      if (ctx.state === 'suspended') { ctx.resume().then(play); } else { play(); }
    } catch(e) {}
  }

  function _fireStartNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const isBreak = TIMER_SEQ[timerSegIdx].kind === 'break';
    const body = isBreak ? 'Break started — step away for a bit.' : 'Work session started — get after it.';
    try { new Notification('Grind & Flow', { body, icon: 'icon-192.png' }); } catch(e) {}
  }

  function _startTimer() {
    clearInterval(timerInterval);
    timerRunning = true;
    timerAtBoundary = false;
    _playStartChime();
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
      _pipBoundaryNudge();
    }
  }

  // Boundary cue while floating: a brief attention grab (one raise + stronger pulse)
  // that then settles into the slow ring-pulse from _renderFocusRow — a nudge to move
  // on, not a sustained alarm. The user can ignore it and finish their thought.
  function _pipBoundaryNudge() {
    if (!_pipWin) return;
    const stage = _pipWin.document.getElementById('pip-stage');
    if (!stage) return;
    try { _pipWin.focus(); } catch (e) {}
    stage.classList.add('boundary-nudge');
    setTimeout(() => stage.classList.remove('boundary-nudge'), 2600);
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
    _renderFocusRow(); _renderClock();
  }

  function startNextSegment() {
    if (!timerTask) return;
    timerAtBoundary = false;
    _startTimer();
    _renderFocusRow();
  }

  // Skip the current segment and start the next one immediately
  function skipSegment() {
    if (!timerTask) return;
    timerSegIdx = (timerSegIdx + 1) % TIMER_SEQ.length;
    timerSecsRemaining = TIMER_SEQ[timerSegIdx].m * 60;
    timerAtBoundary = false;
    _startTimer();
    _renderFocusRow();
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
      }
      // Completion date tracking
      if (colId === 'done') { _saveCompletionDate(item.id); _syncSubtaskFromTask(item.id); }
      else _clearCompletionDate(item.id);
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

  // ── Two-way subtask sync ──
  // When a task is marked done on the board, check off its parent subtask.
  function _syncSubtaskFromTask(taskId) {
    const task = Data.findItem(taskId);
    if (!task || task.type !== 'task' || !task.parentProject) return;
    const proj = Data.findProject(task.parentProject);
    if (!proj) return;
    const st = (proj.subtasks || []).find(s => s.promotedTaskId === taskId);
    if (st && !st.done) {
      st.done = true;
      Data.upsertProject(proj);
    }
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
    if (!st) return;
    st.done = checked;
    // Two-way sync: if checking a promoted subtask, mark the promoted task done
    if (checked && st.promoted && st.promotedTaskId) {
      const promotedTask = Data.findItem(st.promotedTaskId);
      if (promotedTask && promotedTask.status !== 'done') {
        promotedTask.status = 'done';
        _saveCompletionDate(promotedTask.id);
        Data.upsertTask(promotedTask);
      }
    }
    Data.upsertProject(proj);
    const span = document.getElementById('stspan-' + stId);
    if (span) span.className = 'st-title' + (checked ? ' done' : '');
    renderBoard();
  }
  // Replaces a subtask row element in-place with fresh HTML from _buildModalSubtaskRow.
  function _refreshSubtaskRow(projId, st) {
    const row = document.getElementById('sti-' + st.id);
    if (!row) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = _buildModalSubtaskRow(st, projId);
    row.replaceWith(tmp.firstElementChild);
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
    _refreshSubtaskRow(projId, st);
    renderBoard();
  }

  function _recallSubtask(projId, stId) {
    const proj = Data.findProject(projId); if (!proj) return;
    const st = proj.subtasks.find(s => s.id === stId);
    if (!st || !st.promoted) return;
    const promotedTaskId = st.promotedTaskId;
    st.promoted = false; st.loc = 'backlog';
    delete st.promotedTaskId;
    Data.upsertProject(proj);
    if (promotedTaskId) Data.deleteItem(promotedTaskId);
    _refreshSubtaskRow(projId, st);
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

  function _editSubtask(projId, stId, spanEl) {
    const proj = Data.findProject(projId); if (!proj) return;
    const st = proj.subtasks.find(s => s.id === stId); if (!st) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = st.title;
    input.className = 'st-title-edit';
    let saved = false;
    function commit() {
      if (saved) return; saved = true;
      const val = input.value.trim();
      if (val && val !== st.title) {
        st.title = val;
        Data.upsertProject(proj);
        // Keep promoted task title in sync
        if (st.promotedTaskId) {
          const task = Data.findItem(st.promotedTaskId);
          if (task) { task.title = val; Data.upsertTask(task); }
        }
      }
      _refreshSubtaskRow(projId, st);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = st.title; saved = true; input.blur(); _refreshSubtaskRow(projId, st); }
    });
    spanEl.replaceWith(input);
    input.focus(); input.select();
  }

  // Modal subtask row — hover-reveal promote, recall only if task not done
  // hidePromote = true when the project isn't saved yet (new-project modal)
  function _buildModalSubtaskRow(st, projId, hidePromote = false) {
    // Check if the promoted task is already done (no recall in that case)
    const promotedTask = st.promoted && st.promotedTaskId ? Data.findItem(st.promotedTaskId) : null;
    const promotedTaskDone = promotedTask && promotedTask.status === 'done';

    const onBoardBadge = st.promoted
      ? `<span class="st-on-board-badge">on board ↩</span>` : '';
    const recallBtn = st.promoted && !promotedTaskDone
      ? `<button class="st-recall" onclick="event.stopPropagation();App._recallSubtask('${projId}','${st.id}')">recall</button>` : '';
    const promoteBtn = !st.promoted && !st.done && !hidePromote
      ? `<button class="st-promote-btn" onclick="event.stopPropagation();App._promoteSubtask('${projId}','${st.id}')">↑ promote</button>` : '';
    const delBtn = !st.promoted && !hidePromote
      ? `<button class="st-del" onclick="event.stopPropagation();App._removeSubtask('${projId}','${st.id}')">✕</button>` : '';
    const newDelBtn = hidePromote && !st.promoted
      ? `<button class="st-del" onclick="event.stopPropagation();App._removeSubtask('${projId}','${st.id}')">✕</button>` : '';

    return `<div class="subtask-row-item" id="sti-${st.id}" draggable="true"
      ondragstart="App._stDragStart(event,'${projId}','${st.id}')"
      ondragend="App._stDragEnd(event)">
      <span class="st-handle">⠿</span>
      <input type="checkbox" ${st.done ? 'checked' : ''}
        onclick="event.stopPropagation()"
        onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
      <span class="st-title${st.done ? ' done' : ''}" id="stspan-${st.id}"
        onclick="event.stopPropagation();App._editSubtask('${projId}','${st.id}',this)"
        title="Click to edit">${esc(st.title)}</span>
      ${onBoardBadge}
      ${promoteBtn}
      ${recallBtn}
      ${hidePromote ? newDelBtn : delBtn}
    </div>`;
  }

  // ── Detail modal ──
  // ── Capacities integration helpers ──

  function _buildCapacitiesContent(item) {
    const parts = [];
    if (item.notes) parts.push('## Notes\n' + item.notes);
    if (item.dueDate) parts.push('**Due date:** ' + item.dueDate);
    if (item.tags && item.tags.length) parts.push('**Tags:** ' + item.tags.join(', '));
    return parts.join('\n\n');
  }

  function _buildCapacitiesSection(item) {
    if (item.capacitiesUrl) {
      return `
        <div class="modal-section" id="cap-section">
          <label class="modal-label">Capacities</label>
          <div class="cap-linked">
            <a class="cap-open-link" href="#" onclick="event.preventDefault();window.open('${esc(item.capacitiesUrl)}')">Open in Capacities ↗</a>
            <button class="cap-remove-link" onclick="App._removeCapacitiesUrl('${item.id}')">× remove link</button>
          </div>
        </div>`;
    }
    return `
      <div class="modal-section" id="cap-section">
        <label class="modal-label">Capacities</label>
        <div class="fg" style="margin-bottom:8px">
          <button class="btn-cap-create" onclick="App._openCapacitiesCreate('${item.id}')">Create Capacities project ↗</button>
        </div>
        <div class="fg">
          <label class="modal-label">Capacities object reference</label>
          <input type="text" class="modal-input" id="d-capacities-url"
            placeholder="Paste capacities:// link here..." />
        </div>
      </div>`;
  }

  function _openCapacitiesCreate(id) {
    const item = Data.findProject(id); if (!item) return;
    const url = `capacities://x-callback-url/createNewObject?type=Project&title=${encodeURIComponent(item.title)}&content=${encodeURIComponent(_buildCapacitiesContent(item))}`;
    window.open(url);
  }

  function _removeCapacitiesUrl(id) {
    const item = Data.findProject(id); if (!item) return;
    item.capacitiesUrl = null;
    Data.upsertProject(item);
    renderBoard();
    openDetail(id);
  }

  function openDetail(id) {
    const item = Data.findItem(id); if (!item) return;
    openItemId = id;
    history.replaceState(null, '', '#' + id);
    const isProject = item.type === 'project';
    const allTags = _loadTags();
    const itemTags = item.tags || [];

    const tagPillsHtml = allTags.map(t =>
      `<button class="modal-tag-pill ${_tagClasses(t, allTags)}${itemTags.includes(t) ? ' active' : ''}"
        onclick="App._toggleItemTag('${id}','${t}',this)"
        oncontextmenu="event.preventDefault();App._showTagMenu('${t}',this)">${t.toUpperCase()}</button>`
    ).join('');

    if (isProject) {
      // ── Project detail modal — new layout ──
      const statusOpts = [...PROJECT_COLS, { id: 'done', label: 'Done' }].map(c =>
        `<option value="${c.id}"${item.status === c.id ? ' selected' : ''}>${c.label}</option>`
      ).join('');

      // Sort subtasks: undone first, done below
      const sortedSubs = [...(item.subtasks || [])].sort((a, b) => (a.done === b.done) ? 0 : a.done ? 1 : -1);
      const subtaskRows = sortedSubs.map(st => _buildModalSubtaskRow(st, item.id)).join('') ||
        '<div style="font-size:12px;color:var(--muted);font-style:italic;padding:4px 0;font-family:var(--font-body)">No tasks yet</div>';

      const stateIsWaiting = item.waiting;
      const stateIsBlocked = item.blocked;
      const stateIsClear   = !stateIsWaiting && !stateIsBlocked;

      const autoWaitNote = item.waitingAuto
        ? `<div class="proj-auto-wait-note">Auto-set — a linked task is blocked.</div>` : '';

      const capSection = _buildCapacitiesSection(item);

      _showModal(`
        <input type="text" class="proj-modal-title-input" id="d-title" value="${esc(item.title)}" />
        <div class="modal-section">
          <div class="fg"><label class="modal-label">Tags</label>
            <div class="modal-tags-row" id="modal-tags-row">${tagPillsHtml}</div>
            <div class="modal-tag-add" style="margin-top:7px">
              <input type="text" id="new-tag-input" placeholder="New tag..." />
              <button onclick="App._addCustomTag('${id}')">+ add tag</button>
            </div>
          </div>
          <div class="proj-modal-grid" style="grid-template-columns:1fr 1fr">
            <div class="fg"><label class="modal-label">Status</label>
              <select class="modal-input" id="d-status" data-prev="${item.status}"
                onchange="App._onProjStatusChange('${id}',this)">${statusOpts}</select>
              <div id="status-done-msg" style="display:none;font-size:10px;color:#C98B2A;margin-top:5px"></div>
            </div>
            <div class="fg"><label class="modal-label">Due date</label>
              <input type="date" class="modal-input" id="d-due" value="${item.dueDate || ''}" /></div>
          </div>
          <div class="fg"><label class="modal-label">Notes</label>
            <textarea class="modal-input" id="d-notes" style="height:52px;resize:vertical">${esc(item.notes || '')}</textarea></div>
        </div>
        <div class="modal-section">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px">
            <label class="modal-label" style="margin-bottom:0">Tasks</label>
            <span style="font-size:9px;color:var(--muted);font-style:italic">drag to reorder</span>
          </div>
          <div class="subtask-list" id="stlist-${item.id}"
            ondragover="App._stListDragOver(event,'${item.id}')"
            ondrop="App._stListDrop(event,'${item.id}')">
            ${subtaskRows}
          </div>
          <div style="display:flex;gap:5px;margin-top:7px">
            <input type="text" class="modal-input" id="new-st-${item.id}" placeholder="Add task..."
              onkeydown="if(event.key==='Enter')App._addSubtask('${item.id}')" />
            <button class="btn-close" onclick="App._addSubtask('${item.id}')">+ add</button>
          </div>
        </div>
        <div class="modal-section">
          <label class="modal-label" style="margin-bottom:7px">State</label>
          <div class="proj-state-seg">
            <button class="proj-state-seg-btn${stateIsClear ? ' active' : ''}" id="pstate-clear" onclick="App._setProjState('${id}','clear')">Clear</button>
            <button class="proj-state-seg-btn${stateIsWaiting ? ' active' : ''}" id="pstate-waiting" onclick="App._setProjState('${id}','waiting')">Waiting</button>
            <button class="proj-state-seg-btn${stateIsBlocked ? ' active' : ''}" id="pstate-blocked" onclick="App._setProjState('${id}','blocked')">Blocked</button>
          </div>
          ${autoWaitNote}
          <textarea class="modal-input" id="d-waiting-reason" style="margin-top:8px;height:36px;resize:none;display:${stateIsWaiting ? 'block' : 'none'}" placeholder="Reason...">${esc(item.waitingReason || '')}</textarea>
          <textarea class="modal-input" id="d-blocked-reason" style="margin-top:8px;height:36px;resize:none;display:${stateIsBlocked ? 'block' : 'none'}" placeholder="Reason...">${esc(item.blockedReason || '')}</textarea>
        </div>
        ${capSection}
        <div class="modal-footer">
          <div id="del-zone"><button class="btn-danger" onclick="App._showDelConfirm('${id}')">Delete</button></div>
          <div class="modal-footer-right">
            <button class="btn-close" onclick="App._closeDetail()">Cancel</button>
            <button class="btn-save" onclick="App._saveDetail('${id}');App._closeDetail()">Save</button>
          </div>
        </div>`, id);
      return;
    }

    // ── Task detail modal — unchanged layout ──
    const cols = TASK_COLS;
    const moveBtns = cols.map(c =>
      `<button class="move-btn${item.status === c.id ? ' current' : ''}"
        onclick="App._moveItem('${id}','${c.id}',this)">${c.label}</button>`
    ).join('');

    const allProjects = (Data.get().projects || []).filter(p => p.status !== 'done');
    const projLinkHtml = `<div class="fg"><label class="modal-label">Project</label>
      <select class="modal-input" id="d-parent-project">
        <option value="">— none —</option>
        ${allProjects.map(p => `<option value="${p.id}"${item.parentProject === p.id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}
      </select></div>`;

    const blockedSection = `<div class="fg"><label class="modal-label">Blocked?</label>
        <div class="blocked-toggle">
          <button class="blocked-opt${!item.blocked ? ' active-no' : ''}" id="bno" onclick="App._setBlocked('${id}',false)">✓ Clear</button>
          <button class="blocked-opt${item.blocked ? ' active-yes' : ''}" id="byes" onclick="App._setBlocked('${id}',true)">⏸ Blocked</button>
        </div>
        <input type="text" class="modal-input" id="d-blocked-reason"
          placeholder="Reason (optional)..." value="${esc(item.blockedReason || '')}"
          style="margin-top:7px;display:${item.blocked ? 'block' : 'none'}" />
      </div>`;

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
        ${blockedSection}
      </div>
      <div class="modal-footer">
        <div id="del-zone"><button class="btn-danger" onclick="App._showDelConfirm('${id}')">Delete</button></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="App._closeDetail()">Close</button>
          <button class="btn-save" onclick="App._saveDetail('${id}');App._closeDetail()">Save</button>
        </div>
      </div>`, id);
  }

  // Three-way state segmented control for project detail modal
  function _setProjState(id, state) {
    const item = Data.findProject(id); if (!item) return;
    item.blocked     = (state === 'blocked');
    item.waiting     = (state === 'waiting');
    item.waitingAuto = false; // manual override clears auto flag
    Data.upsertProject(item);
    // Update segmented buttons
    ['clear','waiting','blocked'].forEach(s => {
      document.getElementById('pstate-' + s)?.classList.toggle('active', s === state);
    });
    // Show/hide reason textareas
    const waitTa = document.getElementById('d-waiting-reason');
    const blkTa  = document.getElementById('d-blocked-reason');
    if (waitTa) waitTa.style.display = state === 'waiting' ? 'block' : 'none';
    if (blkTa)  blkTa.style.display  = state === 'blocked'  ? 'block' : 'none';
  }

  function _onProjStatusChange(id, sel) {
    const msg     = document.getElementById('status-done-msg');
    const saveBtn = document.querySelector('#modal-root .btn-save');
    if (sel.value === 'done') {
      const activeTasks = Data.get().tasks.filter(t => t.parentProject === id);
      if (activeTasks.length > 0) {
        const n = activeTasks.length;
        if (msg) { msg.textContent = `${n} task${n > 1 ? 's' : ''} still active — complete or delete them first`; msg.style.display = 'block'; }
        if (saveBtn) saveBtn.disabled = true;
        sel.value = sel.dataset.prev || 'active'; // revert dropdown
        return;
      }
    }
    if (msg) msg.style.display = 'none';
    if (saveBtn) saveBtn.disabled = false;
    sel.dataset.prev = sel.value;
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
    if (!allTags.includes(tag)) { Data.upsertTag(tag, null); }
    const item = Data.findItem(itemId);
    if (item) { item.tags = item.tags || []; if (!item.tags.includes(tag)) item.tags.push(tag); item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item); }
    // Refresh tags row
    const row = document.getElementById('modal-tags-row');
    if (row) {
      const refreshedTags = _loadTags();
      const itemTags = item?.tags || [];
      row.innerHTML = refreshedTags.map(t =>
        `<button class="modal-tag-pill ${_tagClasses(t, refreshedTags)}${itemTags.includes(t) ? ' active' : ''}"
          onclick="App._toggleItemTag('${itemId}','${t}',this)"
          oncontextmenu="event.preventDefault();App._showTagMenu('${t}',this)">${t.toUpperCase()}</button>`
      ).join('');
    }
    if (input) input.value = '';
  }

  // Adds a new custom tag from the new-item modal (no existing item — just saves to
  // localStorage and appends an active pill to the row so _saveNew() picks it up).
  function _addNewTag() {
    const input = document.getElementById('new-tag-input');
    const tag = input?.value.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
    if (!tag) return;
    const allTags = _loadTags();
    if (!allTags.includes(tag)) { Data.upsertTag(tag, null); }
    const row = document.getElementById('new-modal-tags-row');
    if (row && !row.querySelector(`[data-tag="${tag}"]`)) {
      const freshTags = _loadTags();
      const btn = document.createElement('button');
      btn.className = `modal-tag-pill ${_tagClasses(tag, freshTags)} active`;
      btn.dataset.tag = tag;
      btn.onclick = function() { this.classList.toggle('active'); };
      btn.textContent = tag.toUpperCase();
      row.appendChild(btn);
    } else if (row) {
      // Tag already in row — just make it active
      const existing = row.querySelector(`[data-tag="${tag}"]`);
      if (existing) existing.classList.add('active');
    }
    if (input) input.value = '';
  }

  // ── Tag context menu (right-click on any modal pill) ──

  const SLOT_HEX = ['#7a5298','#9c5570','#a83232','#4e7a58','#5b9ea8'];

  function _dismissTagMenu() {
    const m = document.getElementById('tag-menu');
    if (m) m.remove();
  }

  function _showTagMenu(tagName, el) {
    _dismissTagMenu();
    const allTags = _loadTags();
    const overrides = _loadTagColors();
    // Determine currently selected slot
    let currentSlot;
    if (tagName in overrides) {
      currentSlot = overrides[tagName] % 5;
    } else if (BUILT_IN_TAGS.includes(tagName)) {
      currentSlot = null; // using built-in color, no slot selected
    } else {
      const customTags = allTags.filter(x => !BUILT_IN_TAGS.includes(x));
      currentSlot = customTags.indexOf(tagName) % 5;
    }

    const swatchHtml = SLOT_HEX.map((hex, i) =>
      `<div class="tag-swatch${currentSlot === i ? ' selected' : ''}" style="background:${hex}"
        onclick="App._setTagColor('${tagName}',${i})" title="Color ${i+1}"></div>`
    ).join('');

    // Count how many items currently use this tag
    const state = Data.get();
    const usageCount = [...(state.tasks||[]), ...(state.projects||[])]
      .filter(i => (i.tags||[]).includes(tagName)).length;

    const menu = document.createElement('div');
    menu.id = 'tag-menu';
    menu.className = 'tag-menu';
    menu.innerHTML = `
      <div class="tag-menu-name">${tagName.toUpperCase()}</div>
      <div class="tag-menu-swatches">${swatchHtml}</div>
      <hr class="tag-menu-divider">
      <div id="tag-menu-del-zone">
        <button class="tag-menu-delete" onclick="App._confirmDeleteTag('${tagName}',${usageCount})">Delete tag</button>
      </div>`;

    // Position below the pill, clamped to viewport
    const rect = el.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 5) + 'px';
    menu.style.left = rect.left + 'px';
    document.body.appendChild(menu);

    // Clamp right edge
    const mRect = menu.getBoundingClientRect();
    if (mRect.right > window.innerWidth - 8) {
      menu.style.left = (window.innerWidth - 8 - mRect.width) + 'px';
    }

    // Dismiss on next outside click
    setTimeout(() => document.addEventListener('click', _dismissTagMenu, { once: true }), 0);
  }

  function _confirmDeleteTag(tagName, usageCount) {
    const zone = document.getElementById('tag-menu-del-zone');
    if (!zone) return;
    const msg = usageCount > 0
      ? `Removes from ${usageCount} item${usageCount !== 1 ? 's' : ''}.`
      : 'Not used on any items.';
    zone.innerHTML = `
      <div class="tag-menu-confirm">${msg}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="tag-menu-delete" style="width:auto" onclick="App._executeDeleteTag('${tagName}')">Yes, delete</button>
        <button class="tag-menu-cancel" onclick="App._dismissTagMenu()">Cancel</button>
      </div>`;
  }

  function _executeDeleteTag(tagName) {
    // Strip from all tasks and projects
    const state = Data.get();
    (state.tasks || []).forEach(t => {
      if ((t.tags || []).includes(tagName)) {
        t.tags = t.tags.filter(x => x !== tagName);
        Data.upsertTask(t);
      }
    });
    (state.projects || []).forEach(p => {
      if ((p.tags || []).includes(tagName)) {
        p.tags = p.tags.filter(x => x !== tagName);
        Data.upsertProject(p);
      }
    });
    // Remove from Supabase (handles both the tag entry and any color override)
    Data.deleteTag(tagName);

    _dismissTagMenu();
    renderBoard();
    _refreshModalTagRow();
  }

  function _setTagColor(tagName, slotIdx) {
    Data.upsertTag(tagName, slotIdx);
    _dismissTagMenu();
    renderBoard();
    _refreshModalTagRow();
  }

  // Re-renders whichever modal tag row is currently visible after a tag change.
  function _refreshModalTagRow() {
    const allTags = _loadTags();
    // Detail modal row
    const detailRow = document.getElementById('modal-tags-row');
    if (detailRow && openItemId) {
      const item = Data.findItem(openItemId);
      if (item) {
        const itemTags = item.tags || [];
        detailRow.innerHTML = allTags.map(t =>
          `<button class="modal-tag-pill ${_tagClasses(t, allTags)}${itemTags.includes(t) ? ' active' : ''}"
            onclick="App._toggleItemTag('${openItemId}','${t}',this)"
            oncontextmenu="event.preventDefault();App._showTagMenu('${t}',this)">${t.toUpperCase()}</button>`
        ).join('');
      }
    }
    // New-item modal row
    const newRow = document.getElementById('new-modal-tags-row');
    if (newRow) {
      const activeTags = [...newRow.querySelectorAll('.modal-tag-pill.active')].map(b => b.dataset.tag);
      newRow.innerHTML = allTags.map(t =>
        `<button class="modal-tag-pill ${_tagClasses(t, allTags)}${activeTags.includes(t) ? ' active' : ''}" data-tag="${t}"
          onclick="this.classList.toggle('active')"
          oncontextmenu="event.preventDefault();App._showTagMenu('${t}',this)">${t.toUpperCase()}</button>`
      ).join('');
    }
  }

  function _setBlocked(id, val) {
    const item = Data.findItem(id);
    if (item) {
      item.blocked = (val === true);
      if (item.type === 'project') {
        item.waiting     = (val === 'waiting');
        item.waitingAuto = false; // manually set — mark as non-auto so it stays sticky
        Data.upsertProject(item);
      } else {
        Data.upsertTask(item);
      }
    }
    document.getElementById('bno')?.classList.toggle('active-no',   val === false);
    document.getElementById('bwait')?.classList.toggle('active-wait', val === 'waiting');
    document.getElementById('byes')?.classList.toggle('active-yes',  val === true);
    const waitInput   = document.getElementById('d-waiting-reason');
    const reasonInput = document.getElementById('d-blocked-reason');
    if (waitInput)   waitInput.style.display   = (val === 'waiting') ? 'block' : 'none';
    if (reasonInput) reasonInput.style.display = (val === true)      ? 'block' : 'none';
  }

  function _moveItem(id, status, btn) {
    const item = Data.findItem(id);
    if (item) {
      const old = item.status; item.status = status;
      if (status === 'backlog' && old !== 'backlog') item.backlogEnteredAt = _today();
      if (status === 'done') { _saveCompletionDate(id); _syncSubtaskFromTask(id); }
      else _clearCompletionDate(id);
      item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item);
    }
    document.querySelectorAll('.move-btn').forEach(b => b.classList.remove('current'));
    btn?.classList.add('current');
    renderBoard();
  }

  // ── Inbox Review (vertical 3D task wheel) ──
  // Inbox is a review activity, not a browseable column. A wheel of tag-colored
  // dots turns one task to center at a time; you triage it (This Week / Later /
  // Delete), it rotates up into faded history (scroll back to Undo), and the next
  // unprocessed task centers. Deletes are staged and only applied on Close so they
  // stay undoable for the whole pass.
  const REVIEW_COLORS = {
    'tag-work': '#E85D3A', 'tag-school': '#6FB08C', 'tag-personal': '#5E9BD4',
    'tag-slot-0': '#8E86C9', 'tag-slot-1': '#E58AAE', 'tag-slot-2': '#E85D3A',
    'tag-slot-3': '#F2C94C', 'tag-slot-4': '#6FB08C',
  };
  let _reviewSeq = [];           // task ids in review order (snapshot at open)
  let _reviewOutcome = new Map(); // id → { action, snap:{status,backlogEnteredAt,laterCount} }
  let _reviewCenterId = null;

  function _reviewColor(item) {
    const t = (item.tags || [])[0];
    if (!t) return '#2A2A28';
    return REVIEW_COLORS[_tagClasses(t, _loadTags())] || '#2A2A28';
  }

  function _reviewOrder(items) {
    return items.slice().sort((a, b) => {
      const ad = a.dueDate || '', bd = b.dueDate || '';
      if (ad && bd && ad !== bd) return ad.localeCompare(bd);
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      const aa = a.backlogEnteredAt || a.dateAdded || '';
      const ba = b.backlogEnteredAt || b.dateAdded || '';
      return aa.localeCompare(ba);
    });
  }

  function openInboxReview() {
    const backlog = Data.get().tasks.filter(t => t.status === 'backlog');
    _reviewSeq = _reviewOrder(backlog).map(t => t.id);
    _reviewOutcome = new Map();
    _reviewCenterId = _reviewSeq[0] || null;
    const el = document.getElementById('inbox-review');
    if (!el) return;
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('active'));
    _renderInboxReview();
  }

  function closeInboxReview() {
    // Flush staged deletes
    _reviewOutcome.forEach((o, id) => { if (o.action === 'delete') Data.deleteItem(id); });
    const el = document.getElementById('inbox-review');
    if (el) { el.classList.remove('active'); el.style.display = 'none'; el.innerHTML = ''; }
    renderBoard();
  }

  function _reviewAdvance() {
    _reviewCenterId = _reviewSeq.find(id => !_reviewOutcome.has(id)) || null;
    _renderInboxReview();
  }
  function _reviewCenter(id) { _reviewCenterId = id; _renderInboxReview(); }
  function _reviewScroll(dir) {
    const ci = _reviewSeq.indexOf(_reviewCenterId);
    const ni = Math.max(0, Math.min(_reviewSeq.length - 1, ci + (dir > 0 ? 1 : -1)));
    if (ni !== ci) { _reviewCenterId = _reviewSeq[ni]; _renderInboxReview(); }
  }

  const _REVIEW_OUTCOME_LABEL = { 'this-week': '→ This week', 'later': 'Deferred', 'delete': 'Will delete' };

  function _renderInboxReview() {
    const el = document.getElementById('inbox-review');
    if (!el) return;
    const total = _reviewSeq.length;
    const processed = _reviewSeq.filter(id => _reviewOutcome.has(id)).length;

    // Inbox zero — all processed (or nothing to review)
    if (!total || processed >= total) {
      el.innerHTML = `
        <div class="ir-empty">
          <div class="ir-empty-mark">✓</div>
          <div class="ir-empty-title">Inbox zero</div>
          <div class="ir-empty-sub">Nothing left to review.</div>
          <button class="btn" onclick="App.closeInboxReview()">Close</button>
        </div>`;
      return;
    }

    const centerIdx = _reviewSeq.indexOf(_reviewCenterId);
    const MAXOFF = 4;
    const nodes = _reviewSeq.map((id, i) => {
      const off = i - centerIdx;
      if (Math.abs(off) > MAXOFF) return '';
      const item = Data.findItem(id);
      if (!item) return '';
      const isCenter = off === 0;
      const ad = Math.abs(off);
      const outcome = _reviewOutcome.get(id);
      // Curved wheel: sine spacing compresses toward the edges + perspective tilt
      const yPx = 330 + 270 * Math.sin(off * 0.34);
      const scale = isCenter ? 1 : Math.max(0.55, 1 - ad * 0.13);
      const opacity = isCenter ? 1 : Math.max(0.16, 1 - ad * 0.28);
      const tilt = Math.max(-60, Math.min(60, off * 14));
      const dotSize = isCenter ? 30 : 15;
      const color = _reviewColor(item);

      const dot = `<div class="ir-dot${isCenter ? ' center' : ''}${outcome ? ' done' : ''}"
        style="top:${yPx}px;width:${dotSize}px;height:${dotSize}px;background:${color};opacity:${opacity}"
        onclick="App._reviewCenter('${id}')"></div>`;

      let body;
      if (isCenter) {
        let ageHtml = '';
        if (item.backlogEnteredAt) {
          const days = _daysDiff(item.backlogEnteredAt);
          const cls = days >= 14 ? 'old' : days >= 7 ? 'stale' : '';
          ageHtml = `<span class="age-counter${cls ? ' ' + cls : ''}">${_ageLabel(item.backlogEnteredAt)}</span>`;
        }
        let dueHtml = '';
        if (item.dueDate) {
          const dd = new Date(item.dueDate + 'T00:00:00');
          dueHtml = `<span class="ir-due">due ${dd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>`;
        }
        const bumped = item.laterCount > 0 ? `<span class="ir-bumped">bumped ${item.laterCount}×</span>` : '';
        const meta = [dueHtml, ageHtml, bumped].filter(Boolean).join('<span class="ir-dotsep">·</span>');
        const actions = outcome
          ? `<div class="ir-actions"><span class="ir-outcome o-${outcome.action}">${_REVIEW_OUTCOME_LABEL[outcome.action]}</span>
               <button class="ir-act undo" onclick="App._reviewUndo('${id}')">Undo</button></div>`
          : `<div class="ir-actions">
               <button class="ir-act tw" onclick="App._reviewThisWeek('${id}')">This Week</button>
               <button class="ir-act" onclick="App._sendToLater('${id}',true)">Later</button>
               <button class="ir-act del" onclick="App._reviewDelete('${id}')">Delete</button>
             </div>`;
        body = `<div class="ir-title">${esc(item.title)}</div>
          ${meta ? `<div class="ir-meta">${meta}</div>` : ''}
          ${actions}`;
      } else {
        body = `<div class="ir-title sm">${esc(item.title)}</div>
          ${outcome ? `<span class="ir-outcome o-${outcome.action} sm">${_REVIEW_OUTCOME_LABEL[outcome.action]}</span>` : ''}`;
      }
      const row = `<div class="ir-row${isCenter ? ' center' : ''}${outcome ? ' done' : ''}"
        style="top:${yPx}px;transform:translateY(-50%) perspective(1200px) rotateX(${tilt}deg) scale(${scale});opacity:${opacity}"
        onclick="${isCenter ? '' : `App._reviewCenter('${id}')`}">${body}</div>`;
      return dot + row;
    }).join('');

    el.innerHTML = `
      <div class="ir-head">
        <div class="ir-head-left">
          <div class="ir-title-h">Inbox Review</div>
          <div class="ir-sub">${processed} of ${total} reviewed</div>
        </div>
        <button class="ir-close" onclick="App.closeInboxReview()">Done</button>
      </div>
      <div class="ir-fade top"></div>
      <div class="ir-fade bot"></div>
      <div class="ir-spine"></div>
      <div class="ir-wheel" id="ir-wheel">${nodes}</div>`;

    if (!el._wheelBound) {
      el._wheelBound = true;
      el.addEventListener('wheel', (e) => { e.preventDefault(); _reviewScroll(e.deltaY); }, { passive: false });
    }
  }

  function _reviewThisWeek(id) {
    const item = Data.findItem(id); if (!item) return;
    _reviewOutcome.set(id, { action: 'this-week', snap: { status: item.status, backlogEnteredAt: item.backlogEnteredAt, laterCount: item.laterCount || 0 } });
    _moveItem(id, 'this-week');
    _reviewAdvance();
  }

  function _sendToLater(id, fromReview) {
    const item = Data.findItem(id);
    if (!item) return;
    if (fromReview) _reviewOutcome.set(id, { action: 'later', snap: { status: item.status, backlogEnteredAt: item.backlogEnteredAt, laterCount: item.laterCount || 0 } });
    if (item.status !== 'backlog') item.backlogEnteredAt = _today();
    item.status = 'backlog';
    item.laterCount = (item.laterCount || 0) + 1;
    Data.upsertTask(item);
    if (fromReview) _reviewAdvance();
    else renderBoard();
  }

  function _reviewDelete(id) {
    // Staged — actual deletion happens on Close so it stays undoable this pass
    _reviewOutcome.set(id, { action: 'delete', snap: null });
    _reviewAdvance();
  }

  function _reviewUndo(id) {
    const o = _reviewOutcome.get(id);
    if (o && o.snap) {
      const item = Data.findItem(id);
      if (item) {
        item.status = o.snap.status;
        item.backlogEnteredAt = o.snap.backlogEnteredAt;
        item.laterCount = o.snap.laterCount;
        Data.upsertTask(item);
      }
    }
    _reviewOutcome.delete(id);
    _reviewCenter(id);
  }

  function _saveDetail(id) {
    const item = Data.findItem(id); if (!item) return;
    const t  = document.getElementById('d-title');
    const d  = document.getElementById('d-due');
    const s  = document.getElementById('d-sched');
    const tm = document.getElementById('d-time');
    const n  = document.getElementById('d-notes');
    const r  = document.getElementById('d-blocked-reason');
    const wr = document.getElementById('d-waiting-reason');
    if (t && t.value.trim()) item.title = t.value.trim();
    if (d)  item.dueDate       = d.value  || '';
    if (s)  item.scheduledDate = s.value  || '';
    if (tm) item.scheduledTime = tm.value || '';
    if (n)  item.notes         = n.value  || '';
    if (r)  item.blockedReason  = r.value  || '';
    if (wr) item.waitingReason  = wr.value || '';
    if (item.type === 'project') {
      const statusSel = document.getElementById('d-status');
      if (statusSel) {
        const newStatus = statusSel.value;
        if (newStatus === 'done') {
          const activeTasks = Data.get().tasks.filter(t => t.parentProject === id);
          if (activeTasks.length > 0) return; // hard block — validation should have caught this
          if (!item.completedAt || item.status !== 'done') {
            item.completedAt = new Date().toISOString();
          }
        } else if (item.status === 'done' && newStatus !== 'done') {
          item.completedAt = null;
        }
        item.status = newStatus;
      }
      const capInput = document.getElementById('d-capacities-url');
      if (capInput && capInput.value.trim().startsWith('capacities://')) {
        item.capacitiesUrl = capInput.value.trim();
      }
      Data.upsertProject(item);
    } else {
      const projSel = document.getElementById('d-parent-project');
      if (projSel !== null) {
        const newParent = projSel.value || null;
        item.parentProject = newParent;
        item.type = newParent ? 'task' : 'standalone';
      }
      Data.upsertTask(item);
    }
  }

  function _closeDetail() {
    openItemId = null;
    history.replaceState(null, '', location.pathname);
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
        <div class="modal-tags-row" id="new-modal-tags-row">
          ${allTags.map(t => `<button class="modal-tag-pill ${_tagClasses(t, allTags)}" data-tag="${t}"
            onclick="this.classList.toggle('active')"
            oncontextmenu="event.preventDefault();App._showTagMenu('${t}',this)">${t.toUpperCase()}</button>`).join('')}
        </div>
        <div class="modal-tag-add">
          <input type="text" id="new-tag-input" placeholder="New tag..."
            onkeydown="if(event.key==='Enter'){event.preventDefault();App._addNewTag();}" />
          <button onclick="App._addNewTag()">+ add</button>
        </div></div>
      <div class="fg"><label class="modal-label">Status</label>
        <select class="modal-input" id="f-status">${statusOpts}</select></div>
      ${view === 'tasks' ? `<div class="field-row">
        <div class="fg"><label class="modal-label">Scheduled date</label>
          <input type="date" class="modal-input" id="f-sched" /></div>
        <div class="fg"><label class="modal-label">Scheduled time</label>
          <input type="time" class="modal-input" id="f-sched-time" /></div>
      </div>` : ''}
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
      Data.upsertProject({ id, type:'project', title, status, tags, dueDate:due, notes, dateAdded:_today(), subtasks, blocked:false });
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

  // ── Mobile capture ──
  function addMobileCapture(e) {
    e.preventDefault();
    const input = document.getElementById('mobile-capture-input');
    const title = input?.value.trim();
    if (!title) return;
    const id = 't' + Date.now();
    Data.upsertTask({
      id, type: 'standalone', title, status: 'backlog',
      tags: [], parentProject: null, dueDate: '', scheduledDate: '',
      scheduledTime: '', notes: '', dateAdded: _today(),
      backlogEnteredAt: _today(), blocked: false,
    });
    if (input) input.value = '';
    renderBoard();
  }

  // ── Mobile inbox bottom sheet ──
  function _openInboxSheet(id) {
    const item = Data.findItem(id); if (!item) return;
    const allTags = _loadTags();
    const itemTags = item.tags || [];

    const tagPillsHtml = allTags.map(t =>
      `<button class="modal-tag-pill ${_tagClasses(t, allTags)}${itemTags.includes(t) ? ' active' : ''}"
        data-tag="${t}"
        onclick="App._inboxToggleTag('${id}','${t}',this)">${t.toUpperCase()}</button>`
    ).join('');

    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="bs-overlay" onclick="App._closeInboxSheet()">
        <div class="bottom-sheet" onclick="event.stopPropagation()">
          <div class="bs-handle-row">
            <div class="bs-handle"></div>
            <button class="bs-close" onclick="App._closeInboxSheet()">✕</button>
          </div>
          <div class="bs-title">${esc(item.title)}</div>

          <div class="bs-quick-actions">
            <button class="bs-quick-btn bs-complete" onclick="App._inboxComplete('${id}')">
              <span class="bs-quick-icon">✓</span>Complete
            </button>
            <button class="bs-quick-btn bs-this-week" onclick="App._inboxMove('${id}','this-week')">
              <span class="bs-quick-icon">▸</span>This Week
            </button>
            <button class="bs-quick-btn bs-next-up" onclick="App._inboxMove('${id}','next')">
              <span class="bs-quick-icon">▹</span>Next Up
            </button>
          </div>

          <div class="bs-section">
            <label class="bs-label">Schedule</label>
            <input type="date" class="bs-date-input" id="bs-sched"
              value="${esc(item.scheduledDate || '')}"
              onchange="App._inboxSchedule('${id}',this.value)" />
          </div>

          <div class="bs-section">
            <label class="bs-label">Tags</label>
            <div class="bs-tags" id="bs-tags-row">${tagPillsHtml}</div>
          </div>

          <div class="bs-section">
            <label class="bs-label">Notes</label>
            <textarea class="bs-textarea" id="bs-notes"
              oninput="App._inboxSaveNotes('${id}',this.value)">${esc(item.notes || '')}</textarea>
          </div>

          <div class="bs-footer" id="bs-footer">
            <button class="bs-delete-btn" onclick="App._inboxConfirmDelete('${id}')">Delete task</button>
          </div>
        </div>
      </div>`;
  }

  function _closeInboxSheet() {
    document.getElementById('modal-root').innerHTML = '';
  }

  function _inboxComplete(id) {
    const item = Data.findItem(id); if (!item) return;
    item.status = 'done';
    Data.upsertTask(item);
    _saveCompletionDate(id);
    _closeInboxSheet();
    renderBoard();
  }

  function _inboxMove(id, status) {
    const item = Data.findItem(id); if (!item) return;
    item.status = status;
    _clearCompletionDate(id);
    Data.upsertTask(item);
    _closeInboxSheet();
    renderBoard();
  }

  function _inboxSchedule(id, date) {
    const item = Data.findItem(id); if (!item) return;
    item.scheduledDate = date || '';
    Data.upsertTask(item);
    renderBoard();
  }

  function _inboxToggleTag(id, tag, el) {
    const item = Data.findItem(id); if (!item) return;
    item.tags = item.tags || [];
    if (item.tags.includes(tag)) {
      item.tags = item.tags.filter(t => t !== tag);
      el.classList.remove('active');
    } else {
      item.tags.push(tag);
      el.classList.add('active');
    }
    Data.upsertTask(item);
    renderBoard();
  }

  function _inboxSaveNotes(id, notes) {
    const item = Data.findItem(id); if (!item) return;
    item.notes = notes;
    Data.upsertTask(item);
  }

  function _inboxConfirmDelete(id) {
    const footer = document.getElementById('bs-footer');
    if (!footer) return;
    footer.innerHTML = `
      <div class="bs-delete-confirm">
        <span class="bs-delete-confirm-msg">Delete this task?</span>
        <button class="bs-confirm-no" onclick="App._inboxResetDelete('${id}')">Cancel</button>
        <button class="bs-confirm-yes" onclick="App._inboxDelete('${id}')">Delete</button>
      </div>`;
  }

  function _inboxResetDelete(id) {
    const footer = document.getElementById('bs-footer');
    if (!footer) return;
    footer.innerHTML = `<button class="bs-delete-btn" onclick="App._inboxConfirmDelete('${id}')">Delete task</button>`;
  }

  function _inboxDelete(id) {
    Data.deleteItem(id);
    _closeInboxSheet();
    renderBoard();
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
    restoreItem, deleteArchiveItem, confirmClearArchive,
    startTask, activateTask, timerTogglePlay, _timerJump, startNextSegment, skipSegment,
    openFocusPip, closeFocusPip,
    openInboxReview, closeInboxReview, _reviewThisWeek, _sendToLater,
    _reviewDelete, _reviewUndo, _reviewCenter, _reviewScroll,
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
    _onDoingDragOver, _onDoingDragLeave, _onDoingDrop,
    removeFromDoing, markDoingDone,
    _closeDetail, _saveDetail, _setBlocked, _setProjState, _onProjStatusChange, _moveItem,
    _showDelConfirm, _resetDelZone, _deleteItem,
    _toggleArchiveProject, _restoreDoneProject, _deleteDoneProject,
    _toggleSubtask, _promoteSubtask, _recallSubtask, _editSubtask, _addSubtask, _removeSubtask,
    _setNewType, _saveNew,
    _stDragStart, _stDragEnd, _stListDragOver, _stListDrop,
    _toggleProjOpen, _inlineAddSubtask,
    _toggleItemTag, _addCustomTag, _addNewTag,
    _showTagMenu, _confirmDeleteTag, _executeDeleteTag, _setTagColor, _dismissTagMenu,
    _filterToggleTag, _filterSetDate,
    _openCapacitiesCreate, _removeCapacitiesUrl,
    addMobileCapture, switchMobileTab,
    _openInboxSheet, _closeInboxSheet,
    _inboxComplete, _inboxMove, _inboxSchedule,
    _inboxToggleTag, _inboxSaveNotes,
    _inboxConfirmDelete, _inboxResetDelete, _inboxDelete,
  };
})();

// App.init() is called by auth.js once a valid session is confirmed.
// Do NOT add a DOMContentLoaded auto-init here — auth.js owns that gate.
