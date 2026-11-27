// data.js — Supabase persistence for Grind & Flow (One List, 2026-11-25)
//
// Strategy: optimistic updates. Every mutation updates the in-memory _state
// immediately (so the UI stays instant), then fires a background Supabase call.
// Tables used: tasks, archive, task_events. (projects / tags / commitments still
// exist in Supabase from the old app but are no longer read or written.)

const Data = (() => {
  let _state  = { tasks: [], archive: [], events: [] };
  let _client = null;  // injected by auth.js via Data.setClient()

  // ── Client injection ──
  function setClient(client) { _client = client; }

  // ─────────────────────────────────────────────
  // Field mappers: JS camelCase  ↔  DB snake_case
  // ─────────────────────────────────────────────

  function _taskToDb(t, uid) {
    return {
      id:                 t.id,
      user_id:            uid,
      type:               t.type,
      title:              t.title,
      status:             t.status,
      parent_project:     t.parentProject      || null,
      due_date:           t.dueDate            || null,
      scheduled_date:     t.scheduledDate      || null,
      scheduled_time:     t.scheduledTime      || null,
      notes:              t.notes              || '',
      date_added:         t.dateAdded          || null,
      blocked:            !!t.blocked,
      blocked_reason:     t.blockedReason      || null,
      tags:               t.tags               || [],
      backlog_entered_at: t.backlogEnteredAt   || null,
      later_count:        t.laterCount         || 0,
      day_order:          (t.dayOrder ?? null),
      time_spent:         t.timeSpent          || 0,
      board_order:        (t.boardOrder ?? null),
      recurrence:              t.recurrence            || null,
      recurrence_series_id:    t.recurrenceSeriesId     || null,
      recurrence_weekdays:     t.recurrenceWeekdays     || null,
      recurrence_month_day:    (t.recurrenceMonthDay ?? null),
      recurrence_nth:          (t.recurrenceNth?.length ? t.recurrenceNth : null),
      recurrence_interval_n:   (t.recurrenceIntervalN ?? null),
      recurrence_interval_unit: t.recurrenceIntervalUnit || null,
      recurrence_lead_days:    (t.recurrenceLeadDays ?? null),
      recurrence_last_completed_at: t.recurrenceLastCompletedAt || null,
      recurrence_alternate:    t.recurrenceAlternate    || null,
      // One List (2026-11-25)
      today_date:  t.todayDate  || null,
      today_order: (t.todayOrder ?? null),
      area:        t.area       || null,
      urgency:     t.urgency    || null,
      purpose:     t.purpose    || null,
      effort:      t.effort     || null,
      source:      t.source     || null,
      meta:        t.meta       || null,
    };
  }

  function _taskFromDb(r) {
    return {
      id:               r.id,
      type:             r.type,
      title:            r.title,
      status:           r.status,
      parentProject:    r.parent_project       || null,
      dueDate:          r.due_date             || '',
      scheduledDate:    r.scheduled_date       || '',
      scheduledTime:    r.scheduled_time       || '',
      notes:            r.notes                || '',
      dateAdded:        r.date_added           || '',
      blocked:          !!r.blocked,
      blockedReason:    r.blocked_reason       || '',
      tags:             r.tags                 || [],
      backlogEnteredAt: r.backlog_entered_at   || '',
      laterCount:       r.later_count          || 0,
      dayOrder:         (r.day_order ?? null),
      timeSpent:        r.time_spent           || 0,
      boardOrder:       (r.board_order ?? null),
      recurrence:            r.recurrence              || null,
      recurrenceSeriesId:    r.recurrence_series_id     || null,
      recurrenceWeekdays:    r.recurrence_weekdays      || null,
      recurrenceMonthDay:    (r.recurrence_month_day ?? null),
      recurrenceNth:         r.recurrence_nth           || null,
      recurrenceIntervalN:   (r.recurrence_interval_n ?? null),
      recurrenceIntervalUnit: r.recurrence_interval_unit || null,
      recurrenceLeadDays:    (r.recurrence_lead_days ?? null),
      recurrenceLastCompletedAt: r.recurrence_last_completed_at || null,
      recurrenceAlternate:   r.recurrence_alternate      || null,
      // One List (2026-11-25)
      todayDate:  r.today_date  || '',
      todayOrder: (r.today_order ?? null),
      area:       r.area        || null,
      urgency:    r.urgency     || null,
      purpose:    r.purpose     || null,
      effort:     r.effort      || null,
      source:     r.source      || null,
      meta:       r.meta        || null,
    };
  }

  function _archToDb(a, uid) {
    return {
      id:              a.id,
      user_id:         uid,
      type:            a.type,
      title:           a.title,
      status:          a.status,
      original_status: a.originalStatus        || a.status,
      archived_at:     a.archivedAt            || null,
      parent_project:  a.parentProject         || null,
      due_date:        a.dueDate               || null,
      scheduled_date:  a.scheduledDate         || null,
      notes:           a.notes                 || '',
      date_added:      a.dateAdded             || null,
      blocked:         !!a.blocked,
      blocked_reason:  a.blockedReason         || null,
      tags:            a.tags                  || [],
      subtasks:        a.subtasks              || [],
      time_spent:      a.timeSpent             || 0,
      recurrence:            a.recurrence            || null,
      recurrence_series_id:  a.recurrenceSeriesId    || null,
      area:                  a.area                  || null,
    };
  }

  // ── task_events (One List) ──
  function _eventFromDb(r) {
    return { id: r.id, taskId: r.task_id, event: r.event, at: r.at, minutes: r.minutes ?? null, seconds: r.seconds ?? null, meta: r.meta ?? null };
  }
  function _eventToDb(e, uid) {
    return { id: e.id, user_id: uid, task_id: e.taskId, event: e.event, at: e.at, minutes: e.minutes ?? null, seconds: e.seconds ?? null, meta: e.meta ?? null };
  }

  function _archFromDb(r) {
    // archive.tags, archive.blocked, and archive.subtasks are stored as `text`
    // (not jsonb/boolean) — parse them defensively.
    function _parseJson(v, fallback) {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string' && v.trim().startsWith('[')) {
        try { return JSON.parse(v); } catch (e) { return fallback; }
      }
      return fallback;
    }
    return {
      id:             r.id,
      type:           r.type,
      title:          r.title,
      status:         r.original_status        || r.status,
      originalStatus: r.original_status        || '',
      archivedAt:     r.archived_at            || '',
      parentProject:  r.parent_project         || null,
      dueDate:        r.due_date               || '',
      scheduledDate:  r.scheduled_date         || '',
      notes:          r.notes                  || '',
      dateAdded:      r.date_added             || '',
      blocked:        r.blocked === true || r.blocked === 'true',
      blockedReason:  r.blocked_reason         || '',
      tags:           _parseJson(r.tags, []),
      subtasks:       _parseJson(r.subtasks, []),
      scheduledTime:  r.scheduled_time         || '',
      timeSpent:      r.time_spent             || 0,
      recurrence:         r.recurrence              || null,
      recurrenceSeriesId: r.recurrence_series_id     || null,
      area:               r.area                     || null,
    };
  }

  // ─────────────────────────────────────────────
  // Auth helper
  // ─────────────────────────────────────────────

  async function _uid() {
    const { data: { user } } = await _client.auth.getUser();
    return user?.id;
  }

  // ─────────────────────────────────────────────
  // Load — async, called from App.init()
  // ─────────────────────────────────────────────

  async function load() {
    _state = { tasks: [], archive: [], events: [] };
    if (!_client) { console.error('[Data] load called before setClient()'); return _state; }
    try {
      const uid = await _uid();
      const [tr, ar, ev] = await Promise.all([
        _client.from('tasks').select('*').eq('user_id', uid),
        _client.from('archive').select('*').eq('user_id', uid),
        _client.from('task_events').select('*').eq('user_id', uid),
      ]);
      if (tr.error) throw tr.error;
      if (ar.error) console.warn('[Data] archive load error:', ar.error.message);
      if (ev.error) console.warn('[Data] task_events load error:', ev.error.message);
      _state = {
        tasks:   (tr.data || []).map(_taskFromDb),
        archive: (ar.data || []).map(_archFromDb),
        events:  (ev.data || []).map(_eventFromDb),
      };
    } catch (e) {
      console.error('[Data] load failed:', e.message);
    }
    return _state;
  }

  // ─────────────────────────────────────────────
  // Background sync helpers (fire-and-forget)
  // ─────────────────────────────────────────────

  async function _syncT(item) {
    if (!_client) return;
    const { error } = await _client.from('tasks').upsert(_taskToDb(item, await _uid()));
    if (error) console.error('[Data] sync task:', error.message);
  }

  async function _syncA(item) {
    if (!_client) return;
    const { error } = await _client.from('archive').upsert(_archToDb(item, await _uid()));
    if (error) console.error('[Data] sync archive:', error.message);
  }

  async function _del(table, id) {
    if (!_client) return;
    const { error } = await _client.from(table).delete().eq('id', id);
    if (error) console.error(`[Data] delete ${table}:`, error.message);
  }

  // ─────────────────────────────────────────────
  // Getters + generic mutations
  // ─────────────────────────────────────────────

  function get()         { return _state; }
  function findItem(id)  { return _state.tasks.find(t => t.id === id); }

  function upsertTask(item) {
    const idx = _state.tasks.findIndex(t => t.id === item.id);
    if (idx >= 0) _state.tasks[idx] = item; else _state.tasks.push(item);
    _syncT(item);
  }

  function deleteItem(id) {
    if (!findItem(id)) return;
    _state.tasks = _state.tasks.filter(t => t.id !== id);
    _del('tasks', id);
  }

  // Moves a task into `archive`, stamped with dateStr (its completion date).
  function archiveItemWithDate(id, dateStr) {
    const item = findItem(id); if (!item) return;
    const archived = { ...item, archivedAt: dateStr || localToday(), originalStatus: item.status };
    _state.archive.push(archived);
    _state.tasks = _state.tasks.filter(t => t.id !== id);
    _syncA(archived);
    _del('tasks', id);
  }

  function restoreFromArchive(id) {
    const item = _state.archive.find(i => i.id === id); if (!item || item.type === 'project') return;
    const restored = { ...item };
    delete restored.archivedAt;
    delete restored.originalStatus;
    _state.tasks.push(restored);
    _syncT(restored);
    _state.archive = _state.archive.filter(i => i.id !== id);
    _del('archive', id);
  }

  function deleteFromArchive(id) {
    _state.archive = _state.archive.filter(i => i.id !== id);
    _del('archive', id);
  }

  // ─────────────────────────────────────────────
  // One List — statuses: open / done / recurring / idea.
  // A task is "on Today" when todayDate === today (local). No rollover job:
  // yesterday's items simply stop matching todayList().
  // ─────────────────────────────────────────────

  const AREAS = ['Research', 'AMD', 'EDBA', 'Home'];

  // Local-time YYYY-MM-DD (toISOString would give the UTC date — wrong in the evening).
  function localToday(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function _nextTodayOrder() {
    const t = localToday();
    const orders = _state.tasks.filter(x => x.todayDate === t && x.todayOrder != null).map(x => +x.todayOrder);
    return orders.length ? Math.max(...orders) + 1 : 1;
  }

  // Append-only event log. Optimistic like everything else (the sync is fire-and-forget).
  // `meta` = ranking telemetry (see .claude/rules/one-list.md "Ranking telemetry").
  // `seconds` (optional, 6th arg) = exact Focus work seconds; `minutes` stays the rounded
  // value for older readers. A session's time lives on exactly one event.
  function logEvent(taskId, event, minutes, meta, seconds) {
    if (!_state.events) _state.events = [];
    const e = {
      id: 'e' + Date.now() + Math.random().toString(36).slice(2, 7),
      taskId, event, at: new Date().toISOString(), minutes: minutes ?? null, seconds: seconds ?? null, meta: meta ?? null,
    };
    _state.events.push(e);
    _syncEvent(e);
    return e;
  }

  // Set minutes on an existing event (Focus "Back to Today" writes the session's work
  // minutes onto its `started` row).
  function setEventMinutes(eventId, minutes, seconds) {
    const e = (_state.events || []).find(x => x.id === eventId); if (!e) return;
    e.minutes = minutes;
    if (seconds !== undefined) e.seconds = seconds;
    _syncEvent(e);
  }

  // Merge keys into an existing event's meta (Focus flow mode marks its `started` row).
  function patchEventMeta(eventId, patch) {
    const e = (_state.events || []).find(x => x.id === eventId); if (!e) return;
    e.meta = { ...(e.meta || {}), ...patch };
    _syncEvent(e);
  }

  async function _syncEvent(e) {
    if (!_client) return;
    const { error } = await _client.from('task_events').upsert(_eventToDb(e, await _uid()));
    if (error) console.error('[Data] sync event:', error.message);
  }

  // addTask — the one creation path for the entry bar (Today, Everything, phone).
  // `recur` (optional) carries recurrence fields ({recurrence, recurrenceIntervalN, …});
  // when present the task is created with status 'recurring'.
  function addTask({ title, urgency, dueDate, area, toToday, isIdea, source, notes, recur } = {}) {
    title = (title || '').trim();
    if (!title) return null;
    const id = 't' + Date.now() + Math.floor(Math.random() * 1000);
    const today = localToday();
    const status = recur ? 'recurring' : isIdea ? 'idea' : 'open';
    const task = {
      id, type: 'standalone', title, status,
      parentProject: null, dueDate: dueDate || '', scheduledDate: '', scheduledTime: '',
      notes: notes || '', dateAdded: today, blocked: false, blockedReason: '', tags: [],
      backlogEnteredAt: '', laterCount: 0, dayOrder: null, timeSpent: 0, boardOrder: null,
      recurrence: null, recurrenceSeriesId: null, recurrenceWeekdays: null, recurrenceMonthDay: null, recurrenceNth: null,
      recurrenceIntervalN: null, recurrenceIntervalUnit: null, recurrenceLeadDays: null,
      recurrenceLastCompletedAt: null, recurrenceAlternate: null,
      todayDate: '', todayOrder: null,
      area: AREAS.includes(area) ? area : null,
      urgency: urgency === 'asap' || urgency === 'norush' ? urgency : null,
      purpose: null, effort: null, source: source || 'app', meta: null,
    };
    if (recur) Object.assign(task, recur, { recurrenceSeriesId: id });
    if (toToday && !isIdea) { task.todayDate = today; task.todayOrder = _nextTodayOrder(); }
    upsertTask(task);
    logEvent(id, 'added');
    if (task.todayDate) logEvent(id, 'pulled', null, { from: 'entry', offeredRank: null, score: null, parts: null, ...todayPosition(id, 'toPosition') });
    return task;
  }

  // 1-based slot on Today + Today's size, or position null when the task isn't on Today.
  // `key` renames the position field (e.g. 'toPosition'). Read it before the list changes.
  function todayPosition(id, key = 'position') {
    const list = todayList();
    const i = list.findIndex(x => x.id === id);
    return { [key]: i < 0 ? null : i + 1, todaySize: list.length };
  }

  // meta (telemetry, from the caller) = { from, offeredRank, score, parts }; toPosition added here.
  function pullToToday(id, meta) {
    const t = _state.tasks.find(x => x.id === id); if (!t) return;
    if (t.status === 'idea') t.status = 'open';
    t.todayDate = localToday();
    t.todayOrder = _nextTodayOrder();
    upsertTask(t);
    logEvent(id, 'pulled', null, { from: 'offered', offeredRank: null, score: null, parts: null, ...meta, toPosition: todayPosition(id).position });
  }

  function sendBack(id) {
    const t = _state.tasks.find(x => x.id === id); if (!t) return;
    const { position } = todayPosition(id);
    t.todayDate = ''; t.todayOrder = null;
    upsertTask(t);
    logEvent(id, 'sent_back', null, { position });
  }

  // ids = the full Today order, top first. movedId (a drag-drop) → logs `reordered`
  // { from, to, todaySize } when its slot actually changed.
  function reorderToday(ids, movedId) {
    const before = movedId ? todayPosition(movedId).position : null;
    ids.forEach((id, i) => {
      const t = _state.tasks.find(x => x.id === id);
      if (t && t.todayOrder !== i + 1) { t.todayOrder = i + 1; upsertTask(t); }
    });
    if (movedId && before != null) {
      const after = todayPosition(movedId);
      if (after.position !== before) logEvent(movedId, 'reordered', null, { from: before, to: after.position, todaySize: after.todaySize });
    }
  }

  // Lazy "end of day" record (there is no midnight job): on the first load of a new local
  // day, every task still sitting on the most recent prior Today gets one `day_snapshot`
  // { date, position, todaySize, order }. position/todaySize are among the leftovers (done
  // tasks are archived by then); order = the raw todayOrder. Deduped per task + date.
  // Must run before anything rewrites todayOrder (call right after load).
  function snapshotPriorDay() {
    const today = localToday();
    const prior = _state.tasks.map(t => t.todayDate).filter(d => d && d < today).sort().pop();
    if (!prior) return 0;
    const left = _state.tasks
      .filter(t => t.todayDate === prior && (t.status === 'open' || t.status === 'recurring'))
      .sort((a, b) => (a.todayOrder ?? Infinity) - (b.todayOrder ?? Infinity));
    const have = new Set(events().filter(e => e.event === 'day_snapshot' && e.meta?.date === prior).map(e => e.taskId));
    let n = 0;
    left.forEach((t, i) => {
      if (have.has(t.id)) return;
      logEvent(t.id, 'day_snapshot', null, { date: prior, position: i + 1, todaySize: left.length, order: t.todayOrder ?? null });
      n++;
    });
    return n;
  }

  // completeTask — archives immediately (same path as the midnight auto-archive), stamped
  // with dateStr (default today), and logs `done` with any focus minutes from this session.
  // Recurrence spawning is UI-side (app.js _maybeSpawnRecurrence) and must run before this.
  function completeTask(id, { minutes, seconds, dateStr, meta } = {}) {
    const t = _state.tasks.find(x => x.id === id); if (!t) return;
    logEvent(id, 'done', minutes || null, { ...todayPosition(id), ...(meta || {}) }, seconds || null);
    archiveItemWithDate(id, dateStr || localToday());
  }

  // ── Selectors ──
  function todayList() {
    const t = localToday();
    return _state.tasks
      .filter(x => x.todayDate === t && x.status !== 'done' && x.status !== 'idea')
      .sort((a, b) => (a.todayOrder ?? Infinity) - (b.todayOrder ?? Infinity));
  }
  function openTasks()      { return _state.tasks.filter(x => x.status === 'open'); }
  function recurringTasks() { return _state.tasks.filter(x => x.status === 'recurring'); }
  function ideas()          { return _state.tasks.filter(x => x.status === 'idea'); }
  function events()         { return _state.events || []; }

  return {
    setClient, load, get, findItem,
    upsertTask, deleteItem, archiveItemWithDate, restoreFromArchive, deleteFromArchive,
    AREAS, localToday, addTask, pullToToday, sendBack, reorderToday, completeTask, logEvent, setEventMinutes, patchEventMeta,
    todayPosition, snapshotPriorDay,
    todayList, openTasks, recurringTasks, ideas, events,
  };
})();
