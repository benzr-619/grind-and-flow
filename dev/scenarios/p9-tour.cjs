// Prompt 9 — click through every remaining view and screenshot each (SHOT_DIR/tour-*.png).
const UID = '00000000-0000-0000-0000-000000000001';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const today = ymd(new Date());
const T = (id, title, extra) => ({ id, type: 'standalone', title, status: 'open', date_added: ago(5), tags: [], user_id: UID, ...extra });
module.exports = {
  seed: () => ({
    tasks: [
      T('a', 'Draft the RME limited-workup one-pager', { area: 'AMD', due_date: ago(-6), today_date: today, today_order: 1 }),
      T('b', 'Reply to cardiology about LifeNet review', { area: 'AMD', urgency: 'asap', today_date: today, today_order: 2 }),
      T('c', 'Write the analysis plan for the COVID trends paper', { area: 'Research', today_date: today, today_order: 3 }),
      T('d', 'Pull weekly ops data for Monday', { area: 'AMD', urgency: 'asap' }),
      T('e', 'RISE grant budget justification', { area: 'Research', due_date: ago(-8) }),
      T('f', 'Shortlist Innovations 2027 speakers', { area: 'EDBA', today_date: ago(2) }),
      T('g', 'Order soil for the fiddle leaf', { area: 'Home', date_added: ago(1) }),
      T('i', 'Stats basics series for residents', { area: 'Research', status: 'idea' }),
      T('r1', 'Clean cat fountain', { status: 'recurring', recurrence: 'rolling', recurrence_interval_n: 5, recurrence_interval_unit: 'days', scheduled_date: today, area: 'Home' }),
      T('r2', 'Pay rent', { status: 'recurring', recurrence: 'anchored', recurrence_month_day: 1, due_date: today, area: 'Home' }),
    ],
    archive: [{ id: 'z1', type: 'standalone', title: 'Prep for EDBA board fellow call', status: 'open', archived_at: today, area: 'EDBA', time_spent: 40, tags: '[]', blocked: 'false', user_id: UID }],
  }),
  run: async (page) => {
    const D = process.env.SHOT_DIR || '.';
    const shot = n => page.screenshot({ path: `${D}/tour-${n}.png` });
    await shot('today');
    await page.click('.ol-row-title >> nth=0'); await page.waitForTimeout(150); await shot('detail'); await page.keyboard.press('Escape');
    await page.click('text=zoom out'); await page.waitForTimeout(1200); await shot('everything');
    await page.click('.ev-it[data-id="r1"] .ev-drift', { force: true });
    await page.click('#ol-detail >> text=edit recurrence'); await page.waitForTimeout(250); await shot('recur-modal');
    await page.click('text=Cancel');
    await page.click('text=back to today'); await page.waitForTimeout(700);
    await page.click('.ol-off-row[data-id="r2"] .ol-off-check'); await page.waitForTimeout(250); await shot('anchored-confirm');
    await page.click('text=Use suggestion'); await page.waitForTimeout(200);
    await page.click('.ol-start'); await page.waitForTimeout(900); await shot('focus');
    await page.click('#focus-orb-controls >> text=Back to Today'); await page.waitForTimeout(300);
    await page.click('text=log'); await page.waitForTimeout(200); await shot('log');
    await page.click('text=← today');
    console.log('  tour done');
  },
};
