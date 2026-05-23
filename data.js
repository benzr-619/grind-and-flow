// data.js — localStorage persistence for GitHub Pages

const STORAGE_KEY = 'gf-data';

const DEFAULT_DATA = {
  "projects": [
    {"id":"p1","type":"project","title":"EDBA | COVID Research","status":"active","dueDate":"","scheduledDate":"","notes":"Mike said few weeks for 2025 data","dateAdded":"2026-04-10","subtasks":[],"blocked":false},
    {"id":"p2","type":"project","title":"NO WAIT ED","status":"someday","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-03-15","subtasks":[],"blocked":false},
    {"id":"p3","type":"project","title":"Pebbles/APEX","status":"active","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-04-01","subtasks":[{"id":"st6","title":"Sketchout plan","done":false,"promoted":false},{"id":"st7","title":"Read IHI pebbles frame","done":false,"promoted":false}],"blocked":false},
    {"id":"p4","type":"project","title":"LLM Research Project","status":"on-hold","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-01","subtasks":[],"blocked":true},
    {"id":"p5","type":"project","title":"QA Re-design","status":"up-next","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-04-20","subtasks":[],"blocked":false},
    {"id":"p6","type":"project","title":"Leadership Development Plan","status":"on-deck","dueDate":"2026-06-12","scheduledDate":"","notes":"","dateAdded":"2026-05-10","subtasks":[],"blocked":false},
    {"id":"p7","type":"project","title":"PEDS RVP TAT","status":"someday","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-04-05","subtasks":[{"id":"st9","title":"Follow-up after Strike","done":false,"promoted":false},{"id":"st10","title":"1st meeting agenda","done":false,"promoted":false}],"blocked":false},
    {"id":"p8","type":"project","title":"YPS Committee","status":"someday","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-03-20","subtasks":[],"blocked":false},
    {"id":"p9","type":"project","title":"HS-Trop","status":"on-hold","dueDate":"","scheduledDate":"","notes":"Shared report – no rush from Chris","dateAdded":"2026-02-10","subtasks":[],"blocked":true},
    {"id":"p10","type":"project","title":"BBF Exposure","status":"on-deck","dueDate":"","scheduledDate":"","notes":"Tell Vjay he can stop?","dateAdded":"2026-01-15","subtasks":[{"id":"st11","title":"Review monthly data","done":false,"promoted":false}],"blocked":true},
    {"id":"p11","type":"project","title":"Triage mis-match idea","status":"someday","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-03-01","subtasks":[],"blocked":false},
    {"id":"p12","type":"project","title":"Anti-fragility","status":"someday","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-02-20","subtasks":[],"blocked":false},
    {"id":"p13","type":"project","title":"Bronxville/Westchester Outreach","status":"someday","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-01-10","subtasks":[{"id":"st12","title":"SDOH Alignment","done":false,"promoted":false},{"id":"st13","title":"Bystander CPR","done":false,"promoted":false}],"blocked":false},
    {"id":"p1779507737869","type":"project","title":"EDBA | Member Survey","status":"up-next","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":false},
    {"id":"p1779507835423","type":"project","title":"Neurology Consult TAT","status":"on-hold","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":true},
    {"id":"p1779507852929","type":"project","title":"Marketing","status":"active","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":false},
    {"id":"p1779507857596","type":"project","title":"Strategy","status":"active","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":false},
    {"id":"p1779507863047","type":"project","title":"Yuna Collab","status":"active","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":true},
    {"id":"p1779507877583","type":"project","title":"Leadership Development Plan","status":"active","dueDate":"2026-06-12","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":false},
    {"id":"p1779507882184","type":"project","title":"Pharma","status":"active","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":false},
    {"id":"p1779507886263","type":"project","title":"Innovation","status":"active","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":false},
    {"id":"p1779507964246","type":"project","title":"SAEM Ops","status":"someday","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","subtasks":[],"blocked":false}
  ],
  "tasks": [
    {"id":"t1","type":"task","title":"Build out EDBA research plan","status":"next","parentProject":"p1","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-15","blocked":false},
    {"id":"t2","type":"task","title":"Build out Pebble Plan","status":"next","parentProject":"p3","dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-18","blocked":false},
    {"id":"t3","type":"standalone","title":"Spoonfeed subscription","status":"inbox","parentProject":null,"dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-03-10","blocked":false},
    {"id":"t4","type":"standalone","title":"Buy top 5 books","status":"inbox","parentProject":null,"dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-04-01","blocked":false},
    {"id":"t6","type":"standalone","title":"Neonatal Resuscitation","status":"inbox","parentProject":null,"dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-04-15","blocked":false},
    {"id":"t7","type":"standalone","title":"Sodastream Bottles","status":"inbox","parentProject":null,"dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-03-05","blocked":false},
    {"id":"t1779508082996","type":"standalone","title":"Bathroom Wire","status":"inbox","parentProject":null,"dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","blocked":false},
    {"id":"t1779508097669","type":"standalone","title":"Danny Meyer Chat","status":"inbox","parentProject":null,"dueDate":"","scheduledDate":"","notes":"","dateAdded":"2026-05-23","blocked":false}
  ],
  "archive": []
};

