// Ranking telemetry in task_events.meta: offered → pull #3 → reorder → complete → send back,
// the lazy day_snapshot on load (with dedup), and a simulated day change mid-session.
const UID = '00000000-0000-0000-0000-000000000001';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const today = daysAgo(0);
const T = (id, title, extra) => ({ id, type: 'standalone', title, status: 'open', date_added: daysAgo(20), tags: [], user_id: UID, ...extra });
module.exports = {
  seed: () => ({
    tasks: [
      T('o1', 'Urgent reply', { urgency: 'asap', area: 'AMD' }),
      T('o2', 'Grant budget', { due_date: daysAgo(-3), area: 'Research' }),
      T('o3', 'Plain thing', {}),
      T('o4', 'Someday closet', { urgency: 'norush' }),
      T('r1', 'Clean fountain', { status: 'recurring', recurrence: 'rolling', recurrence_interval_n: 5, recurrence_interval_unit: 'days', scheduled_date: today }),
      // leftovers on the most recent prior Today (2 days ago) + an older one that must be ignored
      T('y1', 'Left one', { today_date: daysAgo(2), today_order: 1 }),
      T('y2', 'Left two (already snapshotted)', { today_date: daysAgo(2), today_order: 4 }),
      T('y3', 'Left three', { today_date: daysAgo(2), today_order: 6 }),
      T('z1', 'Older leftover', { today_date: daysAgo(5), today_order: 1 }),
    ],
    task_events: [{ id: 'ex1', user_id: UID, task_id: 'y2', event: 'day_snapshot', at: new Date().toISOString(), minutes: null, meta: { date: daysAgo(2), position: 2, todaySize: 3 } }],
  }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const evs = (type, id) => page.evaluate(([type, id]) => Data.events().filter(e => e.event === type && (!id || e.taskId === id)), [type, id]);
    const synced = () => page.evaluate(() => window.__FAKE_DB.task_events);

    // ── day_snapshot on load: y1 + y3 only (y2 deduped, z1 not the most recent day) ──
    let snaps = await evs('day_snapshot');
    const fresh = snaps.filter(e => e.id !== 'ex1');
    expect(fresh.length === 2, 'two new snapshots: ' + JSON.stringify(fresh));
    const s1 = fresh.find(e => e.taskId === 'y1'), s3 = fresh.find(e => e.taskId === 'y3');
    expect(s1 && s1.meta.date === daysAgo(2) && s1.meta.position === 1 && s1.meta.todaySize === 3 && s1.meta.order === 1, 'y1 snapshot: ' + JSON.stringify(s1));
    expect(s3 && s3.meta.position === 3 && s3.meta.order === 6, 'y3 snapshot: ' + JSON.stringify(s3));
    await page.evaluate(() => Data.snapshotPriorDay());
    expect((await evs('day_snapshot')).length === 3, 'snapshot idempotent');

    // ── offered: rank (display order), score = Σ parts, pinned recurring ──
    const offIds = await page.$$eval('.ol-off-row', els => els.map(e => e.dataset.id));
    expect(offIds[0] === 'r1', 'recurring pinned first: ' + offIds);
    const off = await evs('offered');
    expect(off.length === offIds.length, `offered once per shown row (${off.length} vs ${offIds.length})`);
    for (const [i, id] of offIds.entries()) {
      const e = off.find(x => x.taskId === id);
      expect(e && e.meta.rank === i + 1, `rank of ${id}: ` + JSON.stringify(e?.meta));
      if (id === 'r1') expect(e.meta.pinned === true && e.meta.score === undefined, 'pinned meta');
      else expect(Object.values(e.meta.parts).reduce((a, b) => a + b, 0) === e.meta.score, `parts sum for ${id}`);
    }
    const o1 = off.find(x => x.taskId === 'o1').meta;
    expect(o1.parts.asap === 50 && o1.parts.age === 2, 'o1 parts: ' + JSON.stringify(o1.parts));
    expect(off.find(x => x.taskId === 'o4').meta.parts.norush === -40, 'norush part');
    // still once per task per day across re-renders
    await page.evaluate(() => App.olGo('everything')); await page.waitForTimeout(300);
    await page.evaluate(() => App.olGo('today')); await page.waitForTimeout(300);
    expect((await evs('offered')).length === off.length, 'no duplicate offered events');

    // ── pull the #3 row from Offered, then two more ──
    const third = offIds[2];
    const thirdScore = off.find(x => x.taskId === third).meta.score;
    await page.click(`.ol-off-row[data-id="${third}"] .ol-add`); await page.waitForTimeout(300);
    let p = (await evs('pulled', third))[0];
    expect(p && p.meta.from === 'offered' && p.meta.offeredRank === 3 && p.meta.toPosition === 1 && p.meta.score === thirdScore && p.meta.parts, 'pull #3 meta: ' + JSON.stringify(p?.meta));
    await page.click('.ol-off-row[data-id="o1"] .ol-add'); await page.waitForTimeout(300);
    expect((await evs('pulled', 'o1'))[0].meta.toPosition === 2, 'second pull → position 2');
    await page.evaluate(() => App._odToday('o3', true)); // the detail popover's "add to Today"
    p = (await evs('pulled', 'o3'))[0];
    expect(p.meta.from === 'detail' && p.meta.offeredRank === null && p.meta.toPosition === 3 && typeof p.meta.score === 'number', 'detail pull meta: ' + JSON.stringify(p.meta));
    let todayIds = await page.$$eval('.ol-li', els => els.map(e => e.dataset.id));
    expect(todayIds.join() === `${third},o1,o3`, 'today order: ' + todayIds);

    // ── reorder: drag o3 to the top ──
    await page.dragAndDrop('.ol-li[data-id="o3"]', '.ol-li:first-child', { targetPosition: { x: 40, y: 5 } });
    const ro = await evs('reordered', 'o3');
    expect(ro.length === 1 && ro[0].meta.from === 3 && ro[0].meta.to === 1 && ro[0].meta.todaySize === 3, 'reordered meta: ' + JSON.stringify(ro));
    await page.dragAndDrop('.ol-li[data-id="o3"]', '.ol-li:first-child', { targetPosition: { x: 40, y: 5 } }); // no-op drop
    expect((await evs('reordered')).length === 1, 'no event when position unchanged');

    // ── complete the #2 item, send back the new #2 ──
    todayIds = await page.$$eval('.ol-li', els => els.map(e => e.dataset.id)); // o3, third, o1
    await page.hover(`.ol-li[data-id="${todayIds[1]}"]`);
    await page.click(`.ol-li[data-id="${todayIds[1]}"] .ol-done`); await page.waitForTimeout(300);
    const d = (await evs('done', todayIds[1]))[0];
    expect(d && d.meta.position === 2 && d.meta.todaySize === 3 && d.minutes === null, 'done meta: ' + JSON.stringify(d));
    await page.hover('.ol-li[data-id="o1"]');
    await page.click('.ol-li[data-id="o1"] .ol-notoday'); await page.waitForTimeout(300);
    const sb = (await evs('sent_back', 'o1'))[0];
    expect(sb && sb.meta.position === 2, 'sent_back meta: ' + JSON.stringify(sb));

    // ── recurring completion from Offered (not on Today → position null) ──
    await page.click('.ol-off-row[data-id="r1"] .ol-off-check'); await page.waitForTimeout(400);
    const rd = (await evs('done', 'r1'))[0];
    expect(rd && rd.meta.position === null && rd.meta.todaySize === 1, 'recurring done meta: ' + JSON.stringify(rd));

    // ── Focus Done: minutes accounting unchanged, plus position ──
    await page.evaluate(() => { App.startTask('o3'); App.markDoingDone('o3'); });
    const fd = (await evs('done', 'o3'))[0];
    expect(fd && fd.meta.position === 1 && fd.meta.todaySize === 1, 'focus done meta: ' + JSON.stringify(fd));
    expect((await evs('started', 'o3')).length === 1, 'started logged');
    await page.evaluate(() => App.focusBackToToday());

    // ── day change mid-session: leave o2 on Today, jump the clock a day, run the midnight path ──
    await page.evaluate(() => App._odToday('o2', true));
    await page.evaluate(() => {
      const R = Date, off = 86400000;
      window.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(R.now() + off); } static now() { return R.now() + off; } };
      Data.snapshotPriorDay(); Data.snapshotPriorDay();
    });
    const ds = (await evs('day_snapshot', 'o2'));
    expect(ds.length === 1 && ds[0].meta.date === today && ds[0].meta.position === 1 && ds[0].meta.todaySize === 1, 'day-change snapshot: ' + JSON.stringify(ds));

    // ── everything reached the (fake) DB with meta ──
    const db = await synced();
    expect(db.find(r => r.event === 'reordered')?.meta?.to === 1, 'meta synced to task_events');
    console.log('  telemetry assertions passed');
  },
};
