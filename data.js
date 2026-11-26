// data.js — Supabase persistence for Grind & Flow
//
// Strategy: optimistic updates.
// Every mutation updates the in-memory _state immediately (so the UI stays
// instant), then fires a background Supabase call.  app.js call sites that
// previously called Data.save() now call the appropriate upsert function
// directly — see the change log at the bottom of this file.
//
// One-time migration: on first load for a user with an empty Supabase
// account, any existing localStorage data is automatically imported.

const LEGACY_STORAGE_KEY    = 'gf-data';        // read-only — used once for legacy task/project migration
const LEGACY_TAGS_KEY       = 'gf-tags';        // read-only — used once for tag migration
const LEGACY_TAG_COLORS_KEY = 'gf-tag-colors';  // read-only — used once for tag color migration
const _BUILT_IN_TAGS        = ['work', 'personal', 'school']; // duplicated from app.js for migration use

const Data = (() => {
  let _state  = null;
  let _client = null;  // injected by auth.js via Data.setClient()

  // ── Client injection ──
  function setClient(client) { _client = client; }

  // ─────────────────────────────────────────────
  // Field mappers: JS camelCase  ↔  DB snake_case
  // ─────────────────────────────────────────────

  function _projToDb(p, uid) {
    return {
      id:             p.id,
      user_id:        uid,
      title:          p.title,
      status:         p.status,
      due_date:       p.dueDate        || null,
      scheduled_date: p.scheduledDate  || null,
      scheduled_time: p.scheduledTime  || null,
      notes:          p.notes          || '',
      date_added:     p.dateAdded      || null,
      blocked:        !!p.blocked,
      blocked_reason: p.blockedReason  || null,
      waiting:        !!p.waiting,
      waiting_reason: p.waitingReason  || null,
      waiting_auto:   !!p.waitingAuto,
      tags:           p.tags           || [],
      subtasks:       p.subtasks       || [],
      capacities_url: p.capacitiesUrl  || null,
      completed_at:   p.completedAt    || null,
    };
  }

  function _projFromDb(r) {
    return {
      id:            r.id,
      type:          'project',
      title:         r.title,
      status:        r.status,
      dueDate:       r.due_date        || '',
      scheduledDate: r.scheduled_date  || '',
      scheduledTime: r.scheduled_time  || '',
      notes:         r.notes           || '',
      dateAdded:     r.date_added      || '',
      blocked:       !!r.blocked,
      blockedReason: r.blocked_reason  || '',
      waiting:       !!r.waiting,
      waitingReason: r.waiting_reason  || '',
      waitingAuto:   !!r.waiting_auto,
      tags:          r.tags            || [],
      subtasks:      r.subtasks        || [],
      capacitiesUrl: r.capacities_url  || null,
      completedAt:   r.completed_at    || null,
    };
  }

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

  function _tagFromDb(r) {
    return {
      name:      r.name,
      colorSlot: r.color_slot ?? null,
      sortOrder: r.sort_order ?? null,
    };
  }

  function _tagToDb(t, uid) {
    return {
      user_id:    uid,
      name:       t.name,
      color_slot: t.colorSlot ?? null,
      sort_order: t.sortOrder ?? null,
    };
  }

  function _commitFromDb(r) {
    return {
      id:        r.id,
      title:     r.title,
      date:      r.date                  || '',
      startTime: r.start_time            || '',
      endTime:   r.end_time              || '',
      endDate:   r.end_date              || null,
      type:      r.type                  || null,
      shift:     r.shift                 || null,
      colorSlot: r.color_slot ?? null,
      notes:     r.notes                 || '',
    };
  }

  function _commitToDb(c, uid) {
    return {
      id:         c.id,
      user_id:    uid,
      title:      c.title,
      date:       c.date,
      start_time: c.startTime || null,
      end_time:   c.endTime   || null,
      end_date:   c.endDate   || null,
      type:       c.type      || null,
      shift:      c.shift     || null,
      color_slot: c.colorSlot ?? null,
      notes:      c.notes     || null,
    };
  }

  // ── task_events (One List) ──
  function _eventFromDb(r) {
    return { id: r.id, taskId: r.task_id, event: r.event, at: r.at, minutes: r.minutes ?? null };
  }
  function _eventToDb(e, uid) {
    return { id: e.id, user_id: uid, task_id: e.taskId, event: e.event, at: e.at, minutes: e.minutes ?? null };
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
  // One-time localStorage → Supabase migration
  // Runs on first load for any user whose Supabase tables are empty.
  // ─────────────────────────────────────────────

  async function _migrateFromLocalStorage() {
    // Only attempt if there is legacy data to migrate
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;

    try {
      const ls = JSON.parse(raw);
      if (!ls?.projects?.length && !ls?.tasks?.length) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return;
      }

      const uid = await _uid();
      if (!uid) return; // no authenticated user yet — skip silently

      // Skip if this user already has Supabase data.
      // Guard checks both data AND error: if the query itself fails, bail out
      // rather than accidentally re-running migration.
      const { data: existing, error: guardError } = await _client
        .from('projects').select('id').eq('user_id', uid).limit(1);
      if (guardError || (existing && existing.length > 0)) return;

      console.log('[Data] Migrating localStorage → Supabase…');
      const ops = [];
      if (ls.projects?.length)
        ops.push(_client.from('projects').upsert(ls.projects.map(p => _projToDb(p, uid))));
      if (ls.tasks?.length)
        ops.push(_client.from('tasks').upsert(ls.tasks.map(t => _taskToDb(t, uid))));
      if (ls.archive?.length)
        ops.push(_client.from('archive').upsert(ls.archive.map(a => _archToDb(a, uid))));

      const results = await Promise.all(ops);
      const hasError = results.some(({ error }) => {
        if (error) { console.error('[Data] Migration upsert error:', error.message); return true; }
        return false;
      });

      if (!hasError) {
        // Remove legacy key so migration never runs again for this browser
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        console.log('[Data] Migration complete — localStorage cleared.');
      } else {
        console.warn('[Data] Migration had errors; localStorage preserved for retry.');
      }
    } catch (e) {
      console.warn('[Data] localStorage migration skipped:', e.message);
    }
  }

  // One-time migration for tags stored in localStorage under gf-tags / gf-tag-colors.
  // Runs during load(); clears the localStorage keys on success.
  async function _migrateTagsFromLocalStorage(uid) {
    const tagsRaw   = localStorage.getItem(LEGACY_TAGS_KEY);
    const colorsRaw = localStorage.getItem(LEGACY_TAG_COLORS_KEY);
    if (!tagsRaw && !colorsRaw) return;
    try {
      const legacyTags   = tagsRaw   ? JSON.parse(tagsRaw)   : [];
      const legacyColors = colorsRaw ? JSON.parse(colorsRaw) : {};
      const rows = [];
      // Custom tags (not built-ins)
      legacyTags.filter(t => !_BUILT_IN_TAGS.includes(t)).forEach(name => {
        rows.push({ user_id: uid, name, color_slot: legacyColors[name] ?? null });
      });
      // Built-in tags that have a color override
      _BUILT_IN_TAGS.forEach(name => {
        if (name in legacyColors) rows.push({ user_id: uid, name, color_slot: legacyColors[name] });
      });
      if (rows.length > 0) {
        const { error } = await _client.from('tags').upsert(rows);
        if (error) { console.error('[Data] tags migration error:', error.message); return; }
      }
      localStorage.removeItem(LEGACY_TAGS_KEY);
      localStorage.removeItem(LEGACY_TAG_COLORS_KEY);
      console.log('[Data] Tags migrated from localStorage → Supabase.');
    } catch (e) {
      console.warn('[Data] Tags migration skipped:', e.message);
    }
  }

  // ─────────────────────────────────────────────
  // Load — async, called from App.init()
  // ─────────────────────────────────────────────

  async function load() {
    if (!_client) {
      console.error('[Data] load called before setClient()');
      _state = { projects: [], tasks: [], archive: [], tags: [], commitments: [], events: [] };
      return _state;
    }
    await _migrateFromLocalStorage();
    try {
      const uid = await _uid();
      await _migrateTagsFromLocalStorage(uid);
      const [pr, tr, ar, tg, cm, ev] = await Promise.all([
        _client.from('projects').select('*').eq('user_id', uid),
        _client.from('tasks').select('*').eq('user_id', uid),
        _client.from('archive').select('*').eq('user_id', uid),
        _client.from('tags').select('*').eq('user_id', uid),
        _client.from('commitments').select('*').eq('user_id', uid),
        _client.from('task_events').select('*').eq('user_id', uid),
      ]);
      if (pr.error) throw pr.error;
      if (tr.error) throw tr.error;
      if (ar.error) console.warn('[Data] archive load error:', ar.error.message);
      if (tg.error) console.warn('[Data] tags load error:', tg.error.message);
      if (cm.error) console.warn('[Data] commitments load error:', cm.error.message);
      if (ev.error) console.warn('[Data] task_events load error:', ev.error.message);
      _state = {
        projects:    (pr.data || []).map(_projFromDb),
        tasks:       (tr.data || []).map(_taskFromDb),
        archive:     (ar.data || []).map(_archFromDb),
        tags:        (tg.data || []).map(_tagFromDb),
        commitments: (cm.data || []).map(_commitFromDb),
        events:      (ev.data || []).map(_eventFromDb),
      };
    } catch (e) {
      console.error('[Data] load failed:', e.message);
      _state = { projects: [], tasks: [], archive: [], tags: [], commitments: [], events: [] };
    }
    return _state;
  }

  // ─────────────────────────────────────────────
  // Background sync helpers (fire-and-forget)
  // ─────────────────────────────────────────────

  async function _syncP(item) {
    if (!_client) return;
    const { error } = await _client.from('projects').upsert(_projToDb(item, await _uid()));
    if (error) console.error('[Data] sync project:', error.message);
  }

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
  // Getters
  // ─────────────────────────────────────────────

  function get()            { return _state; }
  function getAllItems()    { return [..._state.projects, ..._state.tasks]; }
  function findItem(id)    { return getAllItems().find(i => i.id === id); }
  function findProject(id) { return _state.projects.find(p => p.id === id); }

  // ─────────────────────────────────────────────
  // Mutations — sync _state immediately, sync Supabase in background
  // ─────────────────────────────────────────────

  function upsertProject(item) {
    const idx = _state.projects.findIndex(p => p.id === item.id);
    if (idx >= 0) _state.projects[idx] = item; else _state.projects.push(item);
    _syncP(item);
  }

  function upsertTask(item) {
    const idx = _state.tasks.findIndex(t => t.id === item.id);
    if (idx >= 0) _state.tasks[idx] = item; else _state.tasks.push(item);
    _syncT(item);

    // Auto-waiting: keep parent project's waiting state in sync with blocked child tasks
    if (item.parentProject) {
      const proj = findProject(item.parentProject);
      if (proj && !proj.blocked) {
        if (item.blocked) {
          // Task just blocked — set project to waiting only if it isn't already manually waiting
          if (!proj.waiting || proj.waitingAuto) {
            const wasWaiting  = proj.waiting;
            proj.waiting      = true;
            proj.waitingAuto  = true;
            // Only pre-fill reason on the first auto-set (project was clear before)
            if (!wasWaiting) proj.waitingReason = item.blockedReason || '';
            const pi = _state.projects.findIndex(p => p.id === proj.id);
            if (pi >= 0) _state.projects[pi] = proj;
            _syncP(proj);
          }
        } else if (proj.waiting && proj.waitingAuto) {
          // Task unblocked — auto-clear only if no other child tasks are still blocked
          const anyStillBlocked = _state.tasks.some(
            t => t.id !== item.id && t.parentProject === item.parentProject && t.blocked
          );
          if (!anyStillBlocked) {
            proj.waiting      = false;
            proj.waitingReason = '';
            proj.waitingAuto  = false;
            const pi = _state.projects.findIndex(p => p.id === proj.id);
            if (pi >= 0) _state.projects[pi] = proj;
            _syncP(proj);
          }
        }
      }
    }
  }

  function deleteItem(id) {
    const item = findItem(id); if (!item) return;
    // If a promoted subtask is deleted, un-promote it on the parent project
    if (item.type === 'task' && item.parentProject) {
      const proj = findProject(item.parentProject);
      if (proj) {
        const st = proj.subtasks.find(s => s.title === item.title && s.promoted);
        if (st) { st.promoted = false; _syncP(proj); }
      }
    }
    _state.projects = _state.projects.filter(i => i.id !== id);
    _state.tasks    = _state.tasks.filter(i => i.id !== id);
    _del(item.type === 'project' ? 'projects' : 'tasks', id);
  }

  function archiveItem(id) {
    const item = findItem(id); if (!item) return;
    const archived = {
      ...item,
      archivedAt:     new Date().toISOString().split('T')[0],
      originalStatus: item.status,
    };
    _state.archive.push(archived);
    _state.projects = _state.projects.filter(i => i.id !== id);
    _state.tasks    = _state.tasks.filter(i => i.id !== id);
    _syncA(archived);
    _del(item.type === 'project' ? 'projects' : 'tasks', id);
  }

  // archiveItemWithDate — like archiveItem but lets the caller specify archivedAt.
  // Used by the midnight auto-archive to stamp items with their completion date.
  function archiveItemWithDate(id, dateStr) {
    const item = findItem(id); if (!item) return;
    const archived = {
      ...item,
      archivedAt:     dateStr || new Date().toISOString().split('T')[0],
      originalStatus: item.status,
    };
    _state.archive.push(archived);
    _state.projects = _state.projects.filter(i => i.id !== id);
    _state.tasks    = _state.tasks.filter(i => i.id !== id);
    _syncA(archived);
    _del(item.type === 'project' ? 'projects' : 'tasks', id);
  }

  // clearArchive — permanently deletes all items from the archive table
  // AND all projects with status === 'done' from the projects table.
  function clearArchive() {
    const archiveIds = _state.archive.map(i => i.id);
    _state.archive = [];
    archiveIds.forEach(id => _del('archive', id));

    const doneProjects = _state.projects.filter(p => p.status === 'done');
    _state.projects = _state.projects.filter(p => p.status !== 'done');
    doneProjects.forEach(p => _del('projects', p.id));
  }

  function restoreFromArchive(id) {
    const item = _state.archive.find(i => i.id === id); if (!item) return;
    const restored = { ...item };
    delete restored.archivedAt;
    delete restored.originalStatus;
    if (restored.type === 'project') { _state.projects.push(restored); _syncP(restored); }
    else                             { _state.tasks.push(restored);    _syncT(restored); }
    _state.archive = _state.archive.filter(i => i.id !== id);
    _del('archive', id);
  }

  function deleteFromArchive(id) {
    _state.archive = _state.archive.filter(i => i.id !== id);
    _del('archive', id);
  }

  // ── Tag mutations ──

  // sortOrder is optional — omit it to leave an existing tag's stored column-order
  // untouched (e.g. when only reassigning color). Pass it explicitly to reorder.
  function upsertTag(name, colorSlot, sortOrder) {
    const idx = _state.tags.findIndex(t => t.name === name);
    const existing = idx >= 0 ? _state.tags[idx] : null;
    const tag = {
      name,
      colorSlot: colorSlot ?? null,
      sortOrder: sortOrder !== undefined ? sortOrder : (existing ? (existing.sortOrder ?? null) : null),
    };
    if (idx >= 0) _state.tags[idx] = tag; else _state.tags.push(tag);
    _syncTag(tag);
  }

  function deleteTag(name) {
    _state.tags = _state.tags.filter(t => t.name !== name);
    _delTag(name);
  }

  async function _syncTag(tag) {
    if (!_client) return;
    const uid = await _uid();
    const { error } = await _client.from('tags').upsert(_tagToDb(tag, uid));
    if (error) console.error('[Data] sync tag:', error.message);
  }

  async function _delTag(name) {
    if (!_client) return;
    const uid = await _uid();
    const { error } = await _client.from('tags').delete().eq('user_id', uid).eq('name', name);
    if (error) console.error('[Data] delete tag:', error.message);
  }

  // ── Commitment mutations ──

  function upsertCommitment(c) {
    if (!_state.commitments) _state.commitments = [];
    const idx = _state.commitments.findIndex(x => x.id === c.id);
    if (idx >= 0) _state.commitments[idx] = c; else _state.commitments.push(c);
    _syncCommit(c);
  }

  function deleteCommitment(id) {
    if (!_state.commitments) _state.commitments = [];
    _state.commitments = _state.commitments.filter(c => c.id !== id);
    _delCommit(id);
  }

  async function _syncCommit(c) {
    if (!_client) return;
    const uid = await _uid();
    const { error } = await _client.from('commitments').upsert(_commitToDb(c, uid));
    if (error) console.error('[Data] sync commitment:', error.message);
  }

  async function _delCommit(id) {
    if (!_client) return;
    const uid = await _uid();
    const { error } = await _client.from('commitments').delete().eq('user_id', uid).eq('id', id);
    if (error) console.error('[Data] delete commitment:', error.message);
  }

  // ─────────────────────────────────────────────
  // One List (2026-11-25) — statuses: open / done / recurring / idea.
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

  // Append-only event log. Optimistic like everything else.
  function logEvent(taskId, event, minutes) {
    if (!_state.events) _state.events = [];
    const e = {
      id: 'e' + Date.now() + Math.random().toString(36).slice(2, 7),
      taskId, event, at: new Date().toISOString(), minutes: minutes ?? null,
    };
    _state.events.push(e);
    _syncEvent(e);
    return e;
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
      recurrence: null, recurrenceSeriesId: null, recurrenceWeekdays: null, recurrenceMonthDay: null,
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
    if (task.todayDate) logEvent(id, 'pulled');
    return task;
  }

  function pullToToday(id) {
    const t = _state.tasks.find(x => x.id === id); if (!t) return;
    if (t.status === 'idea') t.status = 'open';
    t.todayDate = localToday();
    t.todayOrder = _nextTodayOrder();
    upsertTask(t);
    logEvent(id, 'pulled');
  }

  function sendBack(id) {
    const t = _state.tasks.find(x => x.id === id); if (!t) return;
    t.todayDate = ''; t.todayOrder = null;
    upsertTask(t);
    logEvent(id, 'sent_back');
  }

  // ids = the full Today order, top first.
  function reorderToday(ids) {
    ids.forEach((id, i) => {
      const t = _state.tasks.find(x => x.id === id);
      if (t && t.todayOrder !== i + 1) { t.todayOrder = i + 1; upsertTask(t); }
    });
  }

  // completeTask — archives immediately (same path as the midnight auto-archive), stamped
  // with dateStr (default today), and logs `done` with any focus minutes from this session.
  // Recurrence spawning is UI-side (app.js _maybeSpawnRecurrence) and must run before this.
  function completeTask(id, { minutes, dateStr } = {}) {
    const t = _state.tasks.find(x => x.id === id); if (!t) return;
    logEvent(id, 'done', minutes || null);
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

  // ─────────────────────────────────────────────
  // syncAll — pushes entire in-memory state to Supabase.
  // Called by _migrateData() in app.js after fixing legacy status values.
  // ─────────────────────────────────────────────

  async function syncAll() {
    if (!_client || !_state) return;
    const uid = await _uid();
    await Promise.all([
      ..._state.projects.map(p => _client.from('projects').upsert(_projToDb(p, uid))),
      ..._state.tasks.map(t => _client.from('tasks').upsert(_taskToDb(t, uid))),
    ]);
  }

  // ─────────────────────────────────────────────
  // replaceAll (import backup) — updates _state immediately,
  // wipes + re-inserts in Supabase in the background.
  // ─────────────────────────────────────────────

  function replaceAll(newState) {
    _state = newState;
    if (!_state.archive) _state.archive = [];
    _replaceAllAsync(newState); // fire-and-forget
  }

  async function _replaceAllAsync(newState) {
    if (!_client) return;
    const uid = await _uid();
    // Wipe existing rows for this user
    await Promise.all([
      _client.from('projects').delete().eq('user_id', uid),
      _client.from('tasks').delete().eq('user_id', uid),
      _client.from('archive').delete().eq('user_id', uid),
    ]);
    const ops = [];
    if (newState.projects?.length) ops.push(_client.from('projects').insert(newState.projects.map(p => _projToDb(p, uid))));
    if (newState.tasks?.length)    ops.push(_client.from('tasks').insert(newState.tasks.map(t => _taskToDb(t, uid))));
    if (newState.archive?.length)  ops.push(_client.from('archive').insert(newState.archive.map(a => _archToDb(a, uid))));
    const results = await Promise.all(ops);
    results.forEach(({ error }) => { if (error) console.error('[Data] replaceAll insert error:', error.message); });
  }

  // ─────────────────────────────────────────────
  // Compat shims — save() is now a no-op.
  // All former call sites in app.js have been updated to call the
  // appropriate upsert function directly (see app.js change log).
  // showSaveBanner/hideSaveBanner kept for the export button UI.
  // ─────────────────────────────────────────────

  function save()    { /* no-op: mutations sync individually via upsert* */ }
  function saveNow() { /* no-op */ }
  function isDirty() { return false; }

  function showSaveBanner() {
    const b = document.getElementById('save-banner');
    if (b) b.style.display = 'flex';
  }
  function hideSaveBanner() {
    const b = document.getElementById('save-banner');
    if (b) b.style.display = 'none';
  }

  return {
    setClient,
    load, get, getAllItems, findItem, findProject,
    upsertProject, upsertTask, deleteItem,
    archiveItem, archiveItemWithDate, restoreFromArchive, deleteFromArchive, clearArchive,
    upsertTag, deleteTag,
    upsertCommitment, deleteCommitment,
    // One List
    AREAS, localToday, addTask, pullToToday, sendBack, reorderToday, completeTask, logEvent,
    todayList, openTasks, recurringTasks, ideas, events,
    syncAll, replaceAll,
    save, saveNow, isDirty,
    showSaveBanner, hideSaveBanner,
  };
})();
