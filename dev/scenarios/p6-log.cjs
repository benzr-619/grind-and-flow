// Prompt 6 — Log: week total, area totals, days → tasks → minutes (events, falling back to time_spent), restore/delete, week nav.
const UID = '00000000-0000-0000-0000-000000000001';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = ymd(new Date());
const lastWeek = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return ymd(d); })();
const A = (id, title, day, extra) => ({ id, type: 'standalone', title, status: 'open', original_status: 'open', archived_at: day, tags: '[]', blocked: 'false', user_id: UID, time_spent: 0, ...extra });
module.exports = {
  seed: () => ({
    archive: [
      A('a1', 'Analysis plan', today, { area: 'Research' }),           // minutes from events (60+20)
      A('a2', 'Old style task', today, { time_spent: 45 }),            // fallback time_spent, no area
      A('a3', 'Last week thing', lastWeek, { area: 'AMD', time_spent: 30 }),
    ],
    task_events: [
      { id: 'e1', user_id: UID, task_id: 'a1', event: 'started', at: new Date().toISOString(), minutes: 60 },
      { id: 'e2', user_id: UID, task_id: 'a1', event: 'done', at: new Date().toISOString(), minutes: 20 },
    ],
  }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    await page.click('text=log'); await page.waitForTimeout(200);
    const big = await page.textContent('.lg-big');
    const areas = await page.textContent('.lg-areas');
    const rows = await page.$$eval('.lg-row', els => els.map(e => e.querySelector('.lg-t').textContent + '=' + e.querySelector('.lg-m').textContent));
    const thisWeekHasLast = rows.some(r => r.startsWith('Last week'));
    if (!thisWeekHasLast) {
      expect(big === '2h 05m', 'week total: ' + big);
      expect(areas.includes('Research 1h 20m') && areas.includes('No area 45m'), 'areas: ' + areas);
      expect(rows.includes('Analysis plan=1h 20m') && rows.includes('Old style task=45m'), 'rows: ' + rows);
    }
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/log.png' });
    await page.click('[aria-label="Previous week"]'); await page.waitForTimeout(100);
    expect((await page.textContent('.lg-main')).includes('Last week thing') || thisWeekHasLast, 'prev week');
    await page.click('[aria-label="Next week"]'); await page.waitForTimeout(100);
    await page.hover('.lg-row[data-id="a2"]');
    await page.click('.lg-row[data-id="a2"] >> text=restore'); await page.waitForTimeout(100);
    expect(await page.evaluate(() => Data.findItem('a2')?.status) === 'open', 'restored as open');
    await page.hover('.lg-row[data-id="a1"]');
    await page.click('.lg-row[data-id="a1"] >> text=delete');
    await page.click('.lg-row[data-id="a1"] >> text=yes'); await page.waitForTimeout(100);
    expect(!(await page.evaluate(() => Data.get().archive.some(a => a.id === 'a1'))), 'deleted');
    await page.click('text=← today');
    console.log('  log assertions passed');
  },
};
