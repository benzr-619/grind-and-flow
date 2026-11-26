// app.js — Grind & Flow (One List, 2026-11-25)
//
// UI layer. Desktop: One List (Today · Offered · Everything · Log) rendered into #ol-view
// by _renderOL(). Phone (≤640px): the bare stopgap in #mobile-app (_renderPhone()).
// Focus: the full-screen orb overlay #focus-zone (unchanged visual language).
// All persistence goes through Data.* (data.js); entry-bar parsing is GFParse (parse.js).
// See CLAUDE.md + .claude/rules/one-list.md.

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

const App = (() => {
  let _initialized = false;  // guarded by auth.js — prevents double-init on token refresh
  let openItemId = null;     // the recurring modal's open item (modal-root)

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

  // ── Focus (One List) — which task is in Focus is in-memory, not a status. ──
  // Focus is opened from Today item 1 ("start"); the task stays on Today the whole time,
  // and a reload simply ends the session (minutes already logged are kept).
  // _focusHandoff = the post-Done "up next on Today" card state.
  let _focusId = null;
  let _focusStartEventId = null;
  let _focusHandoff = null; // { doneTitle, minutes } while the up-next card shows

  // ── Recurring tasks ──
  // Two kinds: 'rolling' (interval measured from the completion date — fully automatic)
  // and 'anchored' (a real due date; the next due date is set by the user via a
  // completion-time confirm prompt, optionally pre-filled from a weekday/month-day
  // default rule). Daily recurrence is out of scope (habits). `recurrenceWeekdays`
  // uses 0=Mon…6=Sun (matches _WEEK_DOW ordering elsewhere). Recurring tasks live
  // permanently in the dedicated Recurring column — see openRecurringModal.
  function _nextRollingDate(item, fromDateStr) {
    const from = new Date(fromDateStr + 'T00:00:00');
    const n = item.recurrenceIntervalN || 1;
    const unit = item.recurrenceIntervalUnit || 'days';
    const d = new Date(from);
    if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
    else if (unit === 'months') d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n);
    return _ymd(d);
  }

  // Suggests the next due date for an anchored task, used to pre-fill the completion
  // confirm prompt. Prefers the optional weekday/month-day default rule; falls back to
  // the just-completed task's own due date as a starting nudge (never a hard rule).
  function _nextAnchoredSuggestedDate(item, fromDateStr) {
    const from = new Date(fromDateStr + 'T00:00:00');
    if (item.recurrenceWeekdays && item.recurrenceWeekdays.length) {
      for (let i = 1; i <= 14; i++) {
        const d = new Date(from); d.setDate(d.getDate() + i);
        const dow = (d.getDay() + 6) % 7; // JS: 0=Sun…6=Sat → 0=Mon…6=Sun
        if (item.recurrenceWeekdays.includes(dow)) return _ymd(d);
      }
    }
    if (item.recurrenceMonthDay) {
      const d = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(item.recurrenceMonthDay, lastDay));
      return _ymd(d);
    }
    return item.dueDate || fromDateStr;
  }

  // Spawns the next occurrence of a recurring task on completion. Rolling occurrences
  // are created silently (fully deterministic — completion date + interval). Anchored
  // occurrences pop a small non-blocking confirm prompt for the next due date + lead
  // time; dismissing it without confirming still creates the occurrence using the
  // pre-filled suggestion (a series is never silently dropped). Both land in status
  // 'recurring' — the permanent home for recurring tasks (see the Recurring column).
  function _maybeSpawnRecurrence(item, completionDateStr) {
    if (!item.recurrence || item.type === 'project') return;
    const seriesId = item.recurrenceSeriesId || item.id;
    const baseNew = {
      id: 't' + Date.now(), type: item.type, title: item.title, status: 'recurring',
      parentProject: item.parentProject || null,
      scheduledTime: '', notes: item.notes || '', tags: [], area: item.area || null, source: item.source || null,
      dateAdded: _today(), backlogEnteredAt: '', laterCount: 0, blocked: false,
      recurrence: item.recurrence,
      recurrenceSeriesId: seriesId,
      recurrenceWeekdays: item.recurrenceWeekdays || null,
      recurrenceMonthDay: item.recurrenceMonthDay || null,
      recurrenceIntervalN: item.recurrenceIntervalN || null,
      recurrenceIntervalUnit: item.recurrenceIntervalUnit || null,
      recurrenceLeadDays: item.recurrenceLeadDays ?? null,
    };
    if (item.recurrence === 'rolling') {
      const nextDate = _nextRollingDate(item, completionDateStr);
      // Alternating pair: the next occurrence swaps sides — it takes the stored
      // alternate's title/tags/notes, and its own alternate becomes a snapshot of
      // whichever content just completed. No alternate: unchanged, same content repeats.
      // Either way scheduledDate is completion date + the shared interval — there's no
      // separate per-side schedule, only whichever side is currently live.
      const alt = item.recurrenceAlternate;
      const swapFields = alt
        ? { title: alt.title, notes: alt.notes || '', tags: [...(alt.tags || [])],
            recurrenceAlternate: { title: item.title, notes: item.notes || '', tags: [...(item.tags || [])] } }
        : { recurrenceAlternate: null };
      // recurrenceLastCompletedAt is "when this cadence last had any completion" —
      // set on every spawn regardless of whether the series uses an alternating pair,
      // not a per-side field. Kept for history and surfaced on the card (see
      // _renderRecurringCard); due/overdue state is driven by scheduledDate directly
      // (see _recurDueState). Anchored sets the same field via _recurConfirmSave/
      // _recurConfirmDismiss below, off the completionDateStr threaded through
      // _openRecurConfirm — both recurrence kinds populate it now.
      Data.upsertTask({ ...baseNew, ...swapFields, dueDate: '', scheduledDate: nextDate, recurrenceLastCompletedAt: completionDateStr });
      return;
    }
    if (item.recurrence === 'anchored') {
      const suggested = _nextAnchoredSuggestedDate(item, completionDateStr);
      _openRecurConfirm(baseNew, suggested, item.recurrenceLeadDays ?? 0, completionDateStr);
    }
  }

  // ── Anchored-recurrence completion prompt ──
  let _recurConfirmState = null; // { baseNew, suggestedDate, suggestedLead, completionDateStr }

  function _openRecurConfirm(baseNew, suggestedDate, suggestedLead, completionDateStr) {
    _recurConfirmState = { baseNew, suggestedDate, suggestedLead: suggestedLead || 0, completionDateStr };
    const root = document.getElementById('modal-root');
    if (_isMobile()) {
      root.innerHTML = `
        <div class="bs-overlay" onclick="App._recurConfirmDismiss()">
          <div class="bottom-sheet m-detail-sheet" onclick="event.stopPropagation()">
            <div class="bs-handle-row"><div class="bs-handle"></div></div>
            <div class="bs-title">Next occurrence</div>
            <div class="bs-section m-detail-recur-note">"${esc(baseNew.title)}" — pick the next due date, or keep the suggestion.</div>
            <div class="bs-section"><label class="bs-label">Next due date</label>
              <input type="date" class="bs-date-input" id="rc-date" value="${suggestedDate}" /></div>
            <div class="bs-section"><label class="bs-label">Lead time (days)</label>
              <input type="number" class="bs-date-input" id="rc-lead" min="0" value="${suggestedLead || 0}" /></div>
            <div class="bs-footer m-sheet-quick">
              <button class="m-sheet-qbtn" onclick="App._recurConfirmDismiss()">Use suggestion</button>
              <button class="m-sheet-qbtn m-qa-complete" onclick="App._recurConfirmSave()">Confirm</button>
            </div>
          </div>
        </div>`;
      return;
    }
    root.innerHTML = `
      <div class="rc-overlay" onclick="App._recurConfirmDismiss()">
        <div class="rc-modal" onclick="event.stopPropagation()">
          <div class="rc-title">Schedule the next occurrence</div>
          <div class="rc-sub">"${esc(baseNew.title)}" — pick the next due date, or keep the suggestion.</div>
          <div class="fg"><label class="modal-label">Next due date</label>
            <input type="date" class="modal-input" id="rc-date" value="${suggestedDate}" /></div>
          <div class="fg"><label class="modal-label">Lead time (days before due to flag as due-soon)</label>
            <input type="number" class="modal-input" id="rc-lead" min="0" value="${suggestedLead || 0}" /></div>
          <div class="modal-footer">
            <div></div>
            <div class="modal-footer-right">
              <button class="btn-close" onclick="App._recurConfirmDismiss()">Use suggestion</button>
              <button class="btn-save" onclick="App._recurConfirmSave()">Confirm</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function _recurConfirmSave() {
    if (!_recurConfirmState) return;
    const { baseNew, suggestedDate, suggestedLead, completionDateStr } = _recurConfirmState;
    const dateVal = document.getElementById('rc-date')?.value || suggestedDate;
    const leadVal = Math.max(0, +(document.getElementById('rc-lead')?.value ?? suggestedLead) || 0);
    Data.upsertTask({ ...baseNew, dueDate: dateVal, scheduledDate: '', recurrenceLeadDays: leadVal, recurrenceLastCompletedAt: completionDateStr });
    _recurConfirmState = null;
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  // Dismissing (backdrop click or "Use suggestion") still creates the occurrence with
  // the pre-filled defaults — a recurring series should never be silently dropped.
  function _recurConfirmDismiss() {
    if (!_recurConfirmState) return;
    const { baseNew, suggestedDate, suggestedLead, completionDateStr } = _recurConfirmState;
    Data.upsertTask({ ...baseNew, dueDate: suggestedDate, scheduledDate: '', recurrenceLeadDays: suggestedLead, recurrenceLastCompletedAt: completionDateStr });
    _recurConfirmState = null;
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  // At local midnight, re-render so Today starts as a fresh page (no rollover job —
  // yesterday's items simply stop matching Data.todayList()). Re-schedules itself.
  function _scheduleMidnight() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    setTimeout(() => { renderBoard(); _scheduleMidnight(); }, midnight - now);
  }

  // ── Init ── (called only by auth.js)
  async function init() {
    _initialized = true;
    await Data.load();   // async: fetches from Supabase
    _renderFocusRow();
    _startClock();
    _scheduleMidnight();
    renderBoard();
    window.addEventListener('resize', _onResize);
    document.addEventListener('visibilitychange', () => {
      // Tab came back into view — re-sync the timer from the wall clock so time that
      // passed while the browser throttled setInterval is applied at once.
      if (document.visibilityState === 'visible' && timerRunning) _timerTick();
    });
  }

  // ── Render ──
  function renderBoard() {
    if (_isMobile()) { _renderPhone(); return; }
    _renderOL();
  }
  function _isMobile() { return window.matchMedia('(max-width: 640px)').matches; }
  let _resizeTimer = null;
  function _onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => renderBoard(), 150);
  }

  // Deterministic 32-bit string hash (FNV-1a) — stable jitter/delays per id in Everything.
  function _hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // recurrenceLeadDays is the "start flagging as due-soon N days ahead" window —
  // settable for both types now (was anchored-only); rolling defaults to 1 day
  // when unset so "due soon" isn't invisible on tasks that never had it configured.
  function _recurDueState(item) {
    const dateStr = item.recurrence === 'anchored' ? item.dueDate : item.scheduledDate;
    if (!dateStr) return { state: 'muted', daysUntil: null, dateStr: null };
    const daysUntil = -_daysDiff(dateStr);
    const lead = item.recurrenceLeadDays ?? (item.recurrence === 'rolling' ? 1 : 0);
    let state = 'muted';
    if (daysUntil < 0) state = 'overdue';
    else if (daysUntil <= lead) state = 'due-soon';
    return { state, daysUntil, dateStr };
  }

  // Every live recurring task currently due-soon or overdue, most urgent first —
  // feeds the Tasks-board due banner (see _renderRecurDueBanner).
  function _recurDueList() {
    return Data.get().tasks
      .filter(i => i.status === 'recurring')
      .map(item => ({ item, ...(_recurDueState(item)) }))
      .filter(d => d.state !== 'muted')
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }

  // Completes a recurring task's current occurrence as of dateStr — archives it
  // directly (never touches Focus/status:'done') and spawns the next occurrence
  // from that same date, so backdating a forgotten completion also backdates the
  // next-due math instead of computing it from today.
  function _completeRecurring(id, dateStr) {
    const item = Data.findItem(id);
    if (!item || item.status !== 'recurring') return;
    _maybeSpawnRecurrence(item, dateStr);
    Data.logEvent(id, 'done');
    Data.archiveItemWithDate(id, dateStr);
    renderBoard();
  }

  function completeRecurringToday(id) { _completeRecurring(id, _today()); }

  // "Log a different date" — for when a completion was forgotten and needs
  // backdating. Small non-blocking overlay, same pattern as _openRecurConfirm.
  let _recurLogDateId = null;
  function openRecurLogDate(id) {
    const item = Data.findItem(id); if (!item) return;
    _recurLogDateId = id;
    document.getElementById('modal-root').innerHTML = `
      <div class="rc-overlay" onclick="App._closeRecurLogDate()">
        <div class="rc-modal" onclick="event.stopPropagation()">
          <div class="rc-title">Log completion</div>
          <div class="rc-sub">"${esc(item.title)}" — mark it done as of a specific date, for when you forgot to log it at the time.</div>
          <div class="fg"><label class="modal-label">Completed on</label>
            <input type="date" class="modal-input" id="rld-date" max="${_today()}" value="${_today()}" /></div>
          <div class="modal-footer">
            <div></div>
            <div class="modal-footer-right">
              <button class="btn-close" onclick="App._closeRecurLogDate()">Cancel</button>
              <button class="btn-save" onclick="App._confirmRecurLogDate()">Complete</button>
            </div>
          </div>
        </div>
      </div>`;
  }
  function _closeRecurLogDate() {
    _recurLogDateId = null;
    document.getElementById('modal-root').innerHTML = '';
  }
  function _confirmRecurLogDate() {
    if (!_recurLogDateId) return;
    const dateVal = document.getElementById('rld-date')?.value || _today();
    const id = _recurLogDateId;
    _recurLogDateId = null;
    document.getElementById('modal-root').innerHTML = '';
    _completeRecurring(id, dateVal);
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

    const task = _focusId ? Data.findItem(_focusId) || null : null;

    if (!task && _focusHandoff) { _renderFocusHandoff(fz, meta, controls, orbEl, glowEl); return; }
    fz.classList.remove('handoff');

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
    // Layout reads spatially: Back to Today (backward) left · main action middle · Done (forward) right.
    const backBtn = `<button class="oc-btn" onclick="App.removeFromDoing('${task.id}')">Back to Today</button>`;
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

  // Ends the timer for `id` and returns this session's work minutes (also accrued
  // onto item.timeSpent, which carries into the archive).
  function _endFocusSession(item) {
    let mins = 0;
    if (timerTask && timerTask.id === item.id) {
      mins = timerTask._workElapsed || 0;
      item.timeSpent = (item.timeSpent || 0) + mins;
      clearInterval(timerInterval);
      clearInterval(timerElapsedInterval);
      _stopBoundaryFlash();
      timerTask = null;
      timerRunning = false;
      timerAtBoundary = false;
      timerSecsRemaining = 0;
    }
    return mins;
  }

  // "Back to Today" — leave Focus; the task stays on Today. Work minutes go onto the
  // session's `started` event (so the Log can count them per day) and timeSpent.
  function removeFromDoing(id) {
    const item = Data.findItem(id);
    _focusHandoff = null;
    if (item) {
      const mins = _endFocusSession(item);
      Data.upsertTask(item);
      if (mins && _focusStartEventId) Data.setEventMinutes(_focusStartEventId, mins);
    }
    _focusId = null; _focusStartEventId = null;
    _renderFocusRow();
    renderBoard();
  }

  // Done in Focus — complete (archive; recurring spawns its next occurrence), log `done`
  // with this session's work minutes, then show the "up next on Today" card.
  function markDoingDone(id) {
    const item = Data.findItem(id);
    if (!item) return;
    const mins = _endFocusSession(item);
    Data.upsertTask(item);
    if (item.status === 'recurring') {
      _maybeSpawnRecurrence(item, Data.localToday());
      Data.logEvent(id, 'done', mins || null);
      Data.archiveItemWithDate(id, Data.localToday());
    } else {
      Data.completeTask(id, { minutes: mins });
    }
    _focusId = null; _focusStartEventId = null;
    _focusHandoff = { doneTitle: item.title, minutes: mins };
    _renderFocusRow();
    renderBoard();
  }

  // Post-Done card: the next Today item with a one-tap start, or "back to Today".
  function _renderFocusHandoff(fz, meta, controls, orbEl, glowEl) {
    if (_pipWin) closeFocusPip();
    fz.style.display = 'flex';
    requestAnimationFrame(() => fz.classList.add('active'));
    fz.classList.remove('break');
    fz.classList.add('handoff');
    if (orbEl)  orbEl.className  = 'orb work paused';
    if (glowEl) glowEl.className = 'orb-glow work paused';
    const next = Data.todayList()[0] || null;
    const h = _focusHandoff;
    meta.innerHTML = `
      <p class="fmeta-label">Done</p>
      <p class="fmeta-title">✓ ${esc(h.doneTitle)}</p>
      <p class="fmeta-sub">${h.minutes ? `${h.minutes}m focused` : 'nice.'}</p>`;
    const why = next ? _olMeta(next) : '';
    controls.innerHTML = `
      <div class="focus-upnext">
        ${next ? `<span class="fu-label">Up next on Today</span>
          <span class="fu-title">${esc(next.title)}</span>
          ${why ? `<span class="fu-why">${esc(why)}</span>` : ''}
          <button class="oc-btn primary" onclick="App.startTask('${next.id}')">Start ›</button>`
        : `<span class="fu-label">Today's list is clear</span>`}
      </div>
      <div class="orb-controls">
        <button class="oc-btn" onclick="App.focusBackToToday()">Back to Today</button>
      </div>`;
    const clock = document.getElementById('focus-clock-time'); if (clock) clock.remove();
  }

  function focusBackToToday() {
    _focusHandoff = null;
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

  // Open Focus on a task (Today item 1's "start", or the up-next card). Any task
  // already in Focus is ended as "Back to Today" first, keeping its minutes.
  function startTask(id) {
    const item = Data.findItem(id);
    if (!item || item.type === 'project') return;
    _focusHandoff = null;
    if (_focusId && _focusId !== id) {
      const prev = Data.findItem(_focusId);
      if (prev) {
        const mins = _endFocusSession(prev);
        Data.upsertTask(prev);
        if (mins && _focusStartEventId) Data.setEventMinutes(_focusStartEventId, mins);
      }
    }
    if (_focusId !== id) {
      _focusId = id;
      _focusStartEventId = Data.logEvent(id, 'started').id;
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

  // ── Recurring modal shared bits ──
  const _RECUR_DOW = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

  // Past occurrences of a recurring series, shown in the dedicated Recurring modal.
  function _recurHistoryHtml(item) {
    if (!item.recurrenceSeriesId) return '';
    const past = (Data.get().archive || [])
      .filter(a => a.recurrenceSeriesId === item.recurrenceSeriesId && a.id !== item.id)
      .sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
    if (!past.length) return '';
    return `<div class="modal-section">
      <label class="modal-label">Past occurrences</label>
      <div class="recur-history">
        ${past.slice(0, 12).map(a => `<div class="recur-history-row">
          <span class="recur-history-date">${_fmtDate(a.archivedAt)}</span>
          ${a.timeSpent ? `<span class="recur-history-time">${a.timeSpent}m</span>` : ''}
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ── Recurring task modal (edit; create path kept but unused — recurring tasks are
  // created from the entry bar with `every …`). Opened from the inline detail
  // popover's "edit recurrence…". Tags are retired; area is edited in the popover.
  let _recurModalType = 'rolling'; // 'rolling' | 'anchored' — current toggle state

  function openRecurringModal(id) {
    const item = id ? Data.findItem(id) : null;
    _recurModalType = item?.recurrence === 'anchored' ? 'anchored' : 'rolling';

    const n = item?.recurrenceIntervalN || 1;
    const unit = item?.recurrenceIntervalUnit || 'days';
    const due = item?.dueDate || '';
    const lead = item?.recurrenceLeadDays ?? 0;
    const leadRolling = item?.recurrenceLeadDays ?? 1;
    const days = item?.recurrenceWeekdays || [];
    const monthDay = item?.recurrenceMonthDay || '';
    const ruleType = days.length ? 'weekly' : monthDay ? 'monthly' : '';

    // Alternating pair (rolling only) — the alternate side is a jsonb snapshot.
    const alt = item?.recurrenceAlternate || null;
    const altEnabled = !!alt;

    _showModal(`
      <div class="modal-title">${item ? 'Edit' : 'New'} Recurring Task</div>
      <div class="modal-section">
        <div class="fg"><label class="modal-label">Title</label>
          <input type="text" class="modal-input" id="rm-title" value="${esc(item?.title || '')}" placeholder="Name..." /></div>
        <div class="fg"><label class="modal-label">Type</label>
          <div class="type-toggle" id="rm-type-seg">
            <button type="button" class="type-opt${_recurModalType === 'rolling' ? ' active' : ''}" data-t="rolling" onclick="App._recurModalSetType('rolling')">Rolling</button>
            <button type="button" class="type-opt${_recurModalType === 'anchored' ? ' active' : ''}" data-t="anchored" onclick="App._recurModalSetType('anchored')">Date-anchored</button>
          </div>
        </div>
        <div id="rm-rolling" style="display:${_recurModalType === 'rolling' ? 'block' : 'none'}">
          <div class="fg">
            <span class="recur-inline-label">every</span>
            <input type="number" class="modal-input recur-num" id="rm-n" min="1" value="${n}" />
            <select class="modal-input recur-unit" id="rm-unit">
              <option value="days"${unit === 'days' ? ' selected' : ''}>days</option>
              <option value="weeks"${unit === 'weeks' ? ' selected' : ''}>weeks</option>
              <option value="months"${unit === 'months' ? ' selected' : ''}>months</option>
            </select>
            <span class="recur-inline-label">after completing</span>
          </div>
          <div class="fg"><label class="modal-label">Flag as due-soon</label>
            <input type="number" class="modal-input recur-num" id="rm-lead-rolling" min="0" value="${leadRolling}" />
            <span class="recur-inline-label">days before the expected date</span>
          </div>
          <label class="rm-alt-toggle">
            <input type="checkbox" id="rm-alt-enabled" ${altEnabled ? 'checked' : ''} onchange="App._recurModalToggleAlt(this)" />
            Alternate with a second task
          </label>
          <div id="rm-alt-block" style="display:${altEnabled ? 'block' : 'none'}">
            <div class="fg"><label class="modal-label">Alternate title</label>
              <input type="text" class="modal-input" id="rm-alt-title" value="${esc(alt?.title || '')}" placeholder="Name..." /></div>
            <div class="fg"><label class="modal-label">Alternate notes</label>
              <textarea class="modal-input" id="rm-alt-notes">${esc(alt?.notes || '')}</textarea></div>
          </div>
        </div>
        <div id="rm-anchored" style="display:${_recurModalType === 'anchored' ? 'block' : 'none'}">
          <div class="field-row">
            <div class="fg"><label class="modal-label">Due date</label>
              <input type="date" class="modal-input" id="rm-due" value="${due}" /></div>
            <div class="fg"><label class="modal-label">Lead days</label>
              <input type="number" class="modal-input" id="rm-lead" min="0" value="${lead}" /></div>
          </div>
          <div class="rm-rule-toggle" onclick="App._recurModalToggleRule()">
            <span id="rm-rule-caret">${ruleType ? '▾' : '▸'}</span> Default repeat rule <span class="modal-label-hint">suggestion only, not enforced</span>
          </div>
          <div id="rm-rule-block" style="display:${ruleType ? 'block' : 'none'}">
            <select class="modal-input" id="rm-rule-type" onchange="App._recurModalRuleTypeChange(this)">
              <option value=""${ruleType === '' ? ' selected' : ''}>None</option>
              <option value="weekly"${ruleType === 'weekly' ? ' selected' : ''}>Weekly</option>
              <option value="monthly"${ruleType === 'monthly' ? ' selected' : ''}>Monthly</option>
            </select>
            <div id="rm-rule-weekly" class="recur-sub" style="display:${ruleType === 'weekly' ? 'flex' : 'none'}">
              ${_RECUR_DOW.map((d, i) => `<button type="button" class="recur-day-btn${days.includes(i) ? ' active' : ''}" data-d="${i}" onclick="this.classList.toggle('active')">${d[0]}</button>`).join('')}
            </div>
            <div id="rm-rule-monthly" class="recur-sub" style="display:${ruleType === 'monthly' ? 'flex' : 'none'}">
              <span class="recur-inline-label">on day</span>
              <input type="number" class="modal-input recur-num" id="rm-rule-monthday" min="1" max="31" value="${monthDay || 1}" />
              <span class="recur-inline-label">of the month</span>
            </div>
          </div>
        </div>
        <div class="fg"><label class="modal-label">Notes</label>
          <textarea class="modal-input" id="rm-notes">${esc(item?.notes || '')}</textarea></div>
      </div>
      ${item ? _recurHistoryHtml(item) : ''}
      <div class="modal-footer">
        <div id="del-zone">${item ? `<button class="btn-danger" onclick="App._showDelConfirm('${id}')">Delete</button>` : ''}</div>
        <div class="modal-footer-right">
          <button class="btn-close" onclick="App._closeRecurModal()">Cancel</button>
          ${item ? `<button class="btn-close" onclick="App.openRecurLogDate('${id}')">Mark complete…</button>` : ''}
          <button class="btn-save" onclick="App._saveRecurModal('${id || ''}')">${item ? 'Save' : 'Add'}</button>
        </div>
      </div>`, null);
    setTimeout(() => document.getElementById('rm-title')?.focus(), 50);
  }

  function _recurModalSetType(t) {
    _recurModalType = t;
    document.querySelectorAll('#rm-type-seg .type-opt').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    document.getElementById('rm-rolling').style.display = t === 'rolling' ? 'block' : 'none';
    document.getElementById('rm-anchored').style.display = t === 'anchored' ? 'block' : 'none';
  }

  function _recurModalToggleAlt(cb) {
    const block = document.getElementById('rm-alt-block');
    if (block) block.style.display = cb.checked ? 'block' : 'none';
  }

  function _recurModalToggleRule() {
    const block = document.getElementById('rm-rule-block');
    const caret = document.getElementById('rm-rule-caret');
    const open = block.style.display !== 'none';
    block.style.display = open ? 'none' : 'block';
    if (caret) caret.textContent = open ? '▸' : '▾';
  }

  function _recurModalRuleTypeChange(sel) {
    const type = sel.value;
    document.getElementById('rm-rule-weekly').style.display = type === 'weekly' ? 'flex' : 'none';
    document.getElementById('rm-rule-monthly').style.display = type === 'monthly' ? 'flex' : 'none';
  }

  function _closeRecurModal() {
    openItemId = null;
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  function _saveRecurModal(id) {
    const title = document.getElementById('rm-title')?.value.trim(); if (!title) return;
    const notes = document.getElementById('rm-notes')?.value || '';
    const isAnchored = _recurModalType === 'anchored';
    let fields;
    if (isAnchored) {
      const due  = document.getElementById('rm-due')?.value || '';
      const lead = Math.max(0, +(document.getElementById('rm-lead')?.value || 0));
      const ruleType = document.getElementById('rm-rule-type')?.value || '';
      const ruleDays = ruleType === 'weekly'
        ? [...document.querySelectorAll('#rm-rule-weekly .recur-day-btn.active')].map(b => +b.dataset.d) : null;
      const ruleMonthDay = ruleType === 'monthly'
        ? Math.min(31, Math.max(1, +(document.getElementById('rm-rule-monthday')?.value || 1))) : null;
      fields = {
        recurrence: 'anchored', dueDate: due, scheduledDate: '', recurrenceLeadDays: lead,
        recurrenceWeekdays: ruleDays, recurrenceMonthDay: ruleMonthDay,
        recurrenceIntervalN: null, recurrenceIntervalUnit: null,
        recurrenceAlternate: null, // alternating pairs are rolling-only
      };
    } else {
      const n = Math.max(1, +(document.getElementById('rm-n')?.value || 1));
      const unit = document.getElementById('rm-unit')?.value || 'days';
      const leadRolling = Math.max(0, +(document.getElementById('rm-lead-rolling')?.value ?? 1) || 0);
      // Alternate side is a jsonb snapshot, not a live task — saving updates only this
      // stored side; the primary title/tags/notes above are read and applied separately
      // (as the live task's own fields), untouched by whatever's in the alternate form.
      const altEnabled = document.getElementById('rm-alt-enabled')?.checked;
      let recurrenceAlternate = null;
      if (altEnabled) {
        const altTitle = document.getElementById('rm-alt-title')?.value.trim();
        if (altTitle) {
          recurrenceAlternate = {
            title: altTitle,
            notes: document.getElementById('rm-alt-notes')?.value || '',
            tags: [],
          };
        }
      }
      fields = {
        recurrence: 'rolling', dueDate: '', recurrenceLeadDays: leadRolling,
        recurrenceIntervalN: n, recurrenceIntervalUnit: unit,
        recurrenceWeekdays: null, recurrenceMonthDay: null,
        recurrenceAlternate,
      };
    }

    if (id) {
      const item = Data.findItem(id); if (!item) return;
      item.title = title; item.notes = notes;
      Object.assign(item, fields);
      if (!item.recurrenceSeriesId) item.recurrenceSeriesId = item.id;
      Data.upsertTask(item);
    } else {
      const newId = 't' + Date.now();
      Data.upsertTask({
        id: newId, type: 'standalone', title, status: 'recurring', tags: [], parentProject: null,
        notes, dateAdded: _today(), backlogEnteredAt: '', laterCount: 0, blocked: false,
        scheduledTime: '', recurrenceSeriesId: newId, ...fields,
      });
    }
    openItemId = null;
    document.getElementById('modal-root').innerHTML = '';
    renderBoard();
  }

  // ═══ Phone stopgap (Prompt 8) — deliberately bare; full phone design is future work ═══
  // Numbered Today (tap circle or swipe right to complete, with undo), due recurring
  // tasks, and a one-line capture pinned at the bottom with tap chips
  // (asap / date… / no rush | areas). No Everything, Log or Focus on the phone.
  const _ph = { when: null, dueDate: '', area: null };
  let _phSwipe = null;
  let _phUndo = null;

  function _renderPhone() {
    const root = document.getElementById('mobile-app');
    if (!root) return;
    if (!root.querySelector('.ph-capture')) {
      root.innerHTML = `
        <header class="ph-head">
          <span class="ph-date"></span>
          <button class="ph-signout" onclick="Auth.handleLogout()" aria-label="Sign out">sign out</button>
        </header>
        <div class="ph-scroll" id="ph-scroll"></div>
        <form class="ph-capture" onsubmit="event.preventDefault();App._phSave()">
          <div class="ph-cap-line">
            <label class="ol-sr" for="ph-input">Capture a task</label>
            <input id="ph-input" class="ph-input" placeholder="capture…" autocomplete="off" enterkeyhint="done" />
            <button type="submit" class="ph-save">save</button>
          </div>
          <div class="ph-chips" id="ph-chips"></div>
          <input type="date" id="ph-date-pick" class="ph-date-pick" tabindex="-1" aria-hidden="true" onchange="App._phPickDate(this.value)" />
        </form>`;
    }
    root.querySelector('.ph-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    _phRenderChips();
    const today = Data.todayList();
    const onToday = new Set(today.map(t => t.id));
    const due = _recurDueList().filter(d => !onToday.has(d.item.id));
    const row = (t, label, isRec) => `
      <li class="ph-row" data-id="${t.id}"
        ontouchstart="App._phTouchStart(event,'${t.id}')" ontouchmove="App._phTouchMove(event)" ontouchend="App._phTouchEnd(event)">
        <span class="ph-num${isRec ? ' rec' : ''}">${label}</span>
        <div class="ph-body"><div class="ph-title">${esc(t.title)}</div>${_olMeta(t) ? `<div class="ph-meta${isRec ? ' hot' : ''}">${esc(_olMeta(t))}</div>` : ''}</div>
        <button class="ph-done" onclick="App._phDone('${t.id}')" aria-label="Done: ${esc(t.title)}"></button>
      </li>`;
    document.getElementById('ph-scroll').innerHTML = `
      ${today.length ? `<ol class="ph-list">${today.map((t, i) => row(t, i + 1, false)).join('')}</ol>`
        : `<p class="ph-empty">Nothing on Today. Pick on your computer, or capture below.</p>`}
      ${due.length ? `<ol class="ph-list ph-due">${due.map(d => row(d.item, '↻', true)).join('')}</ol>` : ''}`;
  }

  function _phRenderChips() {
    const el = document.getElementById('ph-chips'); if (!el) return;
    const c = (label, on, call) => `<button type="button" class="ph-chip${on ? ' on' : ''}" onclick="${call}">${esc(label)}</button>`;
    el.innerHTML =
      c('asap', _ph.when === 'asap', "App._phWhen('asap')") +
      c(_ph.when === 'date' && _ph.dueDate ? 'by ' + _fmtDate(_ph.dueDate) : 'date…', _ph.when === 'date', "App._phWhen('date')") +
      c('no rush', _ph.when === 'norush', "App._phWhen('norush')") +
      '<span class="ph-sep" aria-hidden="true"></span>' +
      Data.AREAS.map(a => c(a, _ph.area === a, `App._phArea('${a}')`)).join('');
  }
  function _phWhen(w) {
    if (w === 'date') {
      const pick = document.getElementById('ph-date-pick');
      if (_ph.when === 'date') { _ph.when = null; _ph.dueDate = ''; _phRenderChips(); return; }
      try { pick.showPicker(); } catch (e) { pick.focus(); pick.click(); }
      return;
    }
    _ph.when = _ph.when === w ? null : w; _ph.dueDate = '';
    _phRenderChips();
  }
  function _phPickDate(v) { if (v) { _ph.when = 'date'; _ph.dueDate = v; } _phRenderChips(); }
  function _phArea(a) { _ph.area = _ph.area === a ? null : a; _phRenderChips(); }

  function _phSave() {
    const inp = document.getElementById('ph-input');
    const raw = (inp.value || '').trim(); if (!raw) return;
    const pt = GFParse.parseTitle(raw, Data.localToday());
    const w = pt.when || {};
    Data.addTask({
      title: pt.title, isIdea: pt.isIdea, source: 'phone',
      area: _ph.area || pt.area,
      urgency: _ph.when === 'asap' ? 'asap' : _ph.when === 'norush' ? 'norush' : (w.urgency || null),
      dueDate: _ph.when === 'date' ? _ph.dueDate : (w.dueDate || ''),
      recur: w.recur || null,
    });
    inp.value = ''; _ph.when = null; _ph.dueDate = ''; _ph.area = null;
    _renderPhone();
    _phToast('Saved — it\'s in Offered on your computer');
    inp.focus();
  }

  function _phDone(id) {
    const t = Data.findItem(id); if (!t) return;
    const li = document.querySelector(`.ph-row[data-id="${id}"]`);
    const go = () => {
      if (t.status === 'recurring') { _completeRecurring(id, Data.localToday()); _phToast('Done'); return; }
      const snap = JSON.parse(JSON.stringify(t));
      Data.completeTask(id);
      renderBoard();
      _phToast('Done', () => { Data.deleteFromArchive(id); Data.upsertTask(snap); renderBoard(); });
    };
    if (li && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { li.classList.add('leaving'); setTimeout(go, 180); } else go();
  }

  function _phToast(msg, undo) {
    document.querySelector('.ph-toast')?.remove();
    clearTimeout(_phUndo);
    const el = document.createElement('div');
    el.className = 'ph-toast'; el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
    if (undo) el.querySelector('button').onclick = () => { el.remove(); clearTimeout(_phUndo); undo(); };
    document.body.appendChild(el);
    _phUndo = setTimeout(() => el.remove(), undo ? 4000 : 1800);
  }

  // Swipe right ≥ 35% of the row to complete; vertical movement hands back to scrolling.
  function _phTouchStart(e, id) {
    const t = e.touches[0];
    _phSwipe = { id, x: t.clientX, y: t.clientY, dx: 0, decided: false, el: e.currentTarget };
  }
  function _phTouchMove(e) {
    if (!_phSwipe) return;
    const t = e.touches[0];
    const dx = t.clientX - _phSwipe.x, dy = t.clientY - _phSwipe.y;
    if (!_phSwipe.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { _phSwipe = null; return; }
      _phSwipe.decided = true;
    }
    e.preventDefault();
    _phSwipe.dx = Math.max(0, dx);
    _phSwipe.el.style.transform = `translateX(${_phSwipe.dx}px)`;
    _phSwipe.el.classList.toggle('arming', _phSwipe.dx > _phSwipe.el.offsetWidth * 0.35);
  }
  function _phTouchEnd() {
    const s = _phSwipe; _phSwipe = null;
    if (!s || !s.decided) return;
    if (s.dx > s.el.offsetWidth * 0.35) _phDone(s.id);
    else { s.el.style.transform = ''; s.el.classList.remove('arming'); }
  }

  // ═══════════════════════════════════════════════════════════
  // ONE LIST (2026-11-25) — Today home, Offered ranking, entry bar.
  // See ONE-LIST-BRIEF.md + .claude/rules/one-list.md.
  // ═══════════════════════════════════════════════════════════

  let olView = 'today';            // 'today' | 'everything' | 'log'
  let _offerHiddenDate = null;     // "I'm set ✓" — hidden for the rest of that day only
  let _offerShowAll = false;       // "+ n more" expands past OFFER_LIMIT
  let _olDragId = null;            // Today drag-reorder
  const OFFER_LIMIT = 12;

  // Ranking weights — the one place to tune the Offered order. No ML.
  const RANK_WEIGHTS = {
    asap: 50,
    overdue: 60, due2d: 40, due7d: 25, dueLater: 10,
    recentToday: 30,   // was on Today in the last 3 days and not done
    recentAdd: 15,     // added in the last 3 days
    agePerWeek: 1, ageMax: 10,
    norush: -40,
  };

  function _emptyEntry() { return { step: 0, title: '', when: null, whenRaw: '', field: '' }; }
  const _entry = { today: _emptyEntry(), everything: _emptyEntry() };

  function _olFmtLongDate() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function _olDaysBetween(a, b) { // b - a in whole days, local dates
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }
  function _olDayName(ds) {
    const n = _olDaysBetween(ds, Data.localToday());
    if (n === 1) return 'yesterday';
    return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  }
  function _olAddedLabel(ds) {
    if (!ds) return '';
    const n = _olDaysBetween(ds, Data.localToday());
    if (n <= 0) return 'added today';
    if (n === 1) return 'added yesterday';
    if (n < 14) return `added ${n} days ago`;
    if (n < 60) return `added ${Math.round(n / 7)} weeks ago`;
    return `added ${Math.round(n / 30)} months ago`;
  }
  function _olRecurWhen(item) {
    const d = _recurDueState(item);
    if (d.daysUntil == null) return '↻';
    if (d.daysUntil < 0) return `↻ ${-d.daysUntil}d overdue`;
    if (d.daysUntil === 0) return '↻ due today';
    if (d.daysUntil === 1) return '↻ due tomorrow';
    return `↻ in ${d.daysUntil}d`;
  }
  function _olCadence(item) {
    if (item.recurrence === 'rolling') {
      const n = item.recurrenceIntervalN || 1, u = item.recurrenceIntervalUnit || 'days';
      return `every ${n === 1 ? '' : n + ' '}${n === 1 ? u.replace(/s$/, '') : u}`;
    }
    if (item.recurrence === 'anchored') {
      if (item.recurrenceWeekdays?.length) return 'every ' + item.recurrenceWeekdays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(' ');
      if (item.recurrenceMonthDay) return `every ${item.recurrenceMonthDay} of the month`;
      return 'date-anchored';
    }
    return '';
  }

  // Score one open task. Returns { score, why, hot } — `why` is the single strongest reason.
  function _olScore(t, today) {
    const W = RANK_WEIGHTS;
    const reasons = []; // [points, text, hot]
    if (t.urgency === 'asap') reasons.push([W.asap, 'asap', true]);
    if (t.dueDate) {
      const d = _olDaysBetween(today, t.dueDate);
      if (d < 0) reasons.push([W.overdue, `overdue · was ${_fmtDate(t.dueDate)}`, true]);
      else if (d <= 2) reasons.push([W.due2d, d === 0 ? 'due today' : `by ${_fmtDate(t.dueDate)}`, true]);
      else if (d <= 7) reasons.push([W.due7d, `by ${_fmtDate(t.dueDate)}`, false]);
      else reasons.push([W.dueLater, `by ${_fmtDate(t.dueDate)}`, false]);
    }
    if (t.todayDate && t.todayDate < today && _olDaysBetween(t.todayDate, today) <= 3) {
      reasons.push([W.recentToday, `on Today ${_olDayName(t.todayDate)}`, false]);
    }
    const age = t.dateAdded ? _olDaysBetween(t.dateAdded, today) : 0;
    if (age <= 3) reasons.push([W.recentAdd, _olAddedLabel(t.dateAdded), false]);
    let score = reasons.reduce((s, r) => s + r[0], 0);
    score += Math.min(W.ageMax, Math.floor(age / 7) * W.agePerWeek);
    if (t.urgency === 'norush') score += W.norush;
    const best = reasons.sort((a, b) => b[0] - a[0])[0];
    const why = best ? best[1] : t.urgency === 'norush' ? 'no rush' : _olAddedLabel(t.dateAdded);
    return { score, why, hot: best ? best[2] : false };
  }

  // Offered = due/overdue recurring (pinned) + ranked open tasks not already on Today.
  function _olOffered() {
    const today = Data.localToday();
    const onToday = new Set(Data.todayList().map(t => t.id));
    const pinned = _recurDueList()
      .filter(d => !onToday.has(d.item.id))
      .map(d => ({ item: d.item, pinned: true, why: _olRecurWhen(d.item), hot: d.daysUntil <= 0 }));
    const ranked = Data.openTasks()
      .filter(t => !onToday.has(t.id))
      .map(t => ({ item: t, ..._olScore(t, today) }))
      .sort((a, b) => b.score - a.score || (a.item.dateAdded || '').localeCompare(b.item.dateAdded || '') || a.item.id.localeCompare(b.item.id));
    return { pinned, ranked };
  }

  // Log an `offered` event once per task per day (for later ranking tuning).
  function _olLogOffered(items) {
    const today = Data.localToday();
    const seen = new Set(Data.events()
      .filter(e => e.event === 'offered' && Data.localToday(new Date(e.at)) === today)
      .map(e => e.taskId));
    items.forEach(o => { if (!seen.has(o.item.id)) Data.logEvent(o.item.id, 'offered'); });
  }

  // Short meta line for a task row: area · reason.
  function _olMeta(t) {
    const parts = [];
    if (t.area) parts.push(t.area);
    if (t.status === 'recurring') parts.push(_olRecurWhen(t));
    else {
      if (t.urgency === 'asap') parts.push('asap');
      if (t.dueDate) parts.push(t.dueDate < Data.localToday() ? `overdue · was ${_fmtDate(t.dueDate)}` : `by ${_fmtDate(t.dueDate)}`);
      if (t.urgency === 'norush') parts.push('no rush');
    }
    return parts.join(' · ');
  }

  // ── Shell ──
  function _renderOL() {
    const root = document.getElementById('ol-view');
    if (!root) return;
    document.body.dataset.olView = olView;
    if (olView === 'everything') { root.innerHTML = _renderEverything(); _afterEverythingRender(); return; }
    if (olView === 'log') { root.innerHTML = _renderLog(); return; }
    root.innerHTML = _renderTodayView();
    _renderTodayList();
    _renderOffered();
    _entrySync('today');
    const inp = document.getElementById('ol-input-today');
    if (inp && !document.getElementById('modal-root').innerHTML && document.activeElement?.tagName !== 'INPUT') inp.focus({ preventScroll: true });
  }

  function olGo(v) {
    const from = olView;
    olCloseDetail();
    if (v === 'everything' && from !== 'everything') _evZoomed = false; // zoom out on entry
    olView = v;
    renderBoard();
    window.scrollTo(0, 0);
    if (v === 'today' && from === 'everything') {
      const w = document.querySelector('.ol-today-wrap');
      if (w) { w.classList.add('ol-zoom-in'); setTimeout(() => w.classList.remove('ol-zoom-in'), 700); }
    }
  }

  const _OL_ZOOM_ICON = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"></circle><path d="M8 11h6M21 21l-5-5"></path></svg>`;
  const _OL_SIGNOUT_ICON = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

  function _renderTodayView() {
    return `
      <header class="ol-header">
        <span class="ol-date">${_olFmtLongDate()}</span>
        <nav class="ol-nav" aria-label="Views">
          <button class="ol-navbtn" onclick="App.olGo('everything')">${_OL_ZOOM_ICON}zoom out</button>
          <button class="ol-navbtn" onclick="App.olGo('log')">log</button>
          <button class="ol-navbtn ol-signout" onclick="Auth.handleLogout()" title="Sign out" aria-label="Sign out">${_OL_SIGNOUT_ICON}</button>
        </nav>
      </header>
      <div class="ol-today-wrap">
        <main class="ol-today-main">
          ${_entryBarHtml('today')}
          <div id="ol-today-list"></div>
        </main>
        <div id="ol-offered" class="ol-offered-col"></div>
      </div>`;
  }

  // ── Today list ──
  function _renderTodayList() {
    const el = document.getElementById('ol-today-list');
    if (!el) return;
    const list = Data.todayList();
    if (!list.length) {
      el.innerHTML = `<p class="ol-empty">Nothing yet. Pick from the right, or just start typing.</p>`;
      return;
    }
    el.innerHTML = `<ol class="ol-today" ondragover="App._olListDragOver(event)" ondrop="App._olDrop(event)">${list.map((t, i) => `
      <li class="ol-li" data-id="${t.id}" draggable="true"
        ondragstart="App._olDragStart(event,'${t.id}')" ondragend="App._olDragEnd()">
        ${i === 10 ? '<div class="ol-ten-line" aria-hidden="true"></div>' : ''}
        <div class="ol-row${i >= 10 ? ' past-ten' : ''}">
          <span class="ol-num">${i + 1}</span>
          <div class="ol-row-body">
            <div class="ol-row-title" onclick="App.olOpenDetail('${t.id}')">${esc(t.title)}</div>
            ${_olMeta(t) ? `<div class="ol-row-meta">${esc(_olMeta(t))}</div>` : ''}
          </div>
          <button class="ol-hv ol-notoday" onclick="App.olSendBack('${t.id}')">not today →</button>
          ${i === 0 ? `<button class="ol-start" onclick="App.olStart('${t.id}')"><span class="ol-start-dot" aria-hidden="true"></span>start</button>` : ''}
          <button class="ol-hv ol-done" aria-label="Mark done" title="Done" onclick="App.olDone('${t.id}')"></button>
        </div>
      </li>`).join('')}</ol>
      ${list.length > 1 ? '<p class="ol-drag-hint">drag to reorder</p>' : ''}`;
  }

  function _olLeave(id, then) {
    const li = document.querySelector(`.ol-li[data-id="${id}"], .ol-off-row[data-id="${id}"]`);
    if (li && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      li.classList.add('ol-leaving');
      setTimeout(then, 200);
    } else then();
  }

  function olDone(id) {
    const t = Data.findItem(id); if (!t) return;
    _olLeave(id, () => {
      if (t.status === 'recurring') _completeRecurring(id, Data.localToday());
      else Data.completeTask(id);
      renderBoard();
    });
  }
  function olSendBack(id) { _olLeave(id, () => { Data.sendBack(id); renderBoard(); }); }
  function olPull(id) { _olLeave(id, () => { Data.pullToToday(id); renderBoard(); }); }
  function olStart(id) { startTask(id); }

  // Drag-reorder within Today
  function _olDragStart(e, id) {
    _olDragId = id;
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch (err) {}
    setTimeout(() => document.querySelector(`.ol-li[data-id="${id}"]`)?.classList.add('dragging'), 0);
  }
  function _olDragEnd() {
    _olDragId = null;
    document.querySelectorAll('.ol-li').forEach(li => li.classList.remove('dragging', 'drop-above', 'drop-below'));
  }
  function _olDropTarget(e) {
    const lis = [...document.querySelectorAll('.ol-li:not(.dragging)')];
    for (const li of lis) {
      const r = li.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return { li, before: true };
    }
    return lis.length ? { li: lis[lis.length - 1], before: false } : null;
  }
  function _olListDragOver(e) {
    if (!_olDragId) return;
    e.preventDefault();
    document.querySelectorAll('.ol-li').forEach(li => li.classList.remove('drop-above', 'drop-below'));
    const tgt = _olDropTarget(e);
    if (tgt) tgt.li.classList.add(tgt.before ? 'drop-above' : 'drop-below');
  }
  function _olDrop(e) {
    if (!_olDragId) return;
    e.preventDefault();
    const tgt = _olDropTarget(e);
    const ids = Data.todayList().map(t => t.id).filter(x => x !== _olDragId);
    if (tgt) {
      let idx = ids.indexOf(tgt.li.dataset.id);
      if (!tgt.before) idx += 1;
      ids.splice(idx, 0, _olDragId);
    } else ids.push(_olDragId);
    Data.reorderToday(ids);
    _olDragEnd();
    _renderTodayList();
  }

  // ── Offered column ──
  function _renderOffered() {
    const el = document.getElementById('ol-offered');
    if (!el) return;
    const { pinned, ranked } = _olOffered();
    const total = pinned.length + ranked.length;
    if (_offerHiddenDate === Data.localToday()) {
      el.innerHTML = `<button class="ol-show-off" onclick="App.olShowOffer()">+ show offered (${total})</button>`;
      return;
    }
    const shown = _offerShowAll ? ranked : ranked.slice(0, Math.max(0, OFFER_LIMIT - pinned.length));
    const more = ranked.length - shown.length;
    _olLogOffered([...pinned, ...shown]);
    const row = (o) => {
      const t = o.item;
      const why = [t.area, o.why].filter(Boolean).join(' · ');
      return `<div class="ol-off-row" data-id="${t.id}">
        <button class="ol-add" onclick="App.olPull('${t.id}')" aria-label="Add to Today" title="Add to Today">+</button>
        <div class="ol-off-body">
          <div class="ol-off-title" onclick="App.olOpenDetail('${t.id}')">${esc(t.title)}</div>
          <div class="ol-off-why${o.hot ? ' hot' : ''}">${esc(why)}</div>
        </div>
        ${o.pinned ? `<button class="ol-off-check" onclick="App.olDone('${t.id}')" aria-label="Done — complete this occurrence" title="Done">✓</button>` : ''}
      </div>`;
    };
    el.innerHTML = `
      <aside class="ol-offered" aria-labelledby="ol-off-h">
        <div class="ol-off-head">
          <h2 id="ol-off-h">Offered</h2>
          <button class="ol-set" onclick="App.olHideOffer()">I'm set ✓</button>
        </div>
        ${total ? [...pinned, ...shown].map(row).join('') : `<p class="ol-off-empty">Nothing waiting. Anything you add lands here.</p>`}
        ${more > 0 ? `<button class="ol-more" onclick="App.olOfferAll(true)">+ ${more} more</button>` : ''}
        ${_offerShowAll && ranked.length > OFFER_LIMIT ? `<button class="ol-more" onclick="App.olOfferAll(false)">show fewer</button>` : ''}
      </aside>`;
  }
  function olHideOffer() { _offerHiddenDate = Data.localToday(); _renderOffered(); }
  function olShowOffer() { _offerHiddenDate = null; _renderOffered(); }
  function olOfferAll(v) { _offerShowAll = !!v; _renderOffered(); }

  // Re-render whatever lists the current view shows (not the entry bar — keeps focus).
  function _olRefreshLists() {
    if (olView === 'today') { _renderTodayList(); _renderOffered(); }
    else if (olView === 'everything') _refreshEverything();
  }

  // ── Entry bar (shared by Today + Everything) ──
  // title → Tab → priority/date → Tab → area. Enter saves at any step (→ Offered /
  // Everything); Shift+Enter → straight onto Today. Backspace on an empty field steps
  // back; Esc clears. Parsing lives in parse.js (GFParse).
  const _OL_WHEN_HINTS = ['asap', 'fri', 'dec 4', 'no rush', 'every 2w'];

  function _entryBarHtml(ctx) {
    return `<div class="ol-entry ol-entry-${ctx}" id="ol-entry-${ctx}">
      <div class="ol-entry-line">
        <span class="ol-tok ol-tok-title" hidden></span>
        <span class="ol-tok ol-tok-when" hidden></span>
        <label class="ol-sr" for="ol-input-${ctx}">Add a task</label>
        <input id="ol-input-${ctx}" class="ol-input" autocomplete="off" spellcheck="false"
          onkeydown="App._olKey(event,'${ctx}')" oninput="App._olInput(event,'${ctx}')" />
      </div>
      <div class="ol-entry-sub">
        <span class="ol-hints"></span>
        <span class="ol-keyhint"></span>
      </div>
      <div class="ol-dup" hidden></div>
    </div>`;
  }

  function _entrySync(ctx) {
    const S = _entry[ctx];
    const box = document.getElementById('ol-entry-' + ctx);
    if (!box) return;
    const inp = box.querySelector('.ol-input');
    if (inp.value !== S.field) inp.value = S.field;
    box.classList.toggle('stepped', S.step > 0);
    const tTok = box.querySelector('.ol-tok-title'), wTok = box.querySelector('.ol-tok-when');
    tTok.hidden = S.step === 0; tTok.textContent = S.title;
    wTok.hidden = !(S.step === 2 && S.when); wTok.textContent = S.when ? S.when.label : '';
    const today = Data.localToday();
    inp.placeholder = S.step === 0 ? (ctx === 'today' ? "what's on your mind…" : 'add to everything…')
      : S.step === 1 ? 'priority or date (optional)' : 'area (optional) · type a letter';
    const chip = (t, on, val) => `<button type="button" class="ol-chip${on ? ' on' : ''}" tabindex="-1" onmousedown="event.preventDefault()" onclick="App._olChip('${ctx}','${val}')">${esc(t)}</button>`;
    let hints = '', keyhint = '';
    if (S.step === 0) {
      const pt = S.field.trim() ? GFParse.parseTitle(S.field, today) : null;
      const bits = [];
      if (pt?.isIdea) bits.push('idea');
      if (pt?.area) bits.push(pt.area);
      if (pt?.when) bits.push(pt.when.label);
      hints = bits.map(b => `<span class="ol-chip on static">${esc(b)}</span>`).join('');
      keyhint = S.field.trim() ? 'tab → priority / date   ·   enter → save' + (ctx === 'today' ? '   ·   shift+enter → Today' : '') : '';
    } else if (S.step === 1) {
      const cur = GFParse.parseWhen(S.field, today);
      hints = _OL_WHEN_HINTS.map(h => {
        const hv = GFParse.parseWhen(h, today);
        const on = !!cur && !cur.invalid && hv && cur.label === hv.label;
        return chip(h, on, h);
      }).join('');
      if (cur && !cur.invalid && !_OL_WHEN_HINTS.some(h => GFParse.parseWhen(h, today)?.label === cur.label)) hints += `<span class="ol-chip on static">${esc(cur.label)}</span>`;
      keyhint = cur && cur.invalid ? 'try asap, no rush, fri, dec 4, every 2w' : 'tab → area   ·   enter → save';
    } else {
      const cur = GFParse.parseArea(S.field);
      hints = Data.AREAS.map(a => chip(a, cur === a, a)).join('');
      keyhint = 'enter → save' + (ctx === 'today' ? '   ·   shift+enter → straight onto Today' : '');
    }
    box.querySelector('.ol-hints').innerHTML = hints;
    const kh = box.querySelector('.ol-keyhint');
    if (!kh.dataset.flash) kh.textContent = keyhint;
    _olDupHint(ctx);
  }

  function _olFlash(ctx, msg) {
    const kh = document.querySelector(`#ol-entry-${ctx} .ol-keyhint`);
    if (!kh) return;
    kh.dataset.flash = '1'; kh.textContent = msg; kh.classList.add('flash');
    clearTimeout(kh._t);
    kh._t = setTimeout(() => { delete kh.dataset.flash; kh.classList.remove('flash'); _entrySync(ctx); }, 1600);
  }

  function _olInput(e, ctx) { _entry[ctx].field = e.target.value; _entrySync(ctx); }

  function _olChip(ctx, val) {
    const S = _entry[ctx];
    S.field = val;
    _entrySync(ctx);
    document.getElementById('ol-input-' + ctx)?.focus();
  }

  function _olStepBack(ctx) {
    const S = _entry[ctx];
    if (S.step === 2) { S.step = 1; S.field = S.whenRaw; S.when = null; }
    else if (S.step === 1) { S.step = 0; S.field = S.title; S.title = ''; }
    _entrySync(ctx);
  }

  function _olKey(e, ctx) {
    const S = _entry[ctx];
    const today = Data.localToday();
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) { _olStepBack(ctx); return; }
      if (S.step === 0 && S.field.trim()) { S.title = S.field.trim(); S.field = ''; S.step = 1; }
      else if (S.step === 1) {
        const w = GFParse.parseWhen(S.field, today);
        if (w && w.invalid) { _olFlash(ctx, "didn't catch that — try asap, no rush, fri, dec 4, every 2w"); return; }
        S.whenRaw = S.field; S.when = w; S.field = ''; S.step = 2;
      }
      _entrySync(ctx);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      _olSave(ctx, e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _entry[ctx] = _emptyEntry();
      _entrySync(ctx);
    } else if (e.key === 'Backspace' && !S.field && S.step > 0) {
      e.preventDefault();
      _olStepBack(ctx);
    }
  }

  function _olSave(ctx, toToday) {
    const S = _entry[ctx];
    const today = Data.localToday();
    const rawTitle = S.step === 0 ? S.field : S.title;
    if (!rawTitle.trim()) return;
    const pt = GFParse.parseTitle(rawTitle, today);
    let when = pt.when;
    if (S.step === 1 && S.field.trim()) when = GFParse.parseWhen(S.field, today);
    else if (S.step === 2 && S.when) when = S.when;
    if (when && when.invalid) { _olFlash(ctx, "didn't catch that date — fix it or clear it"); return; }
    let area = pt.area;
    if (S.step === 2 && S.field.trim()) {
      area = GFParse.parseArea(S.field);
      if (!area) { _olFlash(ctx, 'area: r, a, e or h'); return; }
    }
    if (ctx === 'today' && toToday === undefined) toToday = false;
    const task = Data.addTask({
      title: pt.title, isIdea: pt.isIdea, area, source: 'app',
      urgency: when?.urgency || null, dueDate: when?.dueDate || '',
      recur: when?.recur || null, toToday: !!toToday && !pt.isIdea,
    });
    if (!task) return;
    _entry[ctx] = _emptyEntry();
    if (!task.todayDate && olView === 'today') _offerHiddenDate = null; // show where it went
    _entrySync(ctx);
    _olRefreshLists();
    _olFlash(ctx, task.status === 'idea' ? 'saved → Ideas' : task.todayDate ? 'saved → Today' : task.status === 'recurring' ? 'saved → recurring' : `saved → ${ctx === 'today' ? 'Offered' : 'Everything'}`);
    if (ctx === 'everything') _olHighlight(task.id);
  }

  // Duplicate hint: on a close title match with an open task / idea / recurring task,
  // show "already have: …" with keep both (dismiss for this title) or open existing.
  function _olDupHint(ctx) {
    const S = _entry[ctx];
    const box = document.querySelector(`#ol-entry-${ctx} .ol-dup`);
    if (!box) return;
    const raw = S.step === 0 ? S.field : S.title;
    const title = raw.trim() ? GFParse.parseTitle(raw, Data.localToday()).title : '';
    const pool = Data.get().tasks.filter(t => t.status === 'open' || t.status === 'idea' || t.status === 'recurring');
    const hit = title && S.dupKeep !== title ? GFParse.closeMatch(title, pool) : null;
    if (!hit) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<span>already have: <strong>${esc(hit.title)}</strong></span>
      <button type="button" class="od-link" onmousedown="event.preventDefault()" onclick="App._olDupKeep('${ctx}')">keep both</button>
      <button type="button" class="od-link" onmousedown="event.preventDefault()" onclick="App._olDupOpen('${ctx}','${hit.id}')">open existing</button>`;
  }
  function _olDupKeep(ctx) {
    const S = _entry[ctx];
    const raw = S.step === 0 ? S.field : S.title;
    S.dupKeep = GFParse.parseTitle(raw, Data.localToday()).title;
    _olDupHint(ctx);
    document.getElementById('ol-input-' + ctx)?.focus();
  }
  function _olDupOpen(ctx, id) {
    _entry[ctx] = _emptyEntry();
    _entrySync(ctx);
    olOpenDetail(id);
  }

  // ── Stubs filled by later prompts (Everything = P5, Log = P6, detail = P5) ──
  function _olBackHeader(right) {
    return `<header class="ol-header">
      <button class="ol-navbtn" onclick="App.olGo('today')">← today</button>
      <span>${right || ''}</span>
    </header>`;
  }
  // ── Log (Prompt 6) — simple on purpose; expect a redesign once it's in use. ──
  // Week (Mon-start) → total focus, totals by area, then days → finished tasks → minutes.
  // Minutes per finished task = sum of its task_events minutes (started/done), falling
  // back to archive.time_spent for history from before task_events existed.
  let _logWeek = 0;
  function _logFmtMin(m) {
    if (!m) return '—';
    const h = Math.floor(m / 60), r = m % 60;
    return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
  }
  function _logMonday(offset) {
    const d = new Date(Data.localToday() + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
    return d;
  }
  function _logData(offset) {
    const mon = _logMonday(offset);
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return Data.localToday(d); });
    const inWeek = new Set(days);
    const evMin = {};
    Data.events().forEach(e => { if (e.minutes) evMin[e.taskId] = (evMin[e.taskId] || 0) + e.minutes; });
    const byDay = {}; days.forEach(d => { byDay[d] = []; });
    (Data.get().archive || []).forEach(a => {
      if (a.type === 'project' || !inWeek.has(a.archivedAt)) return;
      const m = evMin[a.id] != null ? evMin[a.id] : (a.timeSpent || 0);
      byDay[a.archivedAt].push({ id: a.id, title: a.title, area: a.area || '', m });
    });
    // Focus minutes on tasks that are still open, by the day they were logged
    Data.events().forEach(e => {
      if (!e.minutes || !Data.findItem(e.taskId)) return;
      const d = Data.localToday(new Date(e.at));
      if (!inWeek.has(d)) return;
      const t = Data.findItem(e.taskId);
      const row = byDay[d].find(r => r.id === t.id && r.open);
      if (row) row.m += e.minutes; else byDay[d].push({ id: t.id, title: t.title, area: t.area || '', m: e.minutes, open: true });
    });
    let total = 0; const areas = {};
    days.forEach(d => byDay[d].forEach(r => { total += r.m; const k = r.area || 'No area'; areas[k] = (areas[k] || 0) + r.m; }));
    return { mon, days, byDay, total, areas };
  }
  function _renderLog() {
    const L = _logData(_logWeek);
    const weekLbl = L.mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const order = [...Data.AREAS, 'No area'].filter(a => L.areas[a] != null);
    const dayHtml = [...L.days].reverse().filter(d => L.byDay[d].length).map(d => {
      const rows = L.byDay[d].sort((a, b) => b.m - a.m);
      const tot = rows.reduce((s, r) => s + r.m, 0);
      const name = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      return `<section class="lg-day">
        <div class="lg-day-head"><span>${name}</span><span>${_logFmtMin(tot)}</span></div>
        ${rows.map(r => `<div class="lg-row" data-id="${r.id}">
          <span class="lg-t">${esc(r.title)}${r.open ? ' <span class="lg-open">· still open</span>' : ''}</span>
          <span class="lg-a">${esc(r.area)}</span>
          <span class="lg-m">${_logFmtMin(r.m)}</span>
          ${r.open ? '<span class="lg-acts"></span>' : `<span class="lg-acts" id="lg-acts-${r.id}">
            <button class="od-link" onclick="App.logRestore('${r.id}')">restore</button>
            <button class="od-link danger" onclick="App.logDelAsk('${r.id}')">delete</button></span>`}
        </div>`).join('')}
      </section>`;
    }).join('');
    return `
      <header class="ol-header">
        <button class="ol-navbtn" onclick="App.olGo('today')">← today</button>
        <span class="lg-week">
          <button class="ol-navbtn" onclick="App.logWeek(-1)" aria-label="Previous week">‹</button>
          <span>week of ${weekLbl}</span>
          <button class="ol-navbtn" onclick="App.logWeek(1)" aria-label="Next week" ${_logWeek >= 0 ? 'disabled' : ''}>›</button>
        </span>
      </header>
      <main class="lg-main">
        <div class="lg-total"><span class="lg-big">${L.total ? _logFmtMin(L.total) : '0m'}</span><span class="lg-sub">focused ${_logWeek === 0 ? 'this week' : 'that week'}</span></div>
        <div class="lg-areas">${order.map(a => `<span>${esc(a)} ${_logFmtMin(L.areas[a])}</span>`).join('') || '<span class="lg-none">nothing finished yet</span>'}</div>
        ${dayHtml || '<p class="ol-empty">No finished tasks this week.</p>'}
      </main>`;
  }
  function logWeek(d) { _logWeek = Math.min(0, _logWeek + d); renderBoard(); }
  function logRestore(id) {
    Data.restoreFromArchive(id);
    const t = Data.findItem(id);
    if (t) {
      // Archive rows keep no live scheduling state — a restored task comes back as a plain open task.
      Object.assign(t, { status: 'open', recurrence: null, recurrenceSeriesId: null, todayDate: '', todayOrder: null });
      Data.upsertTask(t);
    }
    renderBoard();
  }
  function logDelAsk(id) {
    const z = document.getElementById('lg-acts-' + id); if (!z) return;
    z.classList.add('asking');
    z.innerHTML = `<span class="od-confirm">delete for good?</span>
      <button class="od-link danger" onclick="App.logDel('${id}')">yes</button>
      <button class="od-link" onclick="App.olGo('log')">no</button>`;
  }
  function logDel(id) { Data.deleteFromArchive(id); renderBoard(); }
  // ── Everything (zoom out) — Prompt 5 ──
  // Every open task, recurring task and idea floats in labeled clusters. Regroup by
  // area / urgency / date entered; items keep stable DOM nodes keyed by id so a regroup
  // just changes left/top and CSS transitions glide them to their new cluster.
  let _evMode = 'area';           // 'area' | 'urgency' | 'entered'
  let _evZoomed = false;          // false → first paint scaled up, then zooms out
  let _evHighlightId = null;

  function _evItems() {
    return Data.get().tasks.filter(t => t.status === 'open' || t.status === 'idea' || t.status === 'recurring');
  }

  // Urgency bucket — the same signals as the Offered ranking.
  function _evUrgency(t, today) {
    if (t.status === 'idea') return 'Ideas';
    if (t.status === 'recurring') {
      const d = _recurDueState(t);
      return d.state === 'overdue' || (d.daysUntil != null && d.daysUntil <= 0) ? 'Now' : d.state === 'due-soon' ? 'Soon' : 'Whenever';
    }
    if (t.urgency === 'norush') return 'No rush';
    const sc = _olScore(t, today).score;
    if (t.urgency === 'asap' || sc >= 40) return 'Now';
    if (sc >= 15) return 'Soon';
    return 'Whenever';
  }

  const _EV_GROUPS = {
    area:    ['Research', 'AMD', 'EDBA', 'Home', 'No area', 'Ideas'],
    urgency: ['Now', 'Soon', 'Whenever', 'No rush', 'Ideas'],
    entered: ['This week', 'This month', 'Last 3 months', 'Older', 'Ideas'],
  };
  function _evGroupOf(t, today) {
    if (_evMode === 'area') return t.status === 'idea' ? 'Ideas' : (t.area || 'No area');
    if (_evMode === 'urgency') return _evUrgency(t, today);
    if (t.status === 'idea') return 'Ideas';
    const age = t.dateAdded ? _olDaysBetween(t.dateAdded, today) : 999;
    return age <= 7 ? 'This week' : age <= 30 ? 'This month' : age <= 90 ? 'Last 3 months' : 'Older';
  }
  const _AREA_VAR = { Research: '--area-research', AMD: '--area-amd', EDBA: '--area-edba', Home: '--area-home' };

  function _renderEverything() {
    const modes = [['area', 'area'], ['urgency', 'urgency'], ['entered', 'date entered']];
    return `
      <header class="ol-header ev-header">
        <button class="ol-navbtn" onclick="App.olGo('today')"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"></circle><path d="M8 11h6M11 8v6M21 21l-5-5"></path></svg>back to today</button>
        <div class="ev-modes" role="group" aria-label="Group by">
          ${modes.map(([id, label]) => `<button class="ev-mode${_evMode === id ? ' on' : ''}" aria-pressed="${_evMode === id}" onclick="App.evMode('${id}')">${label}</button>`).join('')}
        </div>
        <span class="ev-count" id="ev-count"></span>
      </header>
      <div class="ev-entry-wrap">${_entryBarHtml('everything')}</div>
      <div class="ev-canvas${_evZoomed ? ' zoomed' : ''}" id="ev-canvas" onclick="App._evCanvasClick(event)"></div>`;
  }

  function _afterEverythingRender() {
    _entrySync('everything');
    _refreshEverything();
    if (!_evZoomed) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.getElementById('ev-canvas')?.classList.add('zoomed');
        _evZoomed = true;
      }));
    }
    document.getElementById('ol-input-everything')?.focus({ preventScroll: true });
  }

  function evMode(m) {
    _evMode = m;
    document.querySelectorAll('.ev-mode').forEach(b => {
      const on = b.getAttribute('onclick').includes(`'${m}'`);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    _refreshEverything();
  }

  // Lays out clusters as columns across the canvas. A crowded cluster splits into
  // sub-columns; when the whole set can't fit, rows get denser (smaller line height +
  // type), and as a last resort the canvas grows taller and the page scrolls.
  function _refreshEverything() {
    const canvas = document.getElementById('ev-canvas');
    if (!canvas) return;
    const today = Data.localToday();
    const onToday = new Set(Data.todayList().map(t => t.id));
    const items = _evItems();
    const countEl = document.getElementById('ev-count');
    if (countEl) countEl.textContent = `${items.length} open`;

    const groups = {};
    _EV_GROUPS[_evMode].forEach(g => { groups[g] = []; });
    items.forEach(t => { const g = _evGroupOf(t, today); (groups[g] || (groups[g] = [])).push(t); });
    const rank = t => (onToday.has(t.id) ? 1000 : 0) + (t.status === 'recurring' ? 0 : _olScore(t, today).score);
    Object.keys(groups).forEach(g => {
      if (_evMode === 'entered') groups[g].sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '') || a.id.localeCompare(b.id));
      else groups[g].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
    });
    const keys = Object.keys(groups).filter(g => groups[g].length);

    const W = canvas.clientWidth || 1200;
    // offsetTop, not getBoundingClientRect — the canvas is scaled during the zoom-out.
    const viewH = Math.max(380, window.innerHeight - canvas.offsetTop - 24);
    const LABEL_H = 40, ROW_GAP = 36, MIN_SUB_W = 200, MAX_SUB_W = 360, GAP_F = 0.3;
    // Try 1–3 rows of clusters × normal/dense line heights; keep the layout whose
    // narrowest column is widest (titles stay readable). If nothing reaches MIN_SUB_W,
    // the canvas grows taller and the page scrolls.
    const layoutFor = (rows, lineH, H) => {
      const per = Math.ceil(keys.length / rows);
      const rowKeys = Array.from({ length: rows }, (_, r) => keys.slice(r * per, r * per + per)).filter(r => r.length);
      const rowH = (H - rowKeys.length * LABEL_H - (rowKeys.length - 1) * ROW_GAP) / rowKeys.length;
      const perCol = Math.max(3, Math.floor(rowH / lineH));
      let minSub = Infinity;
      const rowsPlan = rowKeys.map(rk => {
        const plan = rk.map(k => ({ key: k, n: groups[k].length, per: perCol, cols: Math.max(1, Math.ceil(groups[k].length / perCol)) }));
        const units = plan.reduce((s, p) => s + p.cols, 0) + Math.max(0, rk.length - 1) * GAP_F;
        const subW = Math.min(MAX_SUB_W, W / Math.max(1, units));
        minSub = Math.min(minSub, subW);
        return { plan, subW, rowH };
      });
      return { rowsPlan, minSub, lineH, H };
    };
    let best = null;
    for (let H = viewH; !best || best.minSub < MIN_SUB_W; H = Math.round(H * 1.25)) {
      for (const lineH of [34, 27]) for (const rows of [1, 2, 3]) {
        if (rows > keys.length) continue;
        const L = layoutFor(rows, lineH, H);
        const better = !best || L.minSub > best.minSub + 4 || (Math.abs(L.minSub - best.minSub) <= 4 && (L.lineH > best.lineH || (L.lineH === best.lineH && L.rowsPlan.length < best.rowsPlan.length)));
        if (better) best = L;
      }
      if (H > viewH * 6 || !keys.length) break;
    }
    const canvasH = best ? best.H : viewH;
    canvas.style.height = canvasH + 'px';
    canvas.classList.toggle('dense', !!best && best.lineH < 34);

    const pos = {}; const labels = [];
    let rowTop = 0;
    (best ? best.rowsPlan : []).forEach(R => {
      const lineH = best.lineH, subW = R.subW, gapW = subW * GAP_F;
      const usedW = R.plan.reduce((s, p) => s + p.cols * subW, 0) + Math.max(0, R.plan.length - 1) * gapW;
      let x = Math.max(0, (W - usedW) / 2);
      R.plan.forEach(p => {
        const g = groups[p.key];
        const stackH = Math.min(p.n, p.per) * lineH;
        const slack = R.rowH - stackH;
        // Each cluster floats at a slightly different height — loose, not a grid.
        const jy = slack > 0 ? ((_hashStr(p.key) % 100) / 100 - 0.5) * Math.min(slack, 80) : 0;
        const top = rowTop + LABEL_H + Math.max(0, slack / 2 + jy);
        labels.push({ key: p.key, n: p.n, x: x + 6, y: top - LABEL_H + 8 });
        g.forEach((t, i) => {
          const col = Math.floor(i / p.per), row = i % p.per;
          const h = _hashStr(t.id);
          pos[t.id] = { x: x + col * subW + (h % 14) - 2, y: top + row * lineH, w: subW - 24 };
        });
        x += p.cols * subW + gapW;
      });
      rowTop += LABEL_H + R.rowH + ROW_GAP;
    });

    // Labels (rebuilt — they fade in)
    let lblLayer = canvas.querySelector('.ev-labels');
    if (!lblLayer) { lblLayer = document.createElement('div'); lblLayer.className = 'ev-labels'; canvas.appendChild(lblLayer); }
    lblLayer.innerHTML = labels.map(l => {
      const v = _evMode === 'area' && _AREA_VAR[l.key] ? `color:var(${_AREA_VAR[l.key]})` : '';
      return `<div class="ev-label" style="left:${l.x}px;top:${l.y}px;${v}">${esc(l.key)} <span>${l.n}</span></div>`;
    }).join('');

    // Items — stable nodes keyed by id
    let itLayer = canvas.querySelector('.ev-items');
    if (!itLayer) { itLayer = document.createElement('div'); itLayer.className = 'ev-items'; canvas.appendChild(itLayer); }
    const existing = new Map([...itLayer.children].map(el => [el.dataset.id, el]));
    items.forEach(t => {
      const p = pos[t.id]; if (!p) return;
      let el = existing.get(t.id);
      const fresh = !el;
      if (fresh) {
        el = document.createElement('div');
        el.className = 'ev-it';
        el.dataset.id = t.id;
        // first appearance: start at the cluster position (no glide from 0,0)
        el.style.transition = 'none';
      }
      const isToday = onToday.has(t.id), isIdea = t.status === 'idea';
      const areaVar = t.area && _AREA_VAR[t.area] ? `var(${_AREA_VAR[t.area]})` : 'var(--ol-faint)';
      const dot = isToday ? 'ev-dot today' : isIdea ? 'ev-dot idea' : 'ev-dot';
      const h = _hashStr(t.id);
      el.className = `ev-it${isToday ? ' on-today' : ''}${isIdea ? ' is-idea' : ''}${t.urgency === 'norush' ? ' is-norush' : ''}${t.id === _evHighlightId ? ' hilite' : ''}`;
      el.innerHTML = `<button class="ev-drift" style="animation-delay:-${h % 9}s;max-width:${Math.round(p.w)}px" onclick="event.stopPropagation();App.olOpenDetail('${t.id}', this)" title="${esc(t.title)}">
          <span class="${dot}" style="${isToday || isIdea ? '' : `background:${areaVar}`}" aria-hidden="true"></span>
          <span class="ev-title">${t.status === 'recurring' ? '↻ ' : ''}${esc(t.title)}</span>
        </button>`;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      if (fresh) { itLayer.appendChild(el); el.offsetHeight; el.style.transition = ''; }
      existing.delete(t.id);
    });
    existing.forEach(el => el.remove());
    if (!items.length) lblLayer.innerHTML = `<p class="ol-empty ev-empty">Nothing here yet — type above to add.</p>`;
  }

  function _olHighlight(id) {
    _evHighlightId = id;
    _refreshEverything();
    setTimeout(() => {
      if (_evHighlightId !== id) return;
      _evHighlightId = null;
      document.querySelector(`.ev-it[data-id="${id}"]`)?.classList.remove('hilite');
    }, 1800);
  }

  function _evCanvasClick(e) { if (e.target.id === 'ev-canvas') olCloseDetail(); }

  // ── Inline detail popover (Everything + Today/Offered titles) ──
  let _detailId = null;
  function olOpenDetail(id, anchorEl) {
    const t = Data.findItem(id); if (!t) return;
    _detailId = id;
    let pop = document.getElementById('ol-detail');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'ol-detail'; pop.className = 'ol-detail'; pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Task detail');
      pop.addEventListener('keydown', e => { if (e.key === 'Escape') olCloseDetail(); });
      document.body.appendChild(pop);
      setTimeout(() => document.addEventListener('mousedown', _olDetailOutside), 0);
    }
    pop.innerHTML = _olDetailHtml(t);
    const a = anchorEl || document.querySelector(`[data-id="${id}"] .ol-row-title, [data-id="${id}"] .ol-off-title, .ev-it[data-id="${id}"] .ev-drift`);
    const r = a ? a.getBoundingClientRect() : { left: window.innerWidth / 2 - 170, bottom: 120, top: 120 };
    const pw = 340, ph = pop.offsetHeight || 380;
    let left = Math.min(window.innerWidth - pw - 16, Math.max(16, r.left));
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 16) top = Math.max(16, r.top - ph - 8);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    pop.querySelector('.od-title')?.focus();
  }
  function _olDetailOutside(e) {
    const pop = document.getElementById('ol-detail');
    if (pop && !pop.contains(e.target) && !e.target.closest('.ev-drift, .ol-row-title, .ol-off-title')) olCloseDetail();
  }
  function olCloseDetail() {
    const pop = document.getElementById('ol-detail');
    if (pop) {
      const ti = pop.querySelector('.od-title');
      if (ti && _detailId) _odSet(_detailId, 'title', ti.value, true);
      pop.remove();
    }
    document.removeEventListener('mousedown', _olDetailOutside);
    _detailId = null;
  }

  function _olDetailHtml(t) {
    const today = Data.localToday();
    const onToday = t.todayDate === today;
    const isIdea = t.status === 'idea', isRec = t.status === 'recurring';
    const chip = (label, on, call) => `<button type="button" class="ol-chip${on ? ' on' : ''}" onclick="${call}">${label}</button>`;
    const urg = isRec ? '' : `<div class="od-row"><span class="od-lab">priority</span><div class="od-chips">
        ${chip('asap', t.urgency === 'asap', `App._odSet('${t.id}','urgency','asap')`)}
        ${chip('normal', !t.urgency, `App._odSet('${t.id}','urgency','')`)}
        ${chip('no rush', t.urgency === 'norush', `App._odSet('${t.id}','urgency','norush')`)}
      </div></div>
      <div class="od-row"><label class="od-lab" for="od-due">due</label>
        <input id="od-due" type="date" class="od-date" value="${t.dueDate || ''}" onchange="App._odSet('${t.id}','dueDate',this.value)" />
        ${t.dueDate ? `<button type="button" class="od-link" onclick="App._odSet('${t.id}','dueDate','')">clear</button>` : ''}</div>`;
    const rec = isRec ? `<div class="od-row od-rec"><span>↻ ${esc(_olCadence(t))} · ${esc(_olRecurWhen(t).replace(/^↻ /, ''))}</span>
        <button type="button" class="od-link" onclick="App.olCloseDetail();App.openRecurringModal('${t.id}')">edit recurrence…</button></div>` : '';
    return `
      <input class="od-title" value="${esc(t.title)}" aria-label="Title" onkeydown="if(event.key==='Enter')this.blur()" onchange="App._odSet('${t.id}','title',this.value)" />
      ${isIdea ? '<div class="od-kind">idea</div>' : ''}
      ${rec}${urg}
      <div class="od-row"><span class="od-lab">area</span><div class="od-chips">
        ${Data.AREAS.map(a => chip(a, t.area === a, `App._odSet('${t.id}','area','${a}')`)).join('')}
        ${chip('none', !t.area, `App._odSet('${t.id}','area','')`)}
      </div></div>
      <textarea class="od-notes" placeholder="notes" aria-label="Notes" onchange="App._odSet('${t.id}','notes',this.value)">${esc(t.notes || '')}</textarea>
      <div class="od-actions">
        ${isIdea ? `<button type="button" class="od-btn" onclick="App._odMakeTask('${t.id}')">make a task</button>`
          : onToday ? `<button type="button" class="od-btn" onclick="App._odToday('${t.id}',false)">on Today · take off</button>`
          : `<button type="button" class="od-btn primary" onclick="App._odToday('${t.id}',true)">add to Today</button>`}
        <span class="od-del" id="od-del"><button type="button" class="od-link danger" onclick="App._odDelAsk('${t.id}')">delete</button></span>
      </div>`;
  }

  function _odSet(id, field, val, silent) {
    const t = Data.findItem(id); if (!t) return;
    if (field === 'title') { val = (val || '').trim(); if (!val || val === t.title) return; }
    if (field === 'urgency') val = val || null;
    if (field === 'area') val = val || null;
    if ((t[field] ?? '') === (val ?? '')) return;
    t[field] = val;
    Data.upsertTask(t);
    if (silent) { _olRefreshLists(); return; }
    if (field !== 'notes' && field !== 'title') {
      const pop = document.getElementById('ol-detail');
      if (pop) { const notes = pop.querySelector('.od-notes')?.value; pop.innerHTML = _olDetailHtml(t); if (notes != null) pop.querySelector('.od-notes').value = notes; }
    }
    _olRefreshLists();
  }
  function _odToday(id, on) {
    if (on) Data.pullToToday(id); else Data.sendBack(id);
    const t = Data.findItem(id);
    const pop = document.getElementById('ol-detail');
    if (pop && t) pop.innerHTML = _olDetailHtml(t);
    _olRefreshLists();
  }
  function _odMakeTask(id) {
    const t = Data.findItem(id); if (!t) return;
    t.status = 'open'; Data.upsertTask(t);
    const pop = document.getElementById('ol-detail');
    if (pop) pop.innerHTML = _olDetailHtml(t);
    _olRefreshLists();
  }
  function _odDelAsk(id) {
    const z = document.getElementById('od-del'); if (!z) return;
    z.innerHTML = `<span class="od-confirm">delete for good?</span>
      <button type="button" class="od-link danger" onclick="App._odDel('${id}')">yes</button>
      <button type="button" class="od-link" onclick="App.olOpenDetail('${id}')">no</button>`;
  }
  function _odDel(id) {
    _detailId = null;
    document.getElementById('ol-detail')?.remove();
    document.removeEventListener('mousedown', _olDetailOutside);
    Data.deleteItem(id);
    _olRefreshLists();
  }

  // ── Modal shell (used by the recurring modal) ──
  function _showModal(content, itemId) {
    openItemId = itemId || null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-overlay" id="moverlay"><div class="modal">${content}</div></div>`;
    document.getElementById('moverlay').addEventListener('click', e => {
      if (e.target.id === 'moverlay') { openItemId = null; root.innerHTML = ''; }
    });
  }

  // ── Helpers ──
  function _today() { return Data.localToday(); } // local date (never toISOString → UTC)
  function _daysDiff(ds) { if (!ds) return 0; return Math.floor((new Date() - new Date(ds + 'T00:00:00')) / 86400000); }
  function _fmtDate(ds) { if (!ds) return ''; return new Date(ds+'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' }); }
  function _ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    get _initialized() { return _initialized; },
    set _initialized(v) { _initialized = v; },
    init,
    // Recurring
    openRecurringModal, _recurModalSetType, _recurModalToggleRule, _recurModalRuleTypeChange, _recurModalToggleAlt,
    _closeRecurModal, _saveRecurModal, _recurConfirmSave, _recurConfirmDismiss,
    completeRecurringToday, openRecurLogDate, _closeRecurLogDate, _confirmRecurLogDate,
    _showDelConfirm, _resetDelZone, _deleteItem,
    // Focus
    startTask, activateTask, timerTogglePlay, startNextSegment, skipSegment,
    openFocusPip, closeFocusPip, removeFromDoing, markDoingDone, focusBackToToday,
    // One List (desktop)
    olGo, olDone, olSendBack, olPull, olStart, olOpenDetail, olCloseDetail, olHideOffer, olShowOffer, olOfferAll,
    _olDragStart, _olDragEnd, _olListDragOver, _olDrop, _olKey, _olInput, _olChip, _olDupKeep, _olDupOpen,
    evMode, _evCanvasClick, _odSet, _odToday, _odMakeTask, _odDelAsk, _odDel,
    logWeek, logRestore, logDelAsk, logDel,
    // Phone
    _phSave, _phWhen, _phPickDate, _phArea, _phDone, _phTouchStart, _phTouchMove, _phTouchEnd,
  };
})();

// App.init() is called by auth.js once a valid session is confirmed.
// Do NOT add a DOMContentLoaded auto-init here — auth.js owns that gate.
