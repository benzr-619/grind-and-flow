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

  // Week (Calendar) view — offset in weeks from the current Mon-start week
  let _weekOffset = 0;

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
  let _boundaryFlashInterval = null; // interval that alternates orb amber↔blue at boundary
  // PiP float — the Document Picture-in-Picture window holding the orb (null = docked).
  // Shares this JS realm, so the timer keeps running with no cross-window messaging.
  let _pipWin = null;
  const _pipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

  // Clock
  let clockInterval = null;

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

  // Max tasks allowed in the Next column from auto-promotion.
  const MAX_NEXT_CAP = 5;

  // Daily rollover: advance overdue scheduled tasks to today, then auto-promote
  // today's tasks into the Next column (up to MAX_NEXT_CAP).
  function _dailyRollover() {
    const state = Data.get();
    const today = _today();

    // Step 1: tasks scheduled for a past day get their date moved to today
    const overdue = state.tasks.filter(t =>
      t.status === 'this-week' && t.scheduledDate && t.scheduledDate < today
    );
    overdue.forEach(t => { t.scheduledDate = today; Data.upsertTask(t); });

    // Step 2: auto-promote today's scheduled this-week tasks → next (capped)
    const currentNextCount = state.tasks.filter(t => t.status === 'next').length;
    const slots = Math.max(0, MAX_NEXT_CAP - currentNextCount);
    if (slots > 0) {
      const candidates = state.tasks
        .filter(t => t.status === 'this-week' && t.scheduledDate === today)
        .sort((a, b) => {
          const ao = a.dayOrder ?? Infinity, bo = b.dayOrder ?? Infinity;
          if (ao !== bo) return ao - bo;
          if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
          return (a.dateAdded || '').localeCompare(b.dateAdded || '');
        })
        .slice(0, slots);
      candidates.forEach(t => { t.status = 'next'; Data.upsertTask(t); });
    }
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
    _dailyRollover();             // advance overdue scheduled tasks + auto-promote to Next
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
  function _syncNavActions() {
    const actWeek = document.getElementById('act-week');
    if (actWeek) actWeek.classList.toggle('active', view === 'calendar' && !archiveOpen);
  }

  function switchView(v) {
    if (v === 'archive') { toggleArchive(); return; }
    view = v;
    archiveOpen = false;
    _pendingFade = true;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.getElementById('tab-' + v);
    if (tabEl) tabEl.classList.add('active');
    else document.getElementById('tab-tasks')?.classList.add('active');
    document.getElementById('tab-archive')?.classList.remove('active');
    _syncNavActions();
    renderBoard();
  }

  function toggleArchive() {
    archiveOpen = !archiveOpen;
    _pendingFade = true;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (archiveOpen) document.getElementById('tab-archive')?.classList.add('active');
    else document.getElementById('tab-' + view)?.classList.add('active');
    _syncNavActions();
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
      titleEl.textContent = archiveOpen ? 'Archive' : view === 'projects' ? 'Projects' : view === 'calendar' ? 'Week' : 'Tasks';
    }

    // Board actions
    _syncNavActions();

    const actEl = document.getElementById('board-actions');
    if (actEl) {
      if (!archiveOpen) {
        actEl.innerHTML = `
          <button class="btn" onclick="App.openNewModal()">+ New ${view === 'projects' ? 'Project' : 'Task'}</button>
          ${view !== 'calendar' ? `<button class="btn btn-primary" id="filter-btn" onclick="App.toggleFilter(event)">Filters${filterTags.length || filterDate ? ' · ' + (filterTags.length + (filterDate ? 1 : 0)) : ''}</button>` : ''}`;
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
    } else if (view === 'calendar') {
      board.innerHTML = _renderWeekView();
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

      if (view === 'projects') {
        board.innerHTML = _renderProjCanvas(items);
      } else {
      board.innerHTML = `<div class="columns" data-cols="${cols.length}">${cols.map(col => {
        let colItems = items.filter(i => i.status === col.id);
        // This Week tasks tentatively scheduled into a FUTURE week are parked on the
        // calendar and hidden from the live column until their week arrives.
        if (col.id === 'this-week') {
          colItems = colItems.filter(i => !_isFutureWeek(i.scheduledDate));
        }
        // Backlog: sort oldest first
        if (col.id === 'backlog') {
          colItems = [...colItems].sort((a, b) => {
            const ad = a.backlogEnteredAt || a.dateAdded || '';
            const bd = b.backlogEnteredAt || b.dateAdded || '';
            return ad.localeCompare(bd);
          });
        }
        // This Week: scheduled items first (date + time), unscheduled at bottom
        if (col.id === 'this-week') {
          colItems = [...colItems].sort((a, b) => {
            const aKey = a.scheduledDate ? (a.scheduledDate + (a.scheduledTime || '')) : '9999';
            const bKey = b.scheduledDate ? (b.scheduledDate + (b.scheduledTime || '')) : '9999';
            return aKey.localeCompare(bKey);
          });
        }
        // Next: dayOrder asc (nulls last) → dueDate → dateAdded
        if (col.id === 'next') {
          colItems = [...colItems].sort((a, b) => {
            const ao = a.dayOrder ?? Infinity, bo = b.dayOrder ?? Infinity;
            if (ao !== bo) return ao - bo;
            const ad = a.dueDate || '9999', bd = b.dueDate || '9999';
            if (ad !== bd) return ad.localeCompare(bd);
            return (a.dateAdded || '').localeCompare(b.dateAdded || '');
          });
        }
        // First task indicator for Next column (top dayOrder task)
        const firstDayOrderId = col.id === 'next'
          ? colItems.find(i => i.dayOrder != null)?.id
          : null;
        // "N waiting" note: this-week tasks scheduled today that weren't promoted
        const todayStr = _today();
        const waitingCount = col.id === 'this-week'
          ? colItems.filter(i => i.scheduledDate === todayStr).length : 0;
        const waitingNote = waitingCount > 0
          ? `<div class="col-waiting-note">↓ ${waitingCount} ready for Next</div>` : '';
        return `<div class="col-wrap">
          <div class="col-head${col.id === 'this-week' ? ' this-week' : ''}">
            <span class="col-name">${col.label.toUpperCase()}</span>
            <span class="col-count">${String(colItems.length).padStart(2,'0')}</span>
          </div>
          <div class="col-body" data-col="${col.id}"
            ondragover="App._onDragOver(event,'${col.id}')"
            ondragleave="App._onDragLeave(event)"
            ondrop="App._onDrop(event,'${col.id}')">
            ${waitingNote}
            ${colItems.map(i => _renderTaskCard(i, col.id, { isFirst: i.id === firstDayOrderId })).join('')}
            ${colItems.length === 0 ? `<div class="col-empty">empty</div>` : ''}
            ${col.id !== 'done' ? `<button class="add-col-btn" onclick="App.openNewModal('${col.id}')">+ add</button>` : ''}
          </div>
        </div>`;
      }).join('')}
      <div class="focus-drop-zone"
        ondragover="App._onFocusDragOver(event)"
        ondragleave="App._onFocusDragLeave(event)"
        ondrop="App._onFocusDrop(event)">
        <span class="fz-icon">▶</span>
        <span class="fz-label">Start Focus</span>
      </div>
    </div>`;
      }
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
  function _renderTaskCard(item, colId, extra = {}) {
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

    // Done card — struck line with orb
    if (isDone) {
      return `<div class="card done-card ${tagClass}" data-id="${item.id}"
        onclick="App.openDetail('${item.id}')">
        <div class="card-top">
          <div class="card-top-main">
            <span class="task-orb done"></span>
            <span class="card-title">${esc(item.title)}</span>
          </div>
        </div>
      </div>`;
    }

    const isActive = timerTask && timerTask.id === item.id;
    const isFirst = extra.isFirst && !isActive;
    const focusBtn = !isActive
      ? `<button class="focus-btn" onclick="event.stopPropagation();App.startTask('${item.id}')">start →</button>` : '';
    const laterBtn = (colId === 'this-week' || colId === 'next')
      ? `<button class="later-btn" onclick="event.stopPropagation();App._sendToLater('${item.id}')">← later</button>` : '';

    return `<div class="card ${tagClass}${isActive ? ' card-active' : ''}${isFirst ? ' is-first' : ''}" draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)"
      onclick="App.openDetail('${item.id}')">
      <div class="card-top">
        <div class="card-top-main">
          <span class="task-orb"></span>
          <div style="flex:1;min-width:0">
            <div class="card-title">${esc(item.title)}</div>
            ${projHtml}
          </div>
        </div>
        <div class="card-top-right">
          ${blockedHtml}
        </div>
      </div>
      <div class="card-meta">
        ${tagPills}${schedHtml}${dayHtml}${ageHtml}
      </div>
      <div class="card-hover-actions">${focusBtn}${laterBtn}</div>
    </div>`;
  }

  // ── Project card ──
  // ── Projects spatial canvas ──
  // Orb size by project state — Active largest, On Hold smallest.
  const PROJ_ORB_SIZE    = { 'active': 200, 'up-next': 160, 'someday': 132, 'on-hold': 112 };
  const PROJ_STATUS_ORDER = ['active', 'up-next', 'someday', 'on-hold'];
  const PROJ_STATUS_COLORS = {
    'active':  '#C98B2A',
    'up-next': '#F2C94C',
    'someday': '#8CAFD3',
    'on-hold': '#E5ADB8',
  };

  // Deterministic hash → [0,1) from a string. Keeps each orb's scatter stable
  // across re-renders (no Math.random, which would make orbs jump every render).
  function _hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }

  // First-class task model: a project's tasks ARE `tasks` rows linked by parentProject.
  function _projectTasks(projId) {
    return Data.get().tasks.filter(t => t.parentProject === projId);
  }
  // Count of open (non-done) tasks — neutral "how much is here" signal for organizing,
  // deliberately NOT a completion ratio/progress bar (projects gain tasks over time).
  function _projectOpenCount(projId) {
    return _projectTasks(projId).filter(t => t.status !== 'done').length;
  }

  // Status colour for an orb. Colour and size together encode status.
  function _projOrbColor(item) {
    return PROJ_STATUS_COLORS[item.status] || '#8A8378';
  }

  // Column-per-tag canvas: each tag group is a vertical lane; orbs stack top-to-bottom
  // by status with soft overlap. Max 4 columns per row; wraps to new rows below.
  // Adaptive step compression prevents any single column from forcing a scroll.
  function _renderProjCanvas(items) {
    if (!items.length) {
      return `${_renderCanvasLegend()}<div class="proj-canvas"><div class="proj-canvas-empty">No projects yet — add one to begin.</div></div>`;
    }

    // Group by first tag; untagged last
    const tagGroups = new Map();
    for (const item of items) {
      const key = (item.tags || [])[0] || '';
      if (!tagGroups.has(key)) tagGroups.set(key, []);
      tagGroups.get(key).push(item);
    }
    tagGroups.forEach(g => g.sort((a, b) =>
      PROJ_STATUS_ORDER.indexOf(a.status) - PROJ_STATUS_ORDER.indexOf(b.status)));
    const sortedKeys = [...tagGroups.keys()].sort((a, b) => {
      if (a === '' && b !== '') return 1;
      if (b === '' && a !== '') return -1;
      return a.localeCompare(b);
    });

    const MAX_COLS  = 4;
    const TARGET_H  = 620;  // target max column height before compression kicks in
    const ROW_GAP   = 48;
    const LABEL_H   = 44;   // vertical space reserved at top of each column for the tag label
    const BASE_STEP = 0.72; // default overlap factor (28% overlap)

    // Split groups into rows of at most MAX_COLS
    const gridRows = [];
    for (let i = 0; i < sortedKeys.length; i += MAX_COLS) {
      gridRows.push(sortedKeys.slice(i, i + MAX_COLS));
    }

    // Compute raw column heights at BASE_STEP to derive a global stepFactor
    let stepFactor = BASE_STEP;
    gridRows.forEach(rowKeys => {
      rowKeys.forEach(key => {
        const g = tagGroups.get(key);
        let h = LABEL_H;
        g.forEach((item, i) => {
          const sz = PROJ_ORB_SIZE[item.status] || 140;
          h += i < g.length - 1 ? sz * BASE_STEP : sz;
        });
        if (h > TARGET_H) {
          const needed = Math.max(0.4, BASE_STEP * TARGET_H / h);
          if (needed < stepFactor) stepFactor = needed;
        }
      });
    });

    const orbs = [];
    const groupLabels = [];
    let rowStartY = 0;
    let canvasH   = 0;

    gridRows.forEach(rowKeys => {
      const n = rowKeys.length;
      let rowH = 0;

      rowKeys.forEach((tagKey, colIdx) => {
        const groupItems = tagGroups.get(tagKey);
        const colCenterPct = (colIdx + 0.5) / n * 100;
        let y = rowStartY + LABEL_H;

        groupItems.forEach((item, i) => {
          const size = PROJ_ORB_SIZE[item.status] || 140;
          const xPct = colCenterPct + (_hashStr(item.id) - 0.5) * 8;
          orbs.push(_renderProjOrb(item, { size, xPct, top: Math.max(10, y), idx: orbs.length }));
          y += i < groupItems.length - 1 ? size * stepFactor : size;
        });

        const colH = y - rowStartY;
        if (colH > rowH) rowH = colH;
        if (tagKey) groupLabels.push({ tagKey, cx: colCenterPct, y: rowStartY + 14 });
      });

      rowStartY += rowH + ROW_GAP;
      canvasH = rowStartY;
    });

    const labelsHtml = groupLabels.map(gl =>
      `<div class="proj-group-label" style="left:${gl.cx}%;top:${gl.y}px">${esc(gl.tagKey).toUpperCase()}</div>`
    ).join('');

    return `${_renderCanvasLegend()}
    <div class="proj-canvas" style="height:${canvasH + 60}px">
      ${labelsHtml}
      ${orbs.join('')}
    </div>`;
  }

  function _renderProjOrb(item, pos) {
    const color = _projOrbColor(item);
    const drift = (pos.idx % 6) * -2.6;
    return `<div class="proj-orb status-${item.status}" data-id="${item.id}"
      draggable="true"
      ondragstart="event.stopPropagation();App._projOrbDragStart(event,'${item.id}')"
      ondragend="App._projOrbDragEnd()"
      style="--orb-color:${color};left:${pos.xPct}%;top:${pos.top}px;width:${pos.size}px;height:${pos.size}px;animation-delay:${drift}s">
      <div class="proj-orb-glow"></div>
      <div class="proj-orb-body"></div>
      <div class="proj-orb-label">
        <span class="orb-title">${esc(item.title)}</span>
      </div>
      <div class="proj-orb-hit" onclick="App.openDetail('${item.id}')"></div>
    </div>`;
  }

  function _renderCanvasLegend() {
    const STATUS_LABELS = { 'active': 'Active', 'up-next': 'Up next', 'someday': 'Ideation', 'on-hold': 'On hold' };
    const DOT_SIZES    = { 'active': 13, 'up-next': 10, 'someday': 8, 'on-hold': 7 };
    return `<div class="proj-legend-bar">
      ${PROJ_STATUS_ORDER.map(s => `<div class="legend-row legend-drop" data-status="${s}"
        ondragover="event.preventDefault();this.classList.add('over')"
        ondragleave="this.classList.remove('over')"
        ondrop="event.preventDefault();this.classList.remove('over');App._projDropStatus('${s}')">
        <span class="legend-dot" style="background:${PROJ_STATUS_COLORS[s]};width:${DOT_SIZES[s]}px;height:${DOT_SIZES[s]}px"></span>${STATUS_LABELS[s]}
      </div>`).join('')}
    </div>`;
  }

  // ── Project orb drag-to-status ──
  let _projDragId = null;

  function _projOrbDragStart(evt, id) {
    _projDragId = id;
    evt.dataTransfer.effectAllowed = 'move';
    const el = evt.currentTarget;
    requestAnimationFrame(() => { if (el) el.style.opacity = '0.4'; });
  }

  function _projOrbDragEnd() {
    document.querySelectorAll('.proj-orb').forEach(el => { el.style.opacity = ''; });
    _projDragId = null;
  }

  function _projDropStatus(newStatus) {
    if (!_projDragId) return;
    const proj = Data.findProject(_projDragId);
    if (!proj) { _projDragId = null; return; }
    if (newStatus === 'done') {
      const activeTasks = Data.get().tasks.filter(t => t.parentProject === _projDragId && t.status !== 'done');
      if (activeTasks.length) {
        _projDragId = null;
        return;
      }
    }
    proj.status = newStatus;
    Data.upsertProject(proj);
    _projDragId = null;
    renderBoard();
  }

  // ═══════════════════════════════════════════════
  // Week (Calendar) view — Grind language (phase 4)
  // ═══════════════════════════════════════════════

  const _WEEK_DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

  // Sort within a single day: manual day_order first (nulls last), then time, then age.
  function _weekDaySort(a, b) {
    const ao = (a.dayOrder ?? null), bo = (b.dayOrder ?? null);
    if (ao !== null && bo !== null && ao !== bo) return ao - bo;
    if (ao !== null && bo === null) return -1;
    if (ao === null && bo !== null) return 1;
    const at = a.scheduledTime || '99:99', bt = b.scheduledTime || '99:99';
    if (at !== bt) return at.localeCompare(bt);
    return (a.dateAdded || '').localeCompare(b.dateAdded || '');
  }

  // Done items that belong to a given day (for the past-week accomplishment view):
  // still-present done tasks + archived task rows, matched by scheduledDate else completion date.
  function _doneOnDate(date) {
    const state = Data.get();
    const comp = _loadCompletionDates();
    const out = [];
    (state.tasks || []).forEach(t => {
      if (t.status !== 'done') return;
      const dd = t.scheduledDate || comp[t.id] || '';
      if (dd === date) out.push(t);
    });
    (state.archive || []).forEach(a => {
      if (a.type === 'project') return;
      const dd = a.scheduledDate || (a.archivedAt ? String(a.archivedAt).split('T')[0] : '');
      if (dd === date) out.push(a);
    });
    return out;
  }

  function _renderWeekView() {
    const days  = _weekDays(_weekOffset);
    const today = _today();
    const isPast = _weekOffset < 0;
    const state = Data.get();

    const start = new Date(days[0] + 'T00:00:00');
    const end   = new Date(days[6] + 'T00:00:00');
    const fmt = d => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    const range = `${fmt(start)} – ${fmt(end)}`;
    const label = _weekOffset === 0 ? 'This week'
      : _weekOffset === -1 ? 'Last week'
      : _weekOffset === 1 ? 'Next week'
      : _weekOffset < 0 ? `${-_weekOffset} weeks ago` : `In ${_weekOffset} weeks`;

    const rail = isPast ? [] : (state.tasks || [])
      .filter(t => t.status === 'this-week' && !t.scheduledDate)
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

    // Build stations + columns together for alignment
    const rendered = days.map((date, i) => _renderWeekDay(date, i, today, isPast));
    const stationsHtml = rendered.map(r => r.station).join('');
    const columnsHtml  = rendered.map(r => r.column).join('');

    return `
      <div class="week-view${isPast ? ' is-past' : ''}">
        <div class="week-head">
          <button class="wk-nav" onclick="App.weekPrev()" aria-label="Previous week">‹</button>
          <div class="wk-range">
            <span class="wk-range-label">${label}</span>
            <span class="wk-range-dates">${range}</span>
          </div>
          <button class="wk-nav" onclick="App.weekNext()" aria-label="Next week">›</button>
          ${_weekOffset !== 0 ? `<button class="wk-today" onclick="App.weekToday()">Today</button>` : ''}
        </div>
        <div class="week-thread">${stationsHtml}</div>
        <div class="week-columns">${columnsHtml}</div>
        ${isPast ? '' : _renderWeekRail(rail)}
      </div>`;
  }

  function _renderWeekDay(date, dowIdx, today, isPast) {
    const state = Data.get();
    const d = new Date(date + 'T00:00:00');
    const isToday = date === today;
    const isFuture = !isPast && date > today;

    // Station node
    const stationClass = `day-station${isToday ? ' today' : ''}${isPast ? ' past' : ''}${isFuture ? ' future' : ''}`;
    const eyebrow = isToday ? `<span class="today-eyebrow">TODAY</span>` : '';
    const station = `
      <div class="${stationClass}" data-date="${date}">
        ${eyebrow}
        <div class="station-node"></div>
        <div class="station-num">${d.getDate()}</div>
        <div class="station-name">${_WEEK_DOW[dowIdx]}</div>
      </div>`;

    // Commits for this date
    const commits = (state.commitments || [])
      .filter(c => c.date === date || c.endDate === date)
      .sort((a, b) => (a.startTime || '99').localeCompare(b.startTime || '99'));

    let tasks = '', tally = '';
    if (isPast) {
      const done = _doneOnDate(date).sort((a, b) => (a.scheduledTime || '99').localeCompare(b.scheduledTime || '99'));
      tasks = done.map(t => _renderWeekChip(t, { past: true })).join('');
      tally = done.length ? `<div class="wt-tally">${done.length} done</div>` : '';
    } else {
      const dayTasks = (state.tasks || [])
        .filter(t => t.scheduledDate === date && t.status !== 'done')
        .sort(_weekDaySort);
      tasks = dayTasks.map(t => _renderWeekChip(t, {})).join('');
    }

    const dropAttrs = isPast ? '' :
      `ondragover="App._onWeekDragOver(event)" ondragleave="App._onWeekDragLeave(event)" ondrop="App._onWeekDrop(event,'${date}')"`;
    const colClass = `day-col${isToday ? ' today-col' : ''}${isPast ? ' past-col' : ''}`;

    const column = `
      <div class="${colClass}" data-date="${date}" ${dropAttrs}>
        ${commits.map(c => _renderCommitBand(c, date)).join('')}
        ${tasks}
        ${tally}
        ${!isPast ? `<button class="wd-add-busy" onclick="App._openCommitEditor('${date}')">＋ busy</button>` : ''}
      </div>`;

    return { station, column };
  }

  function _renderWeekRail(items) {
    const allTags = _loadTags();
    const chips = items.map(t => {
      const tags = t.tags || [];
      const tagCls = tags.length ? _tagClasses(tags[0], allTags) : '';
      const due = t.dueDate ? `<span class="wc-due${_isOverdue(t.dueDate) ? ' over' : ''}"> · due ${_fmtDate(t.dueDate)}</span>` : '';
      return `<div class="rail-chip ${tagCls}" data-id="${t.id}" draggable="true"
          ondragstart="App._onWeekChipDragStart(event,'${t.id}')" ondragend="App._onWeekChipDragEnd(event)">
          <span class="wc-title">${esc(t.title)}</span>${due}
          <button class="wc-later" onclick="event.stopPropagation();App._sendToLater('${t.id}')" title="Defer to Inbox">→ Later</button>
        </div>`;
    }).join('');
    return `
      <div class="week-rail" ondragover="App._onWeekRailDragOver(event)" ondragleave="App._onWeekRailDragLeave(event)" ondrop="App._onWeekRailDrop(event)">
        <span class="wr-head">Unplaced <span class="wr-sub">· This Week</span></span>
        ${chips || `<span class="wr-empty">All placed ✦</span>`}
      </div>`;
  }

  function _renderWeekChip(t, { past }) {
    const tags = (t.tags || []);
    const allTags = _loadTags();
    const tagCls = tags.length ? _tagClasses(tags[0], allTags) : '';
    const isNow = !past && t.status === 'doing';
    const metaParts = [];
    if (t.scheduledTime) metaParts.push(`<span class="wt-time">${t.scheduledTime}</span>`);
    if (t.timeSpent)     metaParts.push(`<span class="wt-spent">Σ ${t.timeSpent}m</span>`);
    const meta = metaParts.length ? `<div class="wt-meta">${metaParts.join('')}</div>` : '';

    if (past) {
      return `<div class="week-task past ${tagCls}" data-id="${t.id}" onclick="App.openDetail('${t.id}')">
          <span class="wt-check">✓</span>
          <div class="wt-body"><div class="wt-title">${esc(t.title)}</div>${meta}</div>
        </div>`;
    }
    const nowMarker = isNow ? `<span class="wt-now"></span>` : `<span class="wt-tick"></span>`;
    return `<div class="week-task ${tagCls}${isNow ? ' is-now' : ''}" data-id="${t.id}" draggable="true"
        onclick="App.openDetail('${t.id}')"
        ondragstart="App._onWeekChipDragStart(event,'${t.id}')" ondragend="App._onWeekChipDragEnd(event)">
        ${nowMarker}
        <div class="wt-body"><div class="wt-title">${esc(t.title)}</div>${meta}</div>
      </div>`;
  }

  function _renderCommitBand(c, renderDate) {
    const isContinued = renderDate && c.endDate && c.endDate === renderDate && c.date !== renderDate;
    let timeStr = (c.startTime || c.endTime)
      ? `${c.startTime || ''}${c.endTime ? '–' + c.endTime : ''}`.replace(/:00(?=–|$)/g, '')
      : '';
    if (!isContinued && c.endDate && c.endDate !== c.date) timeStr += ' →';
    const typeCls = c.type ? ` cb-type-${c.type}` : '';
    const typeLabel = c.type ? `<span class="cb-type-badge">${c.type}</span>` : '';
    const contLabel = isContinued ? `<span class="cb-cont">(contd.)</span>` : '';
    return `<div class="commit-band${typeCls}" data-id="${c.id}" title="${esc(c.notes || '')}"
        onclick="event.stopPropagation();App._openCommitEditor('${c.date}','${c.id}')">
        ${typeLabel}${contLabel}
        <span class="cb-time">${timeStr}</span>
        <span class="cb-title">${esc(c.title)}</span>
        <button class="cb-del" onclick="event.stopPropagation();App._deleteCommit('${c.id}')" aria-label="Remove">✕</button>
      </div>`;
  }

  // ── Week drag & drop ──
  let _weekDragId = null;

  function _onWeekChipDragStart(evt, id) {
    _weekDragId = id;
    evt.stopPropagation();
    evt.dataTransfer.effectAllowed = 'move';
    const el = evt.currentTarget;
    requestAnimationFrame(() => { if (el) el.classList.add('dragging'); });
  }
  function _onWeekChipDragEnd(evt) {
    document.querySelectorAll('.week-task.dragging,.rail-chip.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.day-col.drag-over,.week-rail.drag-over').forEach(el => el.classList.remove('drag-over'));
    _weekDragId = null;
  }
  function _onWeekDragOver(evt) {
    evt.preventDefault();
    evt.currentTarget.classList.add('drag-over');
    const existing = evt.currentTarget.querySelector('.week-drop-line');
    const ph = existing || (() => {
      const el = document.createElement('div');
      el.className = 'week-drop-line';
      return el;
    })();
    const after = _dragAfterEl(evt.currentTarget, evt.clientY);
    evt.currentTarget.insertBefore(ph, after || evt.currentTarget.querySelector('.wd-add-busy') || null);
  }
  function _onWeekDragLeave(evt) {
    if (evt.currentTarget.contains(evt.relatedTarget)) return;
    evt.currentTarget.classList.remove('drag-over');
    evt.currentTarget.querySelectorAll('.week-drop-line').forEach(el => el.remove());
  }

  // Compute a day_order that drops the task at the end of the target day's stack.
  function _nextDayOrder(date, excludeId) {
    const peers = (Data.get().tasks || [])
      .filter(t => t.scheduledDate === date && t.status !== 'done' && t.id !== excludeId);
    const max = peers.reduce((m, t) => Math.max(m, (t.dayOrder ?? 0)), 0);
    return max + 1;
  }

  // Horizontal variant of _dragAfterEl: finds the chip after which to insert, based on clientX.
  function _dragAfterElH(container, cx) {
    return [...container.querySelectorAll('.week-chip:not(.dragging):not(.rail-chip)')].reduce((closest, el) => {
      const rect = el.getBoundingClientRect();
      const offset = cx - (rect.left + rect.width / 2);
      return (offset < 0 && offset > closest.offset) ? { offset, element: el } : closest;
    }, { offset: -Infinity, element: null }).element;
  }

  function _onWeekDrop(evt, date) {
    evt.preventDefault();
    evt.currentTarget.classList.remove('drag-over');
    const id = _weekDragId; _weekDragId = null;
    evt.currentTarget.querySelectorAll('.week-drop-line').forEach(el => el.remove());
    if (!id) return;
    const item = Data.findItem(id);
    if (!item) return;

    // Compute insertion-point dayOrder using vertical position
    const dayCol = evt.currentTarget;
    const afterEl = _dragAfterEl(dayCol, evt.clientY);
    const st = Data.get().tasks;
    const getOrder = el => el ? (st.find(t => t.id === el.dataset.id)?.dayOrder ?? null) : null;
    const afterOrder = getOrder(afterEl);
    const beforeEl = afterEl ? afterEl.previousElementSibling : (() => {
      const tasks = [...dayCol.querySelectorAll('.week-task:not(.dragging)')];
      return tasks.length ? tasks[tasks.length - 1] : null;
    })();
    const beforeOrder = getOrder(beforeEl);
    let newOrder;
    if (beforeOrder !== null && afterOrder !== null) newOrder = (beforeOrder + afterOrder) / 2;
    else if (afterOrder !== null) newOrder = afterOrder - 0.5;
    else if (beforeOrder !== null) newOrder = beforeOrder + 1;
    else newOrder = 1;

    item.scheduledDate = date;
    item.dayOrder = newOrder;
    if (item.status === 'backlog' && !_isFutureWeek(date)) item.status = 'this-week';
    Data.upsertTask(item);
    renderBoard();
  }

  // Drop back onto the rail → unschedule (stays this-week).
  function _onWeekRailDragOver(evt) { evt.preventDefault(); evt.currentTarget.classList.add('drag-over'); }
  function _onWeekRailDragLeave(evt) {
    if (evt.currentTarget.contains(evt.relatedTarget)) return;
    evt.currentTarget.classList.remove('drag-over');
  }
  function _onWeekRailDrop(evt) {
    evt.preventDefault();
    evt.currentTarget.classList.remove('drag-over');
    const id = _weekDragId; _weekDragId = null;
    if (!id) return;
    const item = Data.findItem(id);
    if (!item) return;
    item.scheduledDate = '';
    item.dayOrder = null;
    if (item.status === 'backlog') item.status = 'this-week';
    Data.upsertTask(item);
    renderBoard();
  }

  // ── Commitment editor ──
  function _openCommitEditor(date, id) {
    const existing = id ? (Data.get().commitments || []).find(c => c.id === id) : null;
    const root = document.getElementById('modal-root');
    const c = existing || { title: '', startTime: '', endTime: '', endDate: null, type: null, notes: '' };
    const typeOpts = [
      { val: '',         label: 'Busy'     },
      { val: 'work',     label: 'Work'     },
      { val: 'exercise', label: 'Exercise' },
    ];
    const typeButtons = typeOpts.map(o =>
      `<button class="commit-type-btn${(c.type || '') === o.val ? ' active' : ''}" onclick="App._commitTypeSelect(this,'${o.val}')" data-type="${o.val}">${o.label}</button>`
    ).join('');
    root.innerHTML = `
      <div class="modal-overlay" onclick="App._closeCommitEditor(event)">
        <div class="modal commit-modal" onclick="event.stopPropagation()">
          <div class="modal-title">${existing ? 'Edit' : 'Add'} commitment</div>
          <div class="commit-date-label">${_fmtDate(date)}</div>
          <div class="commit-type-row">${typeButtons}</div>
          <input type="text" id="commit-title" class="commit-input" placeholder="e.g. Work shift, Dentist" value="${esc(c.title)}" />
          <div class="commit-times">
            <label>From <input type="time" id="commit-start" value="${c.startTime || ''}" /></label>
            <label>To <input type="time" id="commit-end" value="${c.endTime || ''}" /></label>
          </div>
          <div class="commit-enddate-row">
            <label class="commit-enddate-label">Ends on (for night shifts)
              <input type="date" id="commit-end-date" value="${c.endDate || ''}" />
            </label>
          </div>
          <textarea id="commit-notes" class="commit-input" placeholder="Notes (optional)" rows="2">${esc(c.notes || '')}</textarea>
          <div class="commit-actions">
            ${existing ? `<button class="btn btn-danger" onclick="App._deleteCommit('${id}');App._closeCommitEditor()">Delete</button>` : ''}
            <button class="btn" onclick="App._closeCommitEditor()">Cancel</button>
            <button class="btn btn-primary" onclick="App._saveCommit('${date}','${id || ''}')">Save</button>
          </div>
        </div>
      </div>`;
    setTimeout(() => document.getElementById('commit-title')?.focus(), 30);
  }
  function _commitTypeSelect(btn, val) {
    btn.closest('.commit-type-row').querySelectorAll('.commit-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  function _closeCommitEditor(evt) {
    if (evt && evt.target !== evt.currentTarget) return;
    document.getElementById('modal-root').innerHTML = '';
  }
  function _saveCommit(date, id) {
    const title = document.getElementById('commit-title').value.trim();
    if (!title) { document.getElementById('commit-title').focus(); return; }
    const activeTypeBtn = document.querySelector('.commit-type-btn.active');
    const type = activeTypeBtn?.dataset.type || null;
    const endDateVal = document.getElementById('commit-end-date')?.value || null;
    const c = {
      id: id || ('c' + Date.now()),
      title,
      date,
      startTime: document.getElementById('commit-start').value || '',
      endTime: document.getElementById('commit-end').value || '',
      endDate: endDateVal || null,
      type: type || null,
      colorSlot: null,
      notes: document.getElementById('commit-notes').value.trim(),
    };
    Data.upsertCommitment(c);
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }
  function _deleteCommit(id) {
    Data.deleteCommitment(id);
    renderBoard();
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
      item.timeSpent = (item.timeSpent || 0) + (timerTask._workElapsed || 0);
      clearInterval(timerInterval);
      clearInterval(timerElapsedInterval);
      _stopBoundaryFlash();
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
      item.timeSpent = (item.timeSpent || 0) + (timerTask._workElapsed || 0);
      clearInterval(timerInterval);
      clearInterval(timerElapsedInterval);
      _stopBoundaryFlash();
      timerTask = null;
      timerRunning = false;
      timerSecsRemaining = 0;
      _renderTimerTrack();
    }
    item.status = 'done';
    _saveCompletionDate(item.id);
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

  // Descending two-tone chime — distinct from the ascending start chime so the user
  // can tell by sound alone whether a segment just started or just ended.
  function _playEndChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.22, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);
        [1100, 770].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.18);
          osc.connect(gain);
          osc.start(ctx.currentTime + i * 0.18);
          osc.stop(ctx.currentTime + i * 0.18 + 0.75);
        });
      };
      if (ctx.state === 'suspended') { ctx.resume().then(play); } else { play(); }
    } catch(e) {}
  }

  // Alternates the orb between amber and blue while waiting at a boundary — reuses
  // the existing 1.6s background transition so the crossfade is smooth.
  function _startBoundaryFlash() {
    _stopBoundaryFlash();
    let flash = false;
    _boundaryFlashInterval = setInterval(() => {
      flash = !flash;
      const orbEl  = _focusDoc().getElementById('focus-orb');
      const glowEl = _focusDoc().getElementById('focus-orb-glow');
      if (!orbEl) { _stopBoundaryFlash(); return; }
      const a = flash ? 'break' : 'work';
      const b = flash ? 'work'  : 'break';
      orbEl.classList.replace(a, b);
      if (glowEl) glowEl.classList.replace(a, b);
    }, 2000); // 2s per colour — matches the 1.6s CSS crossfade with a beat of rest
  }

  function _stopBoundaryFlash() {
    if (_boundaryFlashInterval) { clearInterval(_boundaryFlashInterval); _boundaryFlashInterval = null; }
  }

  function _fireStartNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const isBreak = TIMER_SEQ[timerSegIdx].kind === 'break';
    const body = isBreak ? 'Break started — step away for a bit.' : 'Work session started — get after it.';
    try { new Notification('Grind & Flow', { body, icon: 'icon-192.png' }); } catch(e) {}
  }

  function _startTimer() {
    clearInterval(timerInterval);
    _stopBoundaryFlash(); // clear any amber↔blue flash from the previous boundary
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
        // Accumulate only WORK-segment minutes — the foundation for future
        // duration estimates. Persisted to item.timeSpent on Done/Return.
        if (TIMER_SEQ[timerSegIdx] && TIMER_SEQ[timerSegIdx].kind === 'work') {
          timerTask._workElapsed = (timerTask._workElapsed || 0) + 1;
        }
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
      _playEndChime();
      _renderTimerTrack(); _renderFocusRow();
      _startBoundaryFlash();
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
    setTimeout(() => {
      dragEl?.classList.add('is-dragging');
      document.querySelector('.columns')?.classList.add('dragging-active');
    }, 0);
    e.dataTransfer.effectAllowed = 'move';
  }
  function _onDragEnd(e) {
    dragEl?.classList.remove('is-dragging');
    document.querySelector('.columns')?.classList.remove('dragging-active');
    placeholder?.remove(); placeholder = null;
    document.querySelectorAll('.col-body').forEach(c => c.classList.remove('drag-over'));
    dragId = null; dragEl = null;
  }
  function _onFocusDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
  function _onFocusDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
  function _onFocusDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    document.querySelector('.columns')?.classList.remove('dragging-active');
    if (dragId) startTask(dragId);
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
      if (colId === 'done') { _saveCompletionDate(item.id); }
      else _clearCompletionDate(item.id);
      item.type === 'project' ? Data.upsertProject(item) : Data.upsertTask(item);
    }
    placeholder?.remove(); placeholder = null;
    document.querySelectorAll('.col-body').forEach(c => c.classList.remove('drag-over'));
    renderBoard();
  }

  // ── Project space: child-task list (first-class tasks) ──
  // A project's tasks are `tasks` rows linked by parentProject. The project-space
  // modal shows them grouped by status with an inline quick-add.
  let _projAddDest    = 'inbox';   // inline-add destination: 'inbox' | 'now'
  let _newParentProject = null;    // when the New-Task modal was opened from a project

  const _PSPACE_GROUPS = [
    { id: 'backlog',   label: 'Inbox' },
    { id: 'this-week', label: 'This Week' },
    { id: 'next',      label: 'Next' },
    { id: 'doing',     label: 'Doing' },
    { id: 'done',      label: 'Done' },
  ];

  function _renderProjTaskList(projId) {
    const tasks = _projectTasks(projId);
    if (!tasks.length) return `<div class="pspace-empty">No tasks yet — capture one below.</div>`;
    return _PSPACE_GROUPS.map(g => {
      const gt = tasks.filter(t => t.status === g.id);
      if (!gt.length) return '';
      return `<div class="pspace-group">
        <div class="pspace-group-head">${g.label}<span>${gt.length}</span></div>
        ${gt.map(t => _renderProjTaskRow(t, projId)).join('')}
      </div>`;
    }).join('');
  }

  function _renderProjTaskRow(t, projId) {
    const sched = t.scheduledDate ? `<span class="pst-meta">${_fmtDate(t.scheduledDate)}</span>` : '';
    const due   = t.dueDate ? `<span class="pst-meta pst-due">Due ${_fmtDate(t.dueDate)}</span>` : '';
    const blocked = t.blocked ? `<span class="pst-meta pst-blocked">blocked</span>` : '';
    return `<div class="pspace-task${t.status === 'done' ? ' done' : ''}" data-id="${t.id}">
      <input type="checkbox" ${t.status === 'done' ? 'checked' : ''}
        onchange="App._projTaskToggleDone('${t.id}','${projId}',this.checked)" />
      <span class="pst-title" onclick="App.openDetail('${t.id}')" title="Open task">${esc(t.title)}</span>
      ${blocked}${sched}${due}
      <button class="pst-del" title="Delete" onclick="App._projTaskDelete('${t.id}','${projId}')">✕</button>
    </div>`;
  }

  // Re-render the open project-space modal's task list, and the canvas (orb count).
  function _refreshProjModal(projId) {
    const listEl = document.getElementById('pspace-tasklist-' + projId);
    if (listEl) listEl.innerHTML = _renderProjTaskList(projId);
    renderBoard();
  }

  function _projTaskToggleDone(taskId, projId, checked) {
    const task = Data.findItem(taskId); if (!task) return;
    task.status = checked ? 'done' : 'this-week';
    if (checked) _saveCompletionDate(taskId); else _clearCompletionDate(taskId);
    Data.upsertTask(task);
    _refreshProjModal(projId);
  }

  function _projTaskDelete(taskId, projId) {
    Data.deleteItem(taskId);
    _refreshProjModal(projId);
  }

  function _projSetAddDest(dest) {
    _projAddDest = dest;
    document.querySelectorAll('#pspace-dest .pdest-opt')
      .forEach(b => b.classList.toggle('active', b.dataset.d === dest));
  }

  // Inline quick-add inside the project space. Default → Inbox; "Start now" → This Week.
  function _addProjectTask(projId) {
    const input = document.getElementById('pspace-add-' + projId);
    const title = input?.value.trim(); if (!title) return;
    const proj = Data.findProject(projId); if (!proj) return;
    const status = _projAddDest === 'now' ? 'this-week' : 'backlog';
    Data.upsertTask({
      id: 't' + Date.now(), type: 'task', title, status, parentProject: projId,
      tags: [...(proj.tags || [])], dueDate: '', scheduledDate: '', scheduledTime: '',
      notes: '', dateAdded: _today(),
      backlogEnteredAt: status === 'backlog' ? _today() : '', laterCount: 0, blocked: false,
    });
    input.value = '';
    _refreshProjModal(projId);
    document.getElementById('pspace-add-' + projId)?.focus();
  }

  // "More fields" — open the shared New-Task modal with this project preset/locked.
  function _addProjectTaskDetailed(projId) {
    openNewModal({ parentProject: projId, defaultStatus: 'backlog' });
  }

  // ── New-project modal: pending tasks captured before the project is saved ──
  function _addPendingTask() {
    const input = document.getElementById('new-proj-task-input');
    const title = input?.value.trim(); if (!title) return;
    _pendingSubtasks.push({ id: 'pt' + Date.now(), title });
    input.value = '';
    const list = document.getElementById('new-proj-tasklist');
    if (list) list.innerHTML = _renderPendingTaskList();
    input.focus();
  }
  function _removePendingTask(id) {
    _pendingSubtasks = _pendingSubtasks.filter(s => s.id !== id);
    const list = document.getElementById('new-proj-tasklist');
    if (list) list.innerHTML = _renderPendingTaskList();
  }
  function _renderPendingTaskList() {
    if (!_pendingSubtasks.length) return `<div class="pspace-empty">No tasks yet</div>`;
    return _pendingSubtasks.map(s => `<div class="pspace-task" data-id="${s.id}">
      <span class="pst-title">${esc(s.title)}</span>
      <button class="pst-del" onclick="App._removePendingTask('${s.id}')">✕</button>
    </div>`).join('');
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

      // Project space — child tasks (first-class) grouped by status. No progress bar:
      // this is for organizing, not tracking completion.
      _projAddDest = 'inbox';

      const stateIsWaiting = item.waiting;
      const stateIsBlocked = item.blocked;
      const stateIsClear   = !stateIsWaiting && !stateIsBlocked;

      const autoWaitNote = item.waitingAuto
        ? `<div class="proj-auto-wait-note">Auto-set — a linked task is blocked.</div>` : '';

      const capSection = _buildCapacitiesSection(item);

      _showModal(`
        <div class="proj-space"></div>
        <input type="text" class="proj-modal-title-input" id="d-title" value="${esc(item.title)}" />
        <div class="proj-modal-cols">
          <div class="proj-modal-left">
            <div class="modal-section">
              <label class="modal-label">Tags</label>
              <div class="modal-tags-row" id="modal-tags-row">${tagPillsHtml}</div>
              <div class="modal-tag-add" style="margin-top:7px">
                <input type="text" id="new-tag-input" placeholder="New tag..." />
                <button onclick="App._addCustomTag('${id}')">+ add tag</button>
              </div>
            </div>
            <div class="modal-section">
              <div class="proj-modal-grid" style="grid-template-columns:1fr 1fr">
                <div class="fg"><label class="modal-label">Status</label>
                  <select class="modal-input" id="d-status" data-prev="${item.status}"
                    onchange="App._onProjStatusChange('${id}',this)">${statusOpts}</select>
                  <div id="status-done-msg" style="display:none;font-size:10px;color:#C98B2A;margin-top:5px"></div>
                </div>
                <div class="fg"><label class="modal-label">Due date</label>
                  <input type="date" class="modal-input" id="d-due" value="${item.dueDate || ''}" /></div>
              </div>
            </div>
            <div class="modal-section" style="flex:1">
              <label class="modal-label">Notes</label>
              <textarea class="modal-input proj-notes-tall" id="d-notes">${esc(item.notes || '')}</textarea>
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
          </div>
          <div class="proj-modal-right">
            <div class="modal-section pspace-section">
              <label class="modal-label" style="margin-bottom:8px;display:block">Tasks</label>
              <div class="pspace-tasklist" id="pspace-tasklist-${item.id}">
                ${_renderProjTaskList(item.id)}
              </div>
              <div class="pspace-add">
                <input type="text" class="modal-input" id="pspace-add-${item.id}" placeholder="Add a task..."
                  onkeydown="if(event.key==='Enter')App._addProjectTask('${item.id}')" />
                <div class="pdest" id="pspace-dest">
                  <button class="pdest-opt active" data-d="inbox" onclick="App._projSetAddDest('inbox')">Inbox</button>
                  <button class="pdest-opt" data-d="now" onclick="App._projSetAddDest('now')">Start now</button>
                </div>
                <button class="btn-close" onclick="App._addProjectTask('${item.id}')">+ add</button>
                <button class="btn-close pspace-more" title="More fields" onclick="App._addProjectTaskDetailed('${item.id}')">⋯</button>
              </div>
            </div>
            ${capSection}
          </div>
        </div>
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

    const timeSpentHtml = item.timeSpent
      ? `<div class="modal-timespent">Focus time logged: <strong>${item.timeSpent}m</strong></div>` : '';

    _showModal(`
      <div class="modal-title">${esc(item.title)}</div>
      ${timeSpentHtml}
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
      const activeTasks = Data.get().tasks.filter(t => t.parentProject === id && t.status !== 'done');
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
      if (status === 'done') { _saveCompletionDate(id); }
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

  // ── Constellation layout constants ──
  const _IR_VBW  = 1200, _IR_VBH = 800;
  const _IR_ACTIVE_X = 760, _IR_ACTIVE_Y = 580;   // fixed anchor (the "seed"), lower-right
  // Fan growth: decided dots radiate up & out from the seed in widening arcs (rings).
  // Ring m holds (m+1) dots, so growth starts as a narrow stem and fans as it climbs.
  const _IR_R0   = 110, _IR_DR = 58;    // first-ring radius, ring spacing
  const _IR_FAN0 = 0.5, _IR_DFAN = 0.42, _IR_FANMAX = 2.5;  // fan width (rad) grows per ring

  function _outcomeColor(outcome) {
    const a = outcome && (outcome.action || outcome);
    if (a === 'this-week') return 'var(--sage)';
    if (a === 'later')     return 'var(--ir-pink)';
    if (a === 'delete')    return 'var(--ir-never)';
    return 'var(--ir-coral)';
  }

  // Minimum spanning tree (Prim's) over a point cloud, seeded at points[0] (the anchor).
  // Each step adds whichever remaining dot is closest to *any* dot already in the tree,
  // so the tree branches organically in all directions instead of chaining into a comb.
  function _buildMST(points) {
    const n = points.length;
    if (n < 2) return [];
    const inTree = new Array(n).fill(false);
    inTree[0] = true;
    const edges = [];
    for (let added = 1; added < n; added++) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (!inTree[i]) continue;
        for (let j = 0; j < n; j++) {
          if (inTree[j]) continue;
          const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
      if (bj === -1) break;
      inTree[bj] = true;
      edges.push({ from: points[bi], to: points[bj] });
    }
    return edges;
  }

  // Single right-angle bend between two points, long axis first (cleaner than a fixed bend).
  function _edgePath(a, b) {
    return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
      ? `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`
      : `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`;
  }

  function _elbowPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i-1], c = pts[i];
      d += i % 2 === 1
        ? ` L ${c.x} ${p.y} L ${c.x} ${c.y}`
        : ` L ${p.x} ${c.y} L ${c.x} ${c.y}`;
    }
    return d;
  }

  function _computeConstellation(ids) {
    // Position the i-th task (by stable review order) on a fan that radiates up & out
    // from the seed: rank 0 sits just above it, later ranks climb into widening rings.
    const pos = new Map();
    ids.forEach((id, i) => {
      // Walk rings: ring m holds (m+1) slots → narrow stem at the base, fanning upward.
      let m = 0, idx = i;
      while (idx >= m + 1) { idx -= (m + 1); m++; }
      const s   = idx, cap = m + 1;
      const fan = Math.min(_IR_FANMAX, _IR_FAN0 + m * _IR_DFAN);
      const a0  = cap === 1 ? 0 : -fan / 2 + s * (fan / (cap - 1));
      const jr  = (_hashStr(id)        - 0.5) * 22;    // radius jitter ±11
      const ja  = (_hashStr(id + 'a')  - 0.5) * 0.16;  // angle jitter ±0.08 rad
      const R   = _IR_R0 + m * _IR_DR + jr;
      const ang = a0 + ja;                             // 0 = straight up; ± = out to sides
      let x = _IR_ACTIVE_X + R * Math.sin(ang);
      let y = _IR_ACTIVE_Y - R * Math.cos(ang);        // up = negative y (never below seed)
      x = Math.max(40, Math.min(1160, x));
      y = Math.max(50, Math.min(540, y));
      pos.set(id, { x: Math.round(x), y: Math.round(y) });
    });
    return pos;
  }

  let _irHoverOutcome = null;
  function _irPreviewOutcome(outcome) {
    _irHoverOutcome = outcome;
    const color  = _outcomeColor(outcome);
    const dot    = document.getElementById('ir-active-dot');
    const pulse  = document.getElementById('ir-active-pulse');
    const elbow  = document.getElementById('ir-active-elbow');
    if (dot)   dot.setAttribute('fill', color);
    if (pulse) pulse.setAttribute('fill', color);
    if (elbow) elbow.setAttribute('stroke', outcome ? color : 'var(--ink)');
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

  const _REVIEW_OUTCOME_LABEL = { 'this-week': '→ This week', 'later': 'Deferred', 'delete': 'Never' };

  function _renderInboxReview() {
    const el = document.getElementById('inbox-review');
    if (!el) return;
    const total     = _reviewSeq.length;
    const processed = _reviewSeq.filter(id => _reviewOutcome.has(id)).length;

    // Inbox zero
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

    const posMap     = _computeConstellation(_reviewSeq);
    const decidedIds = _reviewSeq.filter(id => _reviewOutcome.has(id));
    const pendingIds = _reviewSeq.filter(id => !_reviewOutcome.has(id));
    const activeId   = _reviewCenterId;
    const activePos  = { x: _IR_ACTIVE_X, y: _IR_ACTIVE_Y };

    // Ghost = next 3 pending after active
    const ghostIds = pendingIds.slice(1, 4);

    // Ghost positions: fixed rightward offsets from anchor
    const ghostPts = ghostIds.map((_, i) => ({
      x: _IR_ACTIVE_X + (i + 1) * 120,
      y: _IR_ACTIVE_Y + (i + 1) * 22,
    }));

    // Tree: minimum spanning tree over anchor + decided dots; dashed: anchor → ghosts
    const treeEdges  = _buildMST([activePos, ...decidedIds.map(id => posMap.get(id)).filter(Boolean)]);
    const dashedPath = _elbowPath([activePos, ...ghostPts]);

    // Decided dots (no labels)
    const decidedSvg = decidedIds.map(id => {
      const p = posMap.get(id); if (!p) return '';
      const color = _outcomeColor(_reviewOutcome.get(id));
      return `<g style="cursor:pointer" onclick="App._reviewCenter('${id}')">
        <circle cx="${p.x}" cy="${p.y}" r="18" fill="${color}"/>
      </g>`;
    }).join('');

    // Ghost dots (upcoming, no labels)
    const ghostSvg = ghostIds.map((id, i) => {
      const p = ghostPts[i]; if (!p) return '';
      return `<circle cx="${p.x}" cy="${p.y}" r="11" fill="var(--ir-ghost)" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/>`;
    }).join('');

    // Active (pulsing) dot — fixed anchor, no label
    const activeSvg = `
      <circle id="ir-active-pulse" class="ir-pulse" cx="${activePos.x}" cy="${activePos.y}" r="26" fill="var(--ir-coral)" opacity="0.5"/>
      <circle id="ir-active-dot"   cx="${activePos.x}" cy="${activePos.y}" r="26" fill="var(--ir-coral)"/>`;

    // Elbow connector: active dot → callout (edge-aware flip)
    const flipped    = activePos.x > _IR_VBW * 0.58;
    const elbowEndX  = flipped ? activePos.x - 68 : activePos.x + 68;
    const elbowEndY  = activePos.y - 16;
    const elbowStart = flipped ? activePos.x - 26 : activePos.x + 26;
    const elbowD     = `M ${elbowStart} ${activePos.y} L ${elbowEndX} ${activePos.y} L ${elbowEndX} ${elbowEndY}`;

    // Callout position: SVG px → % (valid because SVG uses preserveAspectRatio="none")
    const calloutTopPct  = (elbowEndY / _IR_VBH * 100).toFixed(1);
    const calloutLeftCss = flipped
      ? `left:calc(${(elbowEndX / _IR_VBW * 100).toFixed(1)}% - 340px)`
      : `left:${(elbowEndX / _IR_VBW * 100).toFixed(1)}%`;

    // Callout content
    const item = Data.findItem(activeId);
    if (!item) return;
    const activeOutcome = _reviewOutcome.get(activeId);

    const projTitle = item.parentProject ? (Data.findProject(item.parentProject) || {}).title : null;
    const projHtml  = projTitle ? `<div class="ir-panel-project">${esc(projTitle)}</div>` : '';

    let ageHtml = '';
    if (item.backlogEnteredAt) {
      const days = _daysDiff(item.backlogEnteredAt);
      const cls  = days >= 14 ? ' old' : days >= 7 ? ' stale' : '';
      ageHtml = `<span class="age-counter${cls}">${_ageLabel(item.backlogEnteredAt)}</span>`;
    }
    let dueHtml = '';
    if (item.dueDate) {
      const dd = new Date(item.dueDate + 'T00:00:00');
      dueHtml = `<span class="ir-due">due ${dd.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>`;
    }
    const bumped   = item.laterCount > 0 ? `<span class="ir-bumped">bumped ${item.laterCount}×</span>` : '';
    const metaParts = [dueHtml, ageHtml, bumped].filter(Boolean).join('<span class="ir-dotsep"> · </span>');

    const actionsHtml = activeOutcome
      ? `<div class="ir-actions">
           <span class="ir-outcome o-${activeOutcome.action}">${_REVIEW_OUTCOME_LABEL[activeOutcome.action]}</span>
           <button class="ir-act undo" onclick="App._reviewUndo('${activeId}')">Undo</button>
         </div>`
      : `<div class="ir-actions">
           <button class="ir-act tw"
             onmouseenter="App._irPreviewOutcome('this-week')" onmouseleave="App._irPreviewOutcome(null)"
             onclick="App._reviewThisWeek('${activeId}')">This Week</button>
           <button class="ir-act"
             onmouseenter="App._irPreviewOutcome('later')" onmouseleave="App._irPreviewOutcome(null)"
             onclick="App._sendToLater('${activeId}',true)">Later</button>
           <button class="ir-act never"
             onmouseenter="App._irPreviewOutcome('delete')" onmouseleave="App._irPreviewOutcome(null)"
             onclick="App._reviewDelete('${activeId}')">Never</button>
         </div>`;

    // Up-next list in callout (tasks after active in the pending queue)
    const activePendingIdx = pendingIds.indexOf(activeId);
    const upNextIds = activePendingIdx >= 0
      ? pendingIds.slice(activePendingIdx + 1, activePendingIdx + 4)
      : pendingIds.slice(0, 3);
    const upNextHtml = upNextIds.length ? `
      <div class="ir-upnext">
        <div class="ir-upnext-head">Up next</div>
        <ul class="ir-upnext-list">${upNextIds.map((id, i) => {
          const t = Data.findItem(id); if (!t) return '';
          return `<li style="opacity:${1 - i * 0.25}">
            <span class="ir-upnext-num">${String(_reviewSeq.indexOf(id) + 1).padStart(2, '0')}</span>${esc(t.title)}
          </li>`;
        }).join('')}</ul>
      </div>` : '';

    el.innerHTML = `
      <div class="ir-head">
        <div class="ir-head-left">
          <div class="ir-title-h">Inbox Review</div>
          <div class="ir-sub">${processed} of ${total} reviewed</div>
        </div>
        <button class="ir-close" onclick="App.closeInboxReview()">Done</button>
      </div>
      <svg class="ir-canvas" viewBox="0 0 ${_IR_VBW} ${_IR_VBH}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id="ir-grid-pat" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--ir-grid)" stroke-width="0.8"/>
          </pattern>
        </defs>
        <rect width="${_IR_VBW}" height="${_IR_VBH}" fill="url(#ir-grid-pat)"/>
        ${treeEdges.map(({ from, to }) => `<path class="ir-line-decided" d="${_edgePath(from, to)}"/>`).join('')}
        ${dashedPath ? `<path class="ir-line-upcoming" d="${dashedPath}"/>` : ''}
        ${decidedSvg}
        ${ghostSvg}
        <path id="ir-active-elbow" class="ir-elbow" d="${elbowD}"/>
        ${activeSvg}
      </svg>
      <div class="ir-callout" style="${calloutLeftCss};top:${calloutTopPct}%">
        ${projHtml}
        <div class="ir-title">${esc(item.title)}</div>
        ${metaParts ? `<div class="ir-meta">${metaParts}</div>` : ''}
        ${actionsHtml}
        ${upNextHtml}
      </div>
      <div class="ir-legend">
        <div class="ir-legend-item"><span class="ir-legend-dot" style="background:var(--sage)"></span>This Week</div>
        <div class="ir-legend-item"><span class="ir-legend-dot" style="background:var(--ir-pink)"></span>Later</div>
        <div class="ir-legend-item"><span class="ir-legend-dot" style="background:var(--ir-never)"></span>Never</div>
        <div class="ir-legend-item"><span class="ir-legend-dot" style="background:var(--ir-ghost);border:1px dashed var(--muted)"></span>Upcoming</div>
      </div>`;

    if (!el._wheelBound) {
      el._wheelBound = true;
      el.addEventListener('wheel', e => { e.preventDefault(); _reviewScroll(e.deltaY); }, { passive: false });
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
          const activeTasks = Data.get().tasks.filter(t => t.parentProject === id && t.status !== 'done');
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

  // openNewModal(opts) — opts: { parentProject?, defaultStatus? }. Legacy callers
  // pass a status string (column "+ add"); that's normalized to defaultStatus.
  function openNewModal(opts) {
    if (typeof opts === 'string') opts = { defaultStatus: opts };
    opts = opts || {};
    openItemId = null;
    const presetParent  = opts.parentProject || null;
    _newParentProject   = presetParent;
    const isProjectModal = view === 'projects' && !presetParent;
    _newType = isProjectModal ? 'project' : (presetParent ? 'task' : 'standalone');
    _pendingProjectId = isProjectModal ? 'p' + Date.now() : null;
    _pendingSubtasks  = [];
    const defaultStatus = opts.defaultStatus || (presetParent ? 'backlog' : undefined);
    const cols = isProjectModal ? PROJECT_COLS : TASK_COLS;
    const statusOpts = cols.map(c =>
      `<option value="${c.id}"${c.id === defaultStatus ? ' selected' : ''}>${c.label}</option>`
    ).join('');
    const projOpts = Data.get().projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    const allTags = _loadTags();
    const parentName = presetParent ? (Data.findProject(presetParent)?.title || '') : '';

    const taskExtra = isProjectModal ? '' : (presetParent ? `
      <div class="fg"><label class="modal-label">Project</label>
        <div class="new-parent-lock">${esc(parentName)}</div></div>` : `
      <div class="fg"><label class="modal-label">Type</label>
        <div class="type-toggle" id="type-seg">
          <button class="type-opt active" data-t="standalone" onclick="App._setNewType('standalone',this)">Standalone</button>
          <button class="type-opt" data-t="task" onclick="App._setNewType('task',this)">Linked to project</button>
        </div></div>
      <div class="fg" id="proj-link-group" style="display:none">
        <label class="modal-label">Project</label>
        <select class="modal-input" id="f-parent">${projOpts}</select>
      </div>`);

    const newProjTaskHtml = isProjectModal ? `
      <div class="modal-section">
        <label class="modal-label">Tasks <span class="modal-label-hint">added to Inbox on save</span></label>
        <div class="pspace-tasklist" id="new-proj-tasklist">${_renderPendingTaskList()}</div>
        <div class="pspace-add" style="margin-top:7px">
          <input type="text" class="modal-input" id="new-proj-task-input" placeholder="Add a task..."
            onkeydown="if(event.key==='Enter')App._addPendingTask()" />
          <button class="btn-close" onclick="App._addPendingTask()">+ add</button>
        </div>
      </div>` : '';

    _showModal(`
      <div class="modal-title">New ${isProjectModal ? 'Project' : 'Task'}</div>
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
      <div class="fg"><label class="modal-label">${presetParent ? 'Destination' : 'Status'}</label>
        <select class="modal-input" id="f-status">${statusOpts}</select></div>
      ${!isProjectModal ? `<div class="field-row">
        <div class="fg"><label class="modal-label">Scheduled date</label>
          <input type="date" class="modal-input" id="f-sched" /></div>
        <div class="fg"><label class="modal-label">Scheduled time</label>
          <input type="time" class="modal-input" id="f-sched-time" /></div>
      </div>` : ''}
      <div class="fg"><label class="modal-label">Due date</label>
        <input type="date" class="modal-input" id="f-due" /></div>
      <div class="fg"><label class="modal-label">Notes</label>
        <textarea class="modal-input" id="f-notes" placeholder="Optional..."></textarea></div>
      ${newProjTaskHtml}
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
    const isProjectModal = _newType === 'project';
    const id = isProjectModal ? (_pendingProjectId || 'p' + Date.now()) : 't' + Date.now();
    const reopenProj = _newParentProject;   // set when the modal was opened from a project space
    _newParentProject = null;
    if (isProjectModal) {
      const pending = [..._pendingSubtasks];
      _pendingProjectId = null; _pendingSubtasks = [];
      Data.upsertProject({ id, type:'project', title, status, tags, dueDate:due, notes, dateAdded:_today(), subtasks:[], blocked:false });
      // Pending tasks become first-class child tasks in the Inbox.
      pending.forEach((s, i) => Data.upsertTask({
        id: 't' + (Date.now() + i + 1), type:'task', title:s.title, status:'backlog',
        parentProject:id, tags:[...tags], dueDate:'', scheduledDate:'', scheduledTime:'', notes:'',
        dateAdded:_today(), backlogEnteredAt:_today(), laterCount:0, blocked:false,
      }));
    } else {
      const parent = reopenProj || (_newType === 'task' ? (document.getElementById('f-parent')?.value || null) : null);
      const type = parent ? 'task' : 'standalone';
      const backlogEnteredAt = status === 'backlog' ? _today() : '';
      Data.upsertTask({ id, type, title, status, tags, parentProject:parent, dueDate:due, scheduledDate:sched, scheduledTime:schedTime, notes, dateAdded:_today(), backlogEnteredAt, laterCount:0, blocked:false });
    }
    document.getElementById('modal-root').innerHTML = '';
    // Re-opened from a project space → return to it so the user can keep capturing.
    if (reopenProj) { openDetail(reopenProj); return; }
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
  // ── Week (Calendar) helpers — Monday-start ──
  function _ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  // Monday of the week `offset` weeks from today's week (offset 0 = current week)
  function _wkMonday(offset) {
    const d = new Date(_today() + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7;            // 0 = Mon … 6 = Sun
    d.setDate(d.getDate() - dow + offset * 7);
    return d;
  }
  function _weekDays(offset) {
    const start = _wkMonday(offset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i); return _ymd(d);
    });
  }
  // Which week (offset) does a date string belong to, relative to current week?
  // Compare the Monday of each week so a mid-week date maps to its own week.
  function _weekOffsetOf(ds) {
    if (!ds) return null;
    const cur = _wkMonday(0);
    const d = new Date(ds + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);            // Monday of ds's week
    return Math.round((d - cur) / (7 * 86400000));
  }
  // True when a date falls in a strictly later week than the current one.
  function _isFutureWeek(ds) {
    const o = _weekOffsetOf(ds);
    return o !== null && o > 0;
  }
  function weekPrev()  { _weekOffset -= 1; renderBoard(); }
  function weekNext()  { _weekOffset += 1; renderBoard(); }
  function weekToday() { _weekOffset = 0;  renderBoard(); }
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
    _reviewDelete, _reviewUndo, _reviewCenter, _reviewScroll, _irPreviewOutcome,
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
    _onFocusDragOver, _onFocusDragLeave, _onFocusDrop,
    _onDoingDragOver, _onDoingDragLeave, _onDoingDrop,
    removeFromDoing, markDoingDone,
    _closeDetail, _saveDetail, _setBlocked, _setProjState, _onProjStatusChange, _moveItem,
    _showDelConfirm, _resetDelZone, _deleteItem,
    _toggleArchiveProject, _restoreDoneProject, _deleteDoneProject,
    _projOrbDragStart, _projOrbDragEnd, _projDropStatus,
    weekPrev, weekNext, weekToday,
    _onWeekChipDragStart, _onWeekChipDragEnd, _onWeekDragOver, _onWeekDragLeave, _onWeekDrop,
    _onWeekRailDragOver, _onWeekRailDragLeave, _onWeekRailDrop,
    _openCommitEditor, _closeCommitEditor, _saveCommit, _deleteCommit, _commitTypeSelect,
    _projTaskToggleDone, _projTaskDelete, _projSetAddDest, _addProjectTask, _addProjectTaskDetailed,
    _addPendingTask, _removePendingTask,
    _setNewType, _saveNew,
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
