// Prompt 5 — Everything: zoom out, clusters, regroup glide, entry bar, inline detail, ~60 items.
const UID = '00000000-0000-0000-0000-000000000001';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const AREAS = ['Research', 'AMD', 'EDBA', 'Home', null];
const WORDS = ['Draft', 'Review', 'Email', 'Plan', 'Fix', 'Read', 'Call', 'Order', 'Update', 'Write'];
const OBJ = ['the grant budget', 'ops dashboard', 'reviewer 2 comments', 'board fellow call', 'closet', 'CV publications', 'triage pilot data', 'speaker shortlist', 'desk leg', 'variable definitions doc'];
module.exports = {
  seed: () => {
    const tasks = [];
    for (let i = 0; i < 56; i++) {
      tasks.push({ id: 'x' + i, type: 'standalone', title: `${WORDS[i % 10]} ${OBJ[(i * 7) % 10]} ${i}`, status: i % 11 === 0 ? 'idea' : 'open',
        area: AREAS[i % 5], urgency: i % 9 === 0 ? 'asap' : i % 13 === 0 ? 'norush' : null, date_added: ago(i * 3), tags: [], user_id: UID,
        today_date: i < 3 ? ymd(new Date()) : null, today_order: i < 3 ? i + 1 : null });
    }
    tasks.push({ id: 'r1', type: 'standalone', title: 'Clean cat fountain', status: 'recurring', recurrence: 'rolling', recurrence_interval_n: 5, recurrence_interval_unit: 'days', scheduled_date: ago(-2), area: 'Home', tags: [], user_id: UID, date_added: ago(10) });
    return { tasks };
  },
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    await page.click('text=zoom out'); await page.waitForTimeout(1200);
    expect(await page.$$eval('.ev-it', e => e.length) === 57, 'all items shown');
    const labels = async () => page.$$eval('.ev-label', e => e.map(x => x.textContent.trim()));
    expect((await labels()).some(l => l.startsWith('No area')), 'no area cluster: ' + await labels());
    expect((await labels()).some(l => l.startsWith('Ideas')), 'ideas cluster');
    expect(await page.$$eval('.ev-dot.today', e => e.length) === 2, 'today dots');
    expect(await page.$$eval('.ev-dot.idea', e => e.length) === 6, 'idea dots');
    // legibility: no two items overlap
    const overlaps = await page.$$eval('.ev-drift', els => {
      const rs = els.map(e => e.getBoundingClientRect()); let n = 0;
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 4 && b.top < a.bottom - 4) n++;
      }
      return n;
    });
    expect(overlaps === 0, 'overlapping items: ' + overlaps);
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/everything-area.png' });
    const before = await page.$eval('.ev-it[data-id="x5"]', e => e.style.left + e.style.top);
    await page.click('.ev-mode >> text=urgency'); await page.waitForTimeout(1100);
    expect((await labels()).some(l => l.startsWith('Now')), 'urgency labels');
    const after = await page.$eval('.ev-it[data-id="x5"]', e => e.style.left + e.style.top);
    expect(before !== after, 'item moved on regroup');
    await page.click('.ev-mode >> text=date entered'); await page.waitForTimeout(1100);
    expect((await labels()).some(l => l.startsWith('Older')), 'entered labels');
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/everything-entered.png' });
    // add via entry bar
    await page.click('#ol-input-everything');
    await page.keyboard.type('idea: stats series for residents #research');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    expect(await page.evaluate(() => Data.ideas().some(t => t.title === 'stats series for residents' && t.area === 'Research')), 'idea added');
    // detail: open a normal task, set area + asap, add to Today
    await page.click('.ev-it[data-id="x7"] .ev-drift', { force: true }); await page.waitForTimeout(200);
    expect(await page.$('#ol-detail'), 'detail open');
    await page.click('#ol-detail >> text=EDBA');
    await page.click('#ol-detail >> text=asap');
    await page.click('#ol-detail >> text=add to Today'); await page.waitForTimeout(200);
    const x7 = await page.evaluate(() => Data.findItem('x7'));
    expect(x7.area === 'EDBA' && x7.urgency === 'asap' && x7.todayDate, 'detail edits saved');
    await page.fill('#ol-detail .od-title', 'Renamed task');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    expect(await page.evaluate(() => Data.findItem('x7').title) === 'Renamed task', 'title saved on close');
    // idea → make a task
    await page.click('.ev-it[data-id="x11"] .ev-drift', { force: true }); await page.waitForTimeout(100);
    await page.click('#ol-detail >> text=make a task');
    expect(await page.evaluate(() => Data.findItem('x11').status) === 'open', 'idea made task');
    // delete
    await page.click('#ol-detail >> text=delete');
    await page.click('#ol-detail >> text=yes'); await page.waitForTimeout(100);
    expect(!(await page.evaluate(() => Data.findItem('x11'))), 'deleted');
    // recurring → modal
    await page.click('.ev-it[data-id="r1"] .ev-drift', { force: true }); await page.waitForTimeout(100);
    expect((await page.textContent('#ol-detail')).includes('every 5 days'), 'cadence shown');
    await page.click('#ol-detail >> text=edit recurrence');
    expect(await page.$('#rm-title'), 'recurring modal opened');
    await page.click('text=Cancel');
    await page.click('text=back to today'); await page.waitForTimeout(700);
    expect(await page.$('.ol-today'), 'back on today');
    // detail from Today title
    await page.click('.ol-li[data-id="x1"] .ol-row-title'); await page.waitForTimeout(100);
    expect(await page.$('#ol-detail'), 'detail from today');
    await page.mouse.click(5, 5);
    console.log('  everything assertions passed');
  },
};
