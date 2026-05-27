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

const LEGACY_STORAGE_KEY = 'gf-data'; // read-only — used once for migration

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
      type:           p.type           || 'project',
      title:          p.title,
      status:         p.status,
      due_date:       p.dueDate        || null,
      scheduled_date: p.scheduledDate  || null,
      scheduled_time: p.scheduledTime  || null,
      notes:          p.notes          || '',
      date_added:     p.dateAdded      || null,
      blocked:        !!p.blocked,
      blocked_reason: p.blockedReason  || null,
      tags:           p.tags           || [],
      subtasks:       p.subtasks       || [],
    };
  }

  function _projFromDb(r) {
    return {
      id:            r.id,
      type:          r.type            || 'project',
      title:         r.title,
      status:        r.status,
      dueDate:       r.due_date        || '',
      scheduledDate: r.scheduled_date  || '',
      scheduledTime: r.scheduled_time  || '',
      notes:         r.notes           || '',
      dateAdded:     r.date_added      || '',
      blocked:       !!r.blocked,
      blockedReason: r.blocked_reason  || '',
      tags:          r.tags            || [],
      subtasks:      r.subtasks        || [],
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
    };
  }

  function _archFromDb(r) {
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
      blocked:        !!r.blocked,
      blockedReason:  r.blocked_reason         || '',
      tags:           r.tags                   || [],
      subtasks:       r.subtasks               || [],
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
    try {
      const uid = await _uid();
      // Skip if this user already has Supabase data
      const { data: existing } = await _client
        .from('projects').select('id').eq('user_id', uid).limit(1);
      if (existing && existing.length > 0) return;

      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const ls = JSON.parse(raw);
      if (!ls?.projects?.length && !ls?.tasks?.length) return;

      console.log('[Data] Migrating localStorage → Supabase…');
      const ops = [];
      if (ls.projects?.length)
        ops.push(_client.from('projects').insert(ls.projects.map(p => _projToDb(p, uid))));
      if (ls.tasks?.length)
        ops.push(_client.from('tasks').insert(ls.tasks.map(t => _taskToDb(t, uid))));
      if (ls.archive?.length)
        ops.push(_client.from('archive').insert(ls.archive.map(a => _archToDb(a, uid))));

      const results = await Promise.all(ops);
      results.forEach(({ error }) => {
        if (error) console.error('[Data] Migration insert error:', error.message);
      });
      console.log('[Data] Migration complete.');
    } catch (e) {
      console.warn('[Data] localStorage migration skipped:', e.message);
    }
  }

  // ─────────────────────────────────────────────
  // Load — async, called from App.init()
  // ─────────────────────────────────────────────

  async function load() {
    if (!_client) {
      console.error('[Data] load called before setClient()');
      _state = { projects: [], tasks: [], archive: [] };
      return _state;
    }
    await _migrateFromLocalStorage();
    try {
      const uid = await _uid();
      const [pr, tr, ar] = await Promise.all([
        _client.from('projects').select('*').eq('user_id', uid),
        _client.from('tasks').select('*').eq('user_id', uid),
        _client.from('archive').select('*').eq('user_id', uid),
      ]);
      if (pr.error) throw pr.error;
      if (tr.error) throw tr.error;
      if (ar.error) console.warn('[Data] archive load error:', ar.error.message);
      _state = {
        projects: (pr.data || []).map(_projFromDb),
        tasks:    (tr.data || []).map(_taskFromDb),
        archive:  (ar.data || []).map(_archFromDb),
      };
    } catch (e) {
      console.error('[Data] load failed:', e.message);
      _state = { projects: [], tasks: [], archive: [] };
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
    archiveItem, restoreFromArchive, deleteFromArchive,
    syncAll, replaceAll,
    save, saveNow, isDirty,
    showSaveBanner, hideSaveBanner,
  };
})();