const Data = (() => {
  let _state = null;
  let _dirty = false;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        _state = JSON.parse(raw);
        if (!_state.archive) _state.archive = [];
      } else {
        // First load — seed with real data
        _state = JSON.parse(JSON.stringify(DEFAULT_DATA));
        _persist(); // Write to localStorage immediately
      }
    } catch(e) {
      console.warn('localStorage parse error, using defaults', e);
      _state = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    _dirty = false;
    return _state;
  }

  function _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
      _dirty = false;
    } catch(e) {
      console.error('localStorage write failed', e);
    }
  }

  // Debounced auto-save — writes 800ms after last change
  let _saveTimer = null;
  function save() {
    _dirty = true;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _persist();
      _dirty = false;
      hideSaveBanner();
    }, 800);
    showSaveBanner();
  }

  // Force immediate save (before export, before unload)
  function saveNow() {
    clearTimeout(_saveTimer);
    _persist();
  }

  function isDirty() { return _dirty; }

  function showSaveBanner() {
    const b = document.getElementById('save-banner');
    if (b) b.style.display = 'flex';
  }

  function hideSaveBanner() {
    const b = document.getElementById('save-banner');
    if (b) b.style.display = 'none';
  }

  function get() { return _state; }

  function getAllItems() {
    return [..._state.projects, ..._state.tasks];
  }

  function findItem(id) {
    return getAllItems().find(i => i.id === id);
  }

  function findProject(id) {
    return _state.projects.find(p => p.id === id);
  }

  function upsertProject(item) {
    const idx = _state.projects.findIndex(p => p.id === item.id);
    if (idx >= 0) _state.projects[idx] = item;
    else _state.projects.push(item);
    save();
  }

  function upsertTask(item) {
    const idx = _state.tasks.findIndex(t => t.id === item.id);
    if (idx >= 0) _state.tasks[idx] = item;
    else _state.tasks.push(item);
    save();
  }

  function deleteItem(id) {
    const item = findItem(id);
    if (!item) return;
    if (item.type === 'task' && item.parentProject) {
      const proj = findProject(item.parentProject);
      if (proj) {
        const st = proj.subtasks.find(s => s.title === item.title && s.promoted);
        if (st) st.promoted = false;
      }
    }
    _state.projects = _state.projects.filter(i => i.id !== id);
    _state.tasks = _state.tasks.filter(i => i.id !== id);
    save();
  }

  function archiveItem(id) {
    const item = findItem(id);
    if (!item) return;
    _state.archive.push({
      ...item,
      archivedAt: new Date().toISOString().split('T')[0],
      originalStatus: item.status
    });
    _state.projects = _state.projects.filter(i => i.id !== id);
    _state.tasks = _state.tasks.filter(i => i.id !== id);
    save();
  }

  function restoreFromArchive(id) {
    const item = _state.archive.find(i => i.id === id);
    if (!item) return;
    const restored = { ...item };
    delete restored.archivedAt;
    delete restored.originalStatus;
    if (restored.type === 'project') _state.projects.push(restored);
    else _state.tasks.push(restored);
    _state.archive = _state.archive.filter(i => i.id !== id);
    save();
  }

  function deleteFromArchive(id) {
    _state.archive = _state.archive.filter(i => i.id !== id);
    save();
  }

  function replaceAll(newState) {
    _state = newState;
    if (!_state.archive) _state.archive = [];
    _persist();
  }

  return {
    load, save, saveNow, isDirty, get,
    getAllItems, findItem, findProject,
    upsertProject, upsertTask, deleteItem,
    archiveItem, restoreFromArchive, deleteFromArchive,
    replaceAll
  };
})();
