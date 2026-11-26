// dev/fake-supabase.js — in-memory stand-in for supabase-js, used ONLY by dev/smoke.cjs.
// Served in place of the CDN script so the app boots with a fake session and seed data
// (window.__FAKE_DB), with no network and no real credentials.
(function () {
  const UID = '00000000-0000-0000-0000-000000000001';
  const db = window.__FAKE_DB = window.__FAKE_DB || {};
  ['projects','tasks','archive','tags','commitments','task_events'].forEach(t => { db[t] = db[t] || []; });
  window.__FAKE_LOG = [];
  function q(table) {
    const st = { table, op: 'select', filters: [], rows: null };
    const api = {
      select() { return api; },
      eq(k, v) { st.filters.push([k, v]); return api; },
      gte(k, v) { st.filters.push([k, v, 'gte']); return api; },
      order() { return api; }, limit() { return api; },
      upsert(rows) { st.op = 'upsert'; st.rows = [].concat(rows); return api; },
      insert(rows) { st.op = 'insert'; st.rows = [].concat(rows); return api; },
      delete() { st.op = 'delete'; return api; },
      then(res, rej) {
        const T = db[table] || (db[table] = []);
        const match = r => st.filters.every(([k, v, m]) => m === 'gte' ? r[k] >= v : r[k] === v);
        let out = { data: null, error: null };
        if (st.op === 'select') out.data = T.filter(match).map(r => ({ ...r }));
        else if (st.op === 'upsert' || st.op === 'insert') {
          st.rows.forEach(r => {
            const key = table === 'tags' ? (x => x.name === r.name) : (x => x.id === r.id);
            const i = T.findIndex(key);
            if (i >= 0) T[i] = { ...T[i], ...r }; else T.push({ ...r });
          });
        } else if (st.op === 'delete') {
          for (let i = T.length - 1; i >= 0; i--) if (match(T[i])) T.splice(i, 1);
        }
        window.__FAKE_LOG.push({ table, op: st.op, n: st.rows ? st.rows.length : 0 });
        return Promise.resolve(out).then(res, rej);
      },
    };
    return api;
  }
  const session = { user: { id: UID, email: 'test@example.test' }, access_token: 'fake' };
  window.supabase = {
    createClient() {
      return {
        from: q,
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          getUser: async () => ({ data: { user: session.user } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => {},
        },
      };
    },
  };
})();
