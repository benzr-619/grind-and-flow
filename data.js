// data.js — all persistence logic

const DB_PATH = 'data.json';

const DEFAULT_DATA = {
  projects: [
    {id:'p1',type:'project',title:'EDBA',status:'active',dueDate:'2026-06-03',scheduledDate:'',notes:'Acep June 3rd',dateAdded:'2026-04-10',subtasks:[{id:'st1',title:'Email Mike & Jim',done:false,promoted:false},{id:'st2',title:'Case write-up',done:false,promoted:false}],blocked:false},
    {id:'p2',type:'project',title:'NO WAIT ED',status:'active',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-03-15',subtasks:[{id:'st3',title:'Meet with Surgery',done:true,promoted:false},{id:'st4',title:'Review data',done:false,promoted:false},{id:'st5',title:'Draft proposal',done:false,promoted:false}],blocked:false},
    {id:'p3',type:'project',title:'Pebbles',status:'active',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-04-01',subtasks:[{id:'st6',title:'Sketchout plan',done:false,promoted:false},{id:'st7',title:'Read IHI pebbles frame',done:false,promoted:false}],blocked:false},
    {id:'p4',type:'project',title:'LLM Research Project',status:'active',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-05-01',subtasks:[],blocked:false},
    {id:'p5',type:'project',title:'QA Re-design',status:'up-next',dueDate:'',scheduledDate:'2026-06-15',notes:'',dateAdded:'2026-04-20',subtasks:[{id:'st8',title:'Meet with Surgery',done:false,promoted:false}],blocked:false},
    {id:'p6',type:'project',title:'Leadership Development Plan',status:'up-next',dueDate:'2026-06-12',scheduledDate:'',notes:'',dateAdded:'2026-05-10',subtasks:[],blocked:false},
    {id:'p7',type:'project',title:'PEDS RVP TAT',status:'on-deck',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-04-05',subtasks:[{id:'st9',title:'Follow-up after Strike',done:false,promoted:false},{id:'st10',title:'1st meeting agenda',done:false,promoted:false}],blocked:false},
    {id:'p8',type:'project',title:'YPS Committee',status:'on-deck',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-03-20',subtasks:[],blocked:false},
    {id:'p9',type:'project',title:'HS-Trop',status:'on-hold',dueDate:'',scheduledDate:'',notes:'Shared report – no rush from Chris',dateAdded:'2026-02-10',subtasks:[],blocked:true},
    {id:'p10',type:'project',title:'BBF Exposure',status:'on-hold',dueDate:'',scheduledDate:'',notes:'Tell Vjay he can stop?',dateAdded:'2026-01-15',subtasks:[{id:'st11',title:'Review monthly data',done:false,promoted:false}],blocked:true},
    {id:'p11',type:'project',title:'Triage mis-match idea',status:'someday',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-03-01',subtasks:[],blocked:false},
    {id:'p12',type:'project',title:'Anti-fragility',status:'someday',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-02-20',subtasks:[],blocked:false},
    {id:'p13',type:'project',title:'Bronxville/Westchester Outreach',status:'someday',dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-01-10',subtasks:[{id:'st12',title:'SDOH Alignment',done:false,promoted:false},{id:'st13',title:'Bystander CPR',done:false,promoted:false}],blocked:false},
  ],
  tasks: [
    {id:'t1',type:'task',title:'Build out EDBA research plan',status:'next',parentProject:'p1',dueDate:'2026-06-03',scheduledDate:'2026-05-25',notes:'',dateAdded:'2026-05-15',blocked:false},
    {id:'t2',type:'task',title:'Build out Pebble Plan',status:'next',parentProject:'p3',dueDate:'',scheduledDate:'2026-05-28',notes:'',dateAdded:'2026-05-18',blocked:false},
    {id:'t3',type:'standalone',title:'Spoonfeed subscription',status:'inbox',parentProject:null,dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-03-10',blocked:false},
    {id:'t4',type:'standalone',title:'Buy top 5 books',status:'inbox',parentProject:null,dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-04-01',blocked:false},
    {id:'t5',type:'standalone',title:'Watch AI show & Tell',status:'inbox',parentProject:null,dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-05-01',blocked:false},
    {id:'t6',type:'standalone',title:'Neonatal Resuscitation',status:'inbox',parentProject:null,dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-04-15',blocked:false},
    {id:'t7',type:'standalone',title:'Sodastream Bottles',status:'inbox',parentProject:null,dueDate:'',scheduledDate:'',notes:'',dateAdded:'2026-03-05',blocked:false},
  ],
  archive: []
};

const Data = (() => {
  let _state = null;

  async function load() {
    try {
      const res = await fetch(DB_PATH + '?t=' + Date.now());
      if (!res.ok) throw new Error('not found');
      _state = await res.json();
      // Ensure archive array exists for older data files
      if (!_state.archive) _state.archive = [];
    } catch (e) {
      console.log('No data file found, using defaults.');
      _state = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    return _state;
  }

  async function save() {
    try {
      await fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_state, null, 2)
      });
    } catch (e) {
      // Server doesn't support save endpoint (plain http.server) — silently skip.
      // Data is still live in memory for the session.
    }
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
    // If deleting a promoted task, un-promote the source subtask
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
    const archived = {
      ...item,
      archivedAt: new Date().toISOString().split('T')[0],
      originalStatus: item.status
    };
    _state.archive.push(archived);
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

  return { load, save, get, getAllItems, findItem, findProject, upsertProject, upsertTask, deleteItem, archiveItem, restoreFromArchive, deleteFromArchive };
})();
