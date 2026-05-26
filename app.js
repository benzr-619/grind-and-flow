// app.js — Grind & Flow (CD redesign)

const PROJECT_COLS = [
  { id: 'active',  label: 'Active',  hint: 'working on' },
  { id: 'up-next', label: 'Up next', hint: 'queued' },
  { id: 'on-hold', label: 'On hold', hint: 'paused' },
  { id: 'someday', label: 'Someday', hint: 'maybe' },
];

const TASK_COLS = [
  { id: 'inbox', label: 'Inbox',  hint: 'captured' },
  { id: 'next',  label: 'Next',   hint: 'lined up' },
  { id: 'done',  label: 'Done',   hint: 'today' },
];

// Timer sequence — warm-up to deep loop (5/10/25/50 with 4-min breaks)
const TIMER_SEQ = [
  { kind: 'work',  m: 5,  label: '5m' },
  { kind: 'break', m: 4,  label: '4'  },
  { kind: 'work',  m: 10, label: '10m' },
  { kind: 'break', m: 4,  label: '4'  },
  { kind: 'work',  m: 25, label: '25m' },
  { kind: 'break', m: 4,  label: '4'  },
  { kind: 'work',  m: 50, label: '50m' },
  { kind: 'break', m: 4,  label: '4'  },
  { kind: 'work',  m: 50, label: '50m' },
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
  let timerTask = null;
  let timerSegIdx = 0;         // current segment in TIMER_SEQ
  let timerSecsRemaining = 0;
  let timerRunning = false;
  let timerInterval = null;
  let timerSegStartMs = 0;     // when current seg started (for clock display)

  // ── Clock for focus row ──
  let clockInterval = null;

  // ── Init ──
  function init() {
    Data.load();
    _updateDate();
    setInterval(_updateDate, 60000);
    render();
    _renderFocusRow();
    _renderTimerTrack();
    _startClock();

    window.addEventListener('beforeunload', () => { Data.saveNow(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') Data.saveNow();
    });
  }

  function _updateDate() {
    const el = document.getElementById('date-display');
    if (!el) return;
    const d = new Date();
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const date = d.getDate();
    const week = _isoWeek(d);
    el.textContent = `${day} · ${month} ${date} · WEEK ${week}`;
  }

  function _isoWeek(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  function render() { renderBoard(); }

  // ── View switching ──
  function switchView(v) {
    view = v;
    archiveOpen = false;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabEl = document.getElementById('tab-' + v);
    if (tabEl) tabEl.classList.add('active');
    const addLabel = document.getElementById('add-label');
    if (addLabel) addLabel.textContent = v === 'projects' ? 'Add project' : 'Add task';
    renderBoard();
  }

  // ── Export / Import ──
  function exportData() {
    Data.saveNow();
    const blob = new Blob([JSON.stringify(Data.get(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gf-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    dismissBanner();
  }

  function importData() { document.getElementById('import-file').click(); }

  function onImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.projects || !data.tasks) throw new Error('bad');
        _showConfirm('Import backup?',
          'This will replace your current data with the backup file.',
          'Import',
          () => { Data.replaceAll(data); renderBoard(); }
        );
      } catch { alert('Invalid backup file.'); }
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
    if (!board) return;

    // Update board title
    const titleEl = document.getElementById('board-title');
    if (titleEl) {
      if (archiveOpen) titleEl.textContent = 'Archive';
      else titleEl.textContent = view === 'projects' ? 'Projects' : 'Tasks';
    }

    if (archiveOpen) { _renderArchive(board); return; }

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

    board.innerHTML = `<div class="columns">${cols.map(col => {
      const colItems = items.filter(i => i.status === col.id);
      return `<div>
        <div class="col-head">
          <span class="col-name">
            ${col.label} <span class="col-count">${String(colItems.length).padStart(2, '0')}</span>
          </span>
          <span class="col-hint">${col.hint}</span>
        </div>
        <div class="col-body" data-col="${col.id}"
          ondragover="App._onDragOver(event,'${col.id}')"
          ondragleave="App._onDragLeave(event)"
          ondrop="App._onDrop(event,'${col.id}')">
          ${colItems.map(i => view === 'projects' ? _renderProjCard(i) : _renderTaskCard(i)).join('')}
          ${colItems.length === 0 ? `<div class="col-empty">empty</div>` : ''}
          <button class="add-col-btn" onclick="App.openNewModal('${col.id}')">+ add</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function _renderTaskCard(item) {
    let badges = '';
    if (item.blocked) badges += `<span class="pill pill-amber pill-xs">blocked</span>`;
    if (item.dueDate) {
      const over = _isOverdue(item.dueDate);
      badges += `<span class="pill ${over ? 'pill-red' : 'pill-amber'} pill-xs">${over ? 'overdue' : 'due'} ${_fmtDate(item.dueDate)}</span>`;
    }

    let ageDot = '';
    const d = _daysDiff(item.dateAdded);
    if (d > 30) ageDot = `<span class="age-dot old" title="${d}d in list"></span>`;
    else if (d > 14) ageDot = `<span class="age-dot stale" title="${d}d in list"></span>`;

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
    const focusBtn = item.status === 'next' && !isActive
      ? `<button class="focus-btn" onclick="event.stopPropagation();App.activateTask('${item.id}')">focus →</button>` : '';

    return `<div class="card${isActive ? ' card-active' : ''}" draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)"
      onclick="App.openDetail('${item.id}')">
      <div class="card-title">${esc(item.title)}</div>
      ${projectLink}${meta}${subtaskRow}${focusBtn}
    </div>`;
  }

  function _renderProjCard(item) {
    const totalTasks = (item.subtasks || []).length;
    const done = (item.subtasks || []).filter(s => s.done).length;
    const pct = totalTasks ? Math.round((done / totalTasks) * 100) : 0;

    const blockedBadge = item.blocked ? `<span class="pill pill-amber pill-xs">blocked</span>` : '';
    const dueBadge = item.dueDate
      ? `<span class="pill ${_isOverdue(item.dueDate) ? 'pill-red' : 'pill-amber'} pill-xs">${_isOverdue(item.dueDate) ? 'overdue' : 'due'} ${_fmtDate(item.dueDate)}</span>` : '';
    const blockedReason = item.blocked && item.blockedReason
      ? `<div class="proj-blocked-reason"><span>↳</span> ${esc(item.blockedReason)}</div>` : '';
    const notesBadge = item.notes ? `<span class="pill pill-xs" title="${esc(item.notes)}">notes</span>` : '';

    return `<div class="proj-card${item.status === 'on-hold' ? ' on-hold' : ''}"
      draggable="true" data-id="${item.id}"
      ondragstart="App._onDragStart(event,'${item.id}')"
      ondragend="App._onDragEnd(event)">
      <div class="proj-card-head" onclick="App.openDetail('${item.id}')" style="cursor:pointer">
        <div class="proj-title-row">
          <div class="proj-name">${esc(item.title)}</div>
          <button class="proj-toggle${item._open ? ' open' : ''}"
            onclick="event.stopPropagation();App._toggleProjOpen('${item.id}')">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
              style="transform:${item._open ? 'rotate(0deg)' : 'rotate(-90deg)'};transition:transform 160ms">
              <path d="M4 6l4 5 4-5z"/>
            </svg>
          </button>
        </div>
        <div class="proj-meta">
          <span class="pill pill-xs">${item.type === 'project' ? 'PROJECT' : 'TASK'}</span>
          ${item.dateAdded ? `<span class="proj-meta-sep">·</span><span>${_ageLabelProject(item.dateAdded)}</span>` : ''}
          ${blockedBadge}${dueBadge}${notesBadge}
        </div>
        ${blockedReason}
      </div>
      <div class="proj-progress" onclick="App.openDetail('${item.id}')" style="cursor:pointer">
        ${totalTasks === 0
          ? `<div class="proj-no-tasks">no tasks yet</div>`
          : `<div class="proj-progress-row">
              <span>${done}/${totalTasks} tasks</span>
              <span>${pct}%</span>
            </div>
            <div class="proj-bar"><div class="proj-bar-fill" style="width:${pct}%"></div></div>`
        }
      </div>
      ${item._open ? `<div class="proj-subtasks">
        <div class="proj-subtasks-head">Tasks</div>
        ${(item.subtasks || []).map(st => _renderSubtaskInCard(st, item.id)).join('')}
        <div class="add-subtask-row" onclick="event.stopPropagation()">
          <input type="text" placeholder="Add task to project..."
            id="inline-st-${item.id}"
            onkeydown="if(event.key==='Enter')App._inlineAddSubtask('${item.id}')" />
          <button onclick="App._inlineAddSubtask('${item.id}')">+ add</button>
        </div>
      </div>` : ''}
    </div>`;
  }

  function _renderSubtaskInCard(st, projId) {
    const tagLabel = st.promoted ? 'ON BOARD' : 'BACKLOG';
    return `<div class="subtask-item">
      <input type="checkbox" ${st.done ? 'checked' : ''} ${st.promoted ? 'disabled' : ''}
        onclick="event.stopPropagation()"
        onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
      <span class="subtask-item-title${st.done ? ' done' : ''}">${esc(st.title)}</span>
      ${st.due ? `<span style="font-family:var(--font-mono);font-size:9.5px;color:var(--amber)">${esc(st.due)}</span>` : ''}
      <span class="subtask-promote${st.promoted ? ' promoted' : ''}"
        onclick="event.stopPropagation();${st.promoted ? '' : `App._promoteSubtask('${projId}','${st.id}')`}">
        ${st.promoted ? '✓ on board' : '→ task board'}
      </span>
      ${!st.promoted ? `<button class="subtask-del" onclick="event.stopPropagation();App._removeSubtask('${projId}','${st.id}')">✕</button>` : ''}
    </div>`;
  }

  function _toggleProjOpen(id) {
    const item = Data.findProject(id);
    if (!item) return;
    item._open = !item._open;
    renderBoard();
  }

  function _inlineAddSubtask(projId) {
    const input = document.getElementById('inline-st-' + projId);
    const title = input?.value.trim();
    if (!title) return;
    const proj = Data.findProject(projId);
    if (!proj) return;
    const st = { id: 'st' + Date.now(), title, done: false, promoted: false };
    proj.subtasks.push(st);
    Data.save();
    renderBoard();
  }

  function _ageLabelProject(dateAdded) {
    const d = _daysDiff(dateAdded);
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    if (d < 14) return '1w ago';
    if (d < 30) return `${Math.floor(d/7)}w ago`;
    return `${Math.floor(d/30)}mo ago`;
  }

  function _renderArchive(board) {
    const state = Data.get();
    const archive = (state.archive || []);
    if (!archive.length) {
      board.innerHTML = `<div class="archive-empty">No archived items yet.</div>`;
      return;
    }
    board.innerHTML = `<div class="archive-section">
      <div class="archive-group">
        <div class="archive-group-head">
          <span>Archive</span>
          <span>${archive.length} items</span>
        </div>
        ${archive.map(item => `
          <div class="archive-row ${item.type}">
            <span class="archive-dot"></span>
            <span class="archive-name">${esc(item.title)}</span>
            <span class="pill pill-xs">${item.type === 'project' ? 'PROJECT' : 'TASK'}</span>
            <span class="archive-date">${item.archivedAt || ''}</span>
            <button class="archive-restore" onclick="App.restoreItem('${item.id}')">restore</button>
            <button class="archive-del" onclick="App.deleteArchiveItem('${item.id}')">✕</button>
          </div>`).join('')}
      </div>
    </div>`;
  }

  function toggleArchive() {
    archiveOpen = !archiveOpen;
    const btn = document.getElementById('archive-btn');
    if (btn) btn.style.color = archiveOpen ? 'var(--sage-deep)' : '';
    renderBoard();
  }

  function restoreItem(id) { Data.restoreFromArchive(id); renderBoard(); }
  function deleteArchiveItem(id) { Data.deleteFromArchive(id); renderBoard(); }

  // ── Search ──
  function toggleSearch() {
    searchOpen = !searchOpen;
    const wrap = document.getElementById('search-bar-wrap');
    if (wrap) wrap.classList.toggle('open', searchOpen);
    const btn = document.getElementById('search-btn');
    if (btn) btn.style.color = searchOpen ? 'var(--sage-deep)' : '';
    if (searchOpen) setTimeout(() => document.getElementById('search-input')?.focus(), 50);
    else { searchQuery = ''; renderBoard(); }
  }

  function onSearch(val) { searchQuery = val; renderBoard(); }

  // ── Focus row + Clock ──
  function _startClock() {
    clearInterval(clockInterval);
    clockInterval = setInterval(_renderClock, 1000);
    _renderClock();
  }

  function _renderClock() {
    // Show remaining time in active segment, or wall clock
    const el = document.getElementById('focus-clock-time');
    if (!el) return;

    if (timerTask && timerRunning && timerSecsRemaining > 0) {
      const m = String(Math.floor(timerSecsRemaining / 60)).padStart(2, '0');
      const s = String(timerSecsRemaining % 60).padStart(2, '0');
      el.innerHTML = `${m}<span class="colon">:</span>${s}<span class="focus-clock-remaining">remaining</span>`;
    } else if (timerTask) {
      const m = String(Math.floor(timerSecsRemaining / 60)).padStart(2, '0');
      const s = String(timerSecsRemaining % 60).padStart(2, '0');
      el.innerHTML = `${m}<span class="colon">:</span>${s}<span class="focus-clock-remaining">remaining</span>`;
    } else {
      // Show wall clock
      const now = new Date();
      const m = String(now.getHours()).padStart(2, '0');
      const s = String(now.getMinutes()).padStart(2, '0');
      el.innerHTML = `${m}<span class="colon">:</span>${s}<span class="focus-clock-remaining" style="opacity:0"></span>`;
    }
  }

  function _renderFocusRow() {
    const focusRow = document.getElementById('focus-row');
    if (!focusRow) return;

    const activeCount = timerTask ? 1 : 0;
    focusRow.innerHTML = `
      <div>
        <div class="doing-head">
          <span class="doing-label">Doing</span>
          <span class="doing-count">(${activeCount})</span>
          <span class="doing-quip">commit to fewer things</span>
        </div>
        <div class="doing-cards">
          ${_renderDoingNow()}
          ${_renderDoingNext()}
          <button class="commit-btn" onclick="App._openFocusCommit()">
            <span>+ commit</span>
          </button>
        </div>
      </div>
      <div class="focus-clock">
        <div class="focus-clock-label">focus</div>
        <div class="focus-clock-time" id="focus-clock-time">--:--</div>
      </div>`;
    _renderClock();
  }

  function _renderDoingNow() {
    if (!timerTask) {
      return `<div class="doing-card idle">nothing committed</div>`;
    }
    const item = Data.findItem(timerTask.id) || timerTask;
    return `<div class="doing-card now${timerRunning ? ' ticking' : ''}">
      <button class="play-btn${timerRunning ? ' running' : ''}" onclick="App.timerTogglePlay()">
        ${timerRunning
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="0.5"/><rect x="14" y="4.5" width="4" height="15" rx="0.5"/></svg>`
          : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5-13-7.5z"/></svg>`}
      </button>
      <div class="doing-meta">
        <div class="doing-meta-top">
          <span class="pill pill-sage pill-xs">● now</span>
          <span class="pill pill-xs">${esc(item.type === 'project' ? 'PROJECT' : 'TASK')}</span>
        </div>
        <div class="doing-task-title">${esc(item.title)}</div>
      </div>
      <div class="doing-elapsed">
        <div class="doing-elapsed-label">elapsed</div>
        <div class="doing-elapsed-value">${timerTask._elapsed || 0}<span style="font-size:14px;color:var(--muted);font-style:normal;margin-left:2px">m</span></div>
      </div>
    </div>`;
  }

  function _renderDoingNext() {
    // Find next item in 'next' status that isn't active
    const state = Data.get();
    const nextItems = state.tasks.filter(t =>
      t.status === 'next' && (!timerTask || t.id !== timerTask.id)
    );
    const nextItem = nextItems[0];
    if (!nextItem) {
      return `<div class="doing-card idle">nothing queued</div>`;
    }
    return `<div class="doing-card">
      <button class="play-btn" onclick="App.activateTask('${nextItem.id}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5-13-7.5z"/></svg>
      </button>
      <div class="doing-meta">
        <div class="doing-meta-top">
          <span class="doing-label-next">next</span>
          <span class="pill pill-xs">TASK</span>
        </div>
        <div class="doing-stub-title">${esc(nextItem.title)}</div>
      </div>
    </div>`;
  }

  function _openFocusCommit() {
    // Quick: show modal with next items to commit
    const state = Data.get();
    const nextTasks = state.tasks.filter(t => t.status === 'next');
    if (!nextTasks.length) {
      // Go to next column in task view
      switchView('tasks');
      return;
    }
    switchView('tasks');
  }

  // ── Timer track rendering ──
  function _renderTimerTrack() {
    const track = document.getElementById('timer-track');
    if (!track) return;

    const segs = TIMER_SEQ.map((seg, i) => {
      const done = i < timerSegIdx;
      const cur  = i === timerSegIdx;
      const wClass = seg.kind === 'break' ? 'tseg-break' : `tseg-${seg.m}`;
      const fillPct = cur && timerRunning && seg.kind !== 'break'
        ? Math.min(1, 1 - timerSecsRemaining / (seg.m * 60))
        : (cur ? 1 - timerSecsRemaining / (seg.m * 60) : 0);
      return `<div class="tseg ${wClass}${seg.kind === 'break' ? ' break' : ''}${done ? ' done' : ''}${cur ? ' current' : ''}"
          onclick="App._timerJump(${i})"
          title="${seg.kind === 'work' ? seg.m + '-minute work' : seg.m + '-minute break'}">
          ${cur ? `<div class="fill" style="transform:scaleX(${Math.max(0, fillPct)})"></div>` : ''}
        </div>`;
    }).join('');

    const labels = TIMER_SEQ.map((seg, i) => {
      const wClass = seg.kind === 'break' ? 'tseg-break' : `tseg-${seg.m}`;
      return `<div class="tl-seg ${wClass}${i === timerSegIdx ? ' active' : ''}">${seg.kind !== 'break' ? seg.label : ''}</div>`;
    }).join('');

    track.innerHTML = `
      <div class="timer-track-head">
        <div class="timer-track-title">
          <span class="key">Timer ·</span>
          <span class="val">warm-up → deep loop</span>
        </div>
      </div>
      <div class="timer-segments">
        ${segs}
        <div class="timer-loops">
          <button class="timer-loops-btn" title="loop sequence">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5"/>
            </svg>
          </button>
          <span class="lbl">loops</span>
        </div>
      </div>
      <div class="timer-labels">${labels}<div style="width:60px"></div></div>`;
  }

  // ── Timer logic ──
  function activateTask(id) {
    const item = Data.findItem(id);
    if (!item) return;
    if (timerTask && timerTask.id === id) {
      _startTimer(); return;
    }
    clearInterval(timerInterval); timerInterval = null;
    timerTask = { ...item, _elapsed: 0 };
    timerSegIdx = 0;
    timerSecsRemaining = TIMER_SEQ[0].m * 60;
    timerRunning = true;
    _startTimer();
    _renderFocusRow();
    _renderTimerTrack();
    renderBoard();
  }

  function endSession(action) {
    clearInterval(timerInterval); timerInterval = null;
    clearInterval(timerElapsedInterval); timerElapsedInterval = null;
    if (action === 'done' && timerTask) {
      const item = Data.findItem(timerTask.id);
      if (item) { item.status = 'done'; Data.save(); }
    }
    timerTask = null; timerRunning = false;
    timerSegIdx = 0; timerSecsRemaining = 0;
    _renderFocusRow(); _renderTimerTrack(); renderBoard();
  }

  let timerElapsedInterval = null;

  function _startTimer() {
    clearInterval(timerInterval);
    timerRunning = true;
    timerInterval = setInterval(() => {
      if (timerSecsRemaining > 0) {
        timerSecsRemaining--;
        _renderClock();
        _updateSegFill();
      } else {
        // Advance to next segment
        const nextIdx = Math.min(timerSegIdx + 1, TIMER_SEQ.length - 1);
        if (nextIdx !== timerSegIdx) {
          timerSegIdx = nextIdx;
          timerSecsRemaining = TIMER_SEQ[nextIdx].m * 60;
          _playChime();
          _renderTimerTrack();
          _renderFocusRow();
        }
      }
    }, 1000);

    // Elapsed counter (1 min increments)
    clearInterval(timerElapsedInterval);
    timerElapsedInterval = setInterval(() => {
      if (timerTask) {
        timerTask._elapsed = (timerTask._elapsed || 0) + 1;
        const elEl = document.querySelector('.doing-elapsed-value');
        if (elEl) elEl.innerHTML = `${timerTask._elapsed}<span style="font-size:14px;color:var(--muted);font-style:normal;margin-left:2px">m</span>`;
      }
    }, 60000);
  }

  function timerTogglePlay() {
    if (timerRunning) {
      clearInterval(timerInterval); timerInterval = null;
      clearInterval(timerElapsedInterval); timerElapsedInterval = null;
      timerRunning = false;
    } else {
      _startTimer();
    }
    _renderFocusRow();
  }

  function _timerJump(idx) {
    timerSegIdx = idx;
    timerSecsRemaining = TIMER_SEQ[idx].m * 60;
    if (timerTask && timerRunning) _startTimer();
    _renderTimerTrack();
    _renderClock();
  }

  function _updateSegFill() {
    const fillEl = document.querySelector('.tseg.current .fill');
    if (!fillEl) return;
    const seg = TIMER_SEQ[timerSegIdx];
    const pct = Math.max(0, 1 - timerSecsRemaining / (seg.m * 60));
    fillEl.style.transform = `scaleX(${pct})`;
  }

  function _playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [220, 440, 660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.18 / (i + 1), ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 3.5);
      });
    } catch(e) {}
  }

  // ── Detail modal ──
  function openDetail(id) {
    const item = Data.findItem(id);
    if (!item) return;
    openItemId = id;
    const isProject = item.type === 'project';
    const cols = isProject ? PROJECT_COLS : TASK_COLS;

    const moveBtns = cols.map(c =>
      `<button class="move-btn ${item.status === c.id ? 'current' : ''}"
        onclick="App._moveItem('${id}','${c.id}',this)">${c.label}</button>`
    ).join('');

    const projectLinkHtml = (!isProject && item.parentProject)
      ? `<div class="fg"><label class="modal-label">Project</label>
         <div style="font-size:13px;color:var(--steel);padding:6px 0;font-family:var(--font-body)">${esc(Data.findProject(item.parentProject)?.title || '—')}</div></div>`
      : '';

    const subtaskHtml = isProject ? _buildSubtaskEditor(item) : '';

    _showModal(`
      <div class="modal-title">${esc(item.title)}</div>
      <div class="modal-section">
        <label class="modal-label">Move to</label>
        <div class="move-row">${moveBtns}</div>
      </div>
      <div class="modal-section">
        <div class="fg"><label class="modal-label">Title</label>
          <input type="text" class="modal-input" id="d-title" value="${esc(item.title)}" /></div>
        ${projectLinkHtml}
        <div class="field-row">
          <div class="fg"><label class="modal-label">Due date</label>
            <input type="date" class="modal-input" id="d-due" value="${item.dueDate || ''}" /></div>
          <div class="fg"><label class="modal-label">Scheduled</label>
            <input type="date" class="modal-input" id="d-sched" value="${item.scheduledDate || ''}" /></div>
        </div>
        <div class="fg"><label class="modal-label">Notes</label>
          <textarea class="modal-input" id="d-notes">${esc(item.notes || '')}</textarea></div>
        <div class="fg">
          <label class="modal-label">Blocked?</label>
          <div class="blocked-toggle">
            <button class="blocked-opt ${!item.blocked ? 'active-no' : ''}" id="bno" onclick="App._setBlocked('${id}',false)">✓ Clear</button>
            <button class="blocked-opt ${item.blocked ? 'active-yes' : ''}" id="byes" onclick="App._setBlocked('${id}',true)">⏸ Blocked</button>
          </div>
          ${item.blocked ? `<input type="text" class="modal-input" id="d-blocked-reason" placeholder="Reason (optional)..." value="${esc(item.blockedReason || '')}" style="margin-top:8px" />` : ''}
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

  function _buildSubtaskEditor(item) {
    const rows = (item.subtasks || []).map(st => _buildSubtaskRow(st, item.id)).join('');
    return `<div class="modal-section">
      <label class="modal-label">Tasks <span class="modal-label-hint">promote to send to task board · drag to reorder</span></label>
      <div class="subtask-list" id="stlist-${item.id}"
        ondragover="App._stListDragOver(event,'${item.id}')"
        ondrop="App._stListDrop(event,'${item.id}')">
        ${rows || '<div style="font-size:12px;color:var(--muted);padding:4px 0;font-family:var(--font-body);font-style:italic">No tasks yet</div>'}
      </div>
      <div class="add-subtask-row" style="margin-top:8px">
        <input type="text" class="modal-input" id="new-st-${item.id}" placeholder="Add task..."
          onkeydown="if(event.key==='Enter')App._addSubtask('${item.id}')" />
        <button onclick="App._addSubtask('${item.id}')">+ add</button>
      </div>
    </div>`;
  }

  function _buildSubtaskRow(st, projId) {
    return `<div class="subtask-item" id="sti-${st.id}" draggable="true"
      ondragstart="App._stDragStart(event,'${projId}','${st.id}')"
      ondragend="App._stDragEnd(event)">
      <span class="subtask-item-handle" title="Drag to reorder">⠿</span>
      <input type="checkbox" ${st.done ? 'checked' : ''} ${st.promoted ? 'disabled' : ''}
        onchange="App._toggleSubtask('${projId}','${st.id}',this.checked)" />
      <span class="subtask-item-title${st.done ? ' done' : ''}" id="stspan-${st.id}">${esc(st.title)}</span>
      <button class="subtask-promote${st.promoted ? ' promoted' : ''}"
        ${st.promoted ? 'disabled' : ''}
        onclick="App._promoteSubtask('${projId}','${st.id}')">
        ${st.promoted ? '✓ on board' : '→ task board'}
      </button>
      ${!st.promoted ? `<button class="subtask-del" onclick="App._removeSubtask('${projId}','${st.id}')">✕</button>` : ''}
    </div>`;
  }

  function _closeDetail() {
    if (openItemId) { openItemId = null; }
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  function _saveDetail(id) {
    const item = Data.findItem(id);
    if (!item) return;
    const t = document.getElementById('d-title');
    const d = document.getElementById('d-due');
    const s = document.getElementById('d-sched');
    const n = document.getElementById('d-notes');
    const r = document.getElementById('d-blocked-reason');
    if (t && t.value.trim()) item.title = t.value.trim();
    if (d) item.dueDate = d.value || '';
    if (s) item.scheduledDate = s.value || '';
    if (n) item.notes = n.value || '';
    if (r) item.blockedReason = r.value || '';
    if (item.type === 'project') Data.upsertProject(item);
    else Data.upsertTask(item);
  }

  function _setBlocked(id, val) {
    const item = Data.findItem(id);
    if (item) { item.blocked = val; Data.save(); }
    const bno = document.getElementById('bno');
    const byes = document.getElementById('byes');
    if (bno) bno.className = 'blocked-opt' + (!val ? ' active-no' : '');
    if (byes) byes.className = 'blocked-opt' + (val ? ' active-yes' : '');
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
    if (span) span.className = 'subtask-item-title' + (checked ? ' done' : '');
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
      status: 'next', parentProject: projId,
      dueDate: '', scheduledDate: '', notes: '',
      dateAdded: _today(), blocked: false
    });
    const btn = document.getElementById('promote-' + stId);
    if (btn) { btn.textContent = '✓ on board'; btn.className = 'subtask-promote promoted'; btn.disabled = true; }
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
    if (list) list.insertAdjacentHTML('beforeend', _buildSubtaskRow(st, projId));
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
    _newType = view === 'projects' ? 'project' : 'standalone';
    const cols = view === 'projects' ? PROJECT_COLS : TASK_COLS;
    const statusOpts = cols.map(c =>
      `<option value="${c.id}" ${c.id === defaultStatus ? 'selected' : ''}>${c.label}</option>`
    ).join('');
    const projOpts = Data.get().projects.map(p =>
      `<option value="${p.id}">${esc(p.title)}</option>`
    ).join('');

    const taskExtra = view === 'tasks' ? `
      <div class="fg"><label class="modal-label">Type</label>
        <div class="type-toggle" id="type-seg">
          <button class="type-opt active" data-t="standalone" onclick="App._setNewType('standalone',this)">Standalone</button>
          <button class="type-opt" data-t="task" onclick="App._setNewType('task',this)">Linked to project</button>
        </div>
      </div>
      <div class="fg" id="proj-link-group" style="display:none">
        <label class="modal-label">Project</label>
        <select class="modal-input" id="f-parent">${projOpts}</select>
      </div>` : '';

    _showModal(`
      <div class="modal-title">New ${view === 'projects' ? 'project' : 'task'}</div>
      <div class="fg"><label class="modal-label">Title</label>
        <input type="text" class="modal-input" id="f-title" placeholder="Name..." /></div>
      ${taskExtra}
      <div class="fg"><label class="modal-label">Status</label>
        <select class="modal-input" id="f-status">${statusOpts}</select></div>
      <div class="field-row">
        <div class="fg"><label class="modal-label">Due date</label>
          <input type="date" class="modal-input" id="f-due" /></div>
        <div class="fg"><label class="modal-label">Scheduled</label>
          <input type="date" class="modal-input" id="f-sched" /></div>
      </div>
      <div class="fg"><label class="modal-label">Notes</label>
        <textarea class="modal-input" id="f-notes" placeholder="Optional..."></textarea></div>
      <div class="modal-footer">
        <div></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="App._cancelNew()">Cancel</button>
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
      Data.upsertProject({ id, type: 'project', title, status, dueDate: due, scheduledDate: sched, notes, dateAdded: _today(), subtasks: [], blocked: false });
    } else {
      const parent = _newType === 'task' ? (document.getElementById('f-parent')?.value || null) : null;
      Data.upsertTask({ id, type: _newType, title, status, parentProject: parent, dueDate: due, scheduledDate: sched, notes, dateAdded: _today(), blocked: false });
    }
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  // ── Confirm modal ──
  function _showConfirm(title, message, confirmLabel, onConfirm) {
    _showModal(`
      <div class="modal-title">${title}</div>
      <p style="font-size:13px;color:var(--steel);line-height:1.6;margin-bottom:20px;font-family:var(--font-body)">${message}</p>
      <div class="modal-footer">
        <div></div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="document.getElementById('modal-root').innerHTML=''">Cancel</button>
          <button class="btn-save" onclick="(${onConfirm.toString()})();document.getElementById('modal-root').innerHTML='';">${confirmLabel}</button>
        </div>
      </div>`, null);
  }

  function _showModal(content, itemId) {
    openItemId = itemId || null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay" id="moverlay"><div class="modal">${content}</div></div>`;
    document.getElementById('moverlay').addEventListener('click', e => {
      if (e.target.id === 'moverlay') {
        if (openItemId) { _saveDetail(openItemId); _closeDetail(); }
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
    else e.currentTarget.insertBefore(placeholder, addBtn);
  }

  function _onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

  function _dragAfterEl(container, y) {
    return [...container.querySelectorAll('.card:not(.is-dragging), .proj-card:not(.is-dragging)')].reduce((closest, el) => {
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
    document.querySelectorAll('.col-body').forEach(c => c.classList.remove('drag-over'));
    renderBoard();
  }

  // ── Subtask drag reorder ──
  let stDragId = null, stProjId = null, stPlaceholder = null, stDragEl = null;

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
    e.dataTransfer.dropEffect = 'move';
    if (!stPlaceholder) { stPlaceholder = document.createElement('div'); stPlaceholder.className = 'st-placeholder'; }
    const list = document.getElementById('stlist-' + projId);
    if (!list) return;
    const afterEl = _stAfterEl(list, e.clientY);
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
    const placeholderIdx = [...list.children].indexOf(stPlaceholder);
    const itemsBefore = [...list.children].slice(0, placeholderIdx).filter(el => el.classList.contains('subtask-item'));
    const newIdx = itemsBefore.length;
    const fromIdx = proj.subtasks.findIndex(s => s.id === stDragId);
    if (fromIdx >= 0) {
      const [moved] = proj.subtasks.splice(fromIdx, 1);
      const insertAt = newIdx > fromIdx ? newIdx - 1 : newIdx;
      proj.subtasks.splice(insertAt, 0, moved);
      Data.save();
    }
    stPlaceholder?.remove(); stPlaceholder = null;
    if (list) list.innerHTML = proj.subtasks.map(st => _buildSubtaskRow(st, projId)).join('');
  }

  function _stAfterEl(container, y) {
    return [...container.querySelectorAll('.subtask-item:not(.is-dragging)')].reduce((closest, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: el };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // ── Helpers ──
  function _today() { return new Date().toISOString().split('T')[0]; }
  function _daysDiff(ds) { if (!ds) return 0; return Math.floor((new Date() - new Date(ds)) / 86400000); }
  function _isOverdue(ds) { if (!ds) return false; return new Date(ds) < new Date(new Date().toDateString()); }
  function _fmtDate(ds) { if (!ds) return ''; return new Date(ds).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    init, switchView, toggleArchive, toggleSearch, onSearch,
    openDetail, openNewModal,
    exportData, importData, onImportFile, dismissBanner,
    restoreItem, deleteArchiveItem,
    activateTask, endSession, timerTogglePlay,
    _timerJump,
    _onDragStart, _onDragEnd, _onDragOver, _onDragLeave, _onDrop,
    _closeDetail, _saveDetail, _setBlocked, _moveItem,
    _showDelConfirm, _resetDelZone, _deleteItem,
    _toggleSubtask, _promoteSubtask, _addSubtask, _removeSubtask,
    _setNewType, _cancelNew, _saveNew,
    _stDragStart, _stDragEnd, _stListDragOver, _stListDrop,
    _toggleProjOpen, _inlineAddSubtask,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
