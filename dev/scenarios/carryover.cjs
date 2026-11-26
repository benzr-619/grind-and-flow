// Offered carry-over tiebreak: equal scores → lower last day_snapshot position first.
// sent_back gives no advantage (its position is ignored, and it cancels an earlier snapshot);
// snapshots older than 3 days don't count. Scores and "why" are unchanged.
const UID = '00000000-0000-0000-0000-000000000001';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const ago = h => new Date(Date.now() - h * 3600000).toISOString();
const T = (id, title, extra) => ({ id, type: 'standalone', title, status: 'open', date_added: daysAgo(20), tags: [], user_id: UID, ...extra });
const E = (id, task_id, event, at, meta) => ({ id, user_id: UID, task_id, event, at, minutes: null, meta });
module.exports = {
  seed: () => ({
    tasks: [
      // left on yesterday's Today (both get the same +30) — without the tiebreak, a1 sorts first by id
      T('a1', 'Was fifth yesterday', { today_date: daysAgo(1), today_order: 5 }),
      T('a2', 'Was first yesterday', { today_date: daysAgo(1), today_order: 1 }),
      // equal scores, none should get an advantage → plain id order c1, c2, c3, d1, d2
      T('c1', 'Plain'),
      T('c2', 'Sent back only'),
      T('c3', 'Snapshot then sent back'),
      T('d1', 'Plain two'),
      T('d2', 'Old snapshot'),
    ],
    task_events: [
      E('s1', 'a1', 'day_snapshot', ago(2), { date: daysAgo(1), position: 5, todaySize: 5 }),
      E('s2', 'a2', 'day_snapshot', ago(2), { date: daysAgo(1), position: 1, todaySize: 5 }),
      E('s3', 'c2', 'sent_back', ago(30), { position: 1 }),
      E('s4', 'c3', 'day_snapshot', ago(20), { date: daysAgo(1), position: 1, todaySize: 3 }),
      E('s5', 'c3', 'sent_back', ago(1), { position: 1 }),
      E('s6', 'd2', 'day_snapshot', ago(24 * 5), { date: daysAgo(5), position: 1, todaySize: 2 }),
    ],
  }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const ids = await page.$$eval('.ol-off-row', els => els.map(e => e.dataset.id));
    expect(ids.join() === 'a2,a1,c1,c2,c3,d1,d2', 'offered order: ' + ids);
    const why = await page.$$eval('.ol-off-why', els => els.map(e => e.textContent));
    expect(why[0] === 'on Today yesterday' && why[1] === 'on Today yesterday', 'why unchanged: ' + why);
    const off = await page.evaluate(() => Data.events().filter(e => e.event === 'offered'));
    const m = id => off.find(e => e.taskId === id).meta;
    expect(m('a2').score === m('a1').score && m('c1').score === m('c3').score, 'scores equal (tiebreak only)');
    expect(m('a2').rank === 1 && m('a1').rank === 2 && m('c3').rank === 5, 'offered rank follows the final sort');
    expect(await page.evaluate(() => Data.events().filter(e => e.event === 'day_snapshot').length) === 4, 'load did not re-snapshot a1/a2');
    console.log('  carry-over assertions passed');
  },
};
