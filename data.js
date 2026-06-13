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

  function _tagFromDb(r) {
    return {
      name:      r.name,
      colorSlot: r.color_slot ?? null,
    };
  }

  function _tagToDb(t, uid) {
    return {
      user_id:    uid,
      name:       t.name,
      color_slot: t.colorSlot ?? null,
    };
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
      _state = { projects: [], tasks: [], archive: [], tags: [] };
      return _state;
    }
    await _migrateFromLocalStorage();
    try {
      const uid = await _uid();
      await _migrateTagsFromLocalStorage(uid);
      const [pr, tr, ar, tg] = await Promise.all([
        _client.from('projects').select('*').eq('user_id', uid),
        _client.from('tasks').select('*').eq('user_id', uid),
        _client.from('archive').select('*').eq('user_id', uid),
        _client.from('tags').select('*').eq('user_id', uid),
      ]);
      if (pr.error) throw pr.error;
      if (tr.error) throw tr.error;
      if (ar.error) console.warn('[Data] archive load error:', ar.error.message);
      if (tg.error) console.warn('[Data] tags load error:', tg.error.message);
      _state = {
        projects: (pr.data || []).map(_projFromDb),
        tasks:    (tr.data || []).map(_taskFromDb),
        archive:  (ar.data || []).map(_archFromDb),
        tags:     (tg.data || []).map(_tagFromDb),
      };
    } catch (e) {
      console.error('[Data] load failed:', e.message);
      _state = { projects: [], tasks: [], archive: [], tags: [] };
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

  function upsertTag(name, colorSlot) {
    const tag = { name, colorSlot: colorSlot ?? null };
    const idx = _state.tags.findIndex(t => t.name === name);
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
    syncAll, replaceAll,
    save, saveNow, isDirty,
    showSaveBanner, hideSaveBanner,
  };
})();
