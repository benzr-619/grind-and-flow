// Prompt 3 — Today: entry bar Tab flow, Offered ranking, pull, reorder, done, not-today, I'm set.
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const T = (id, title, extra) => ({ id, type: 'standalone', title, status: 'open', date_added: daysAgo(20), tags: [], user_id: '00000000-0000-0000-0000-000000000001', ...extra });
module.exports = {
  seed: () => ({ tasks: [
    T('t1', 'Old thing', {}),
    T('t2', 'Urgent reply', { urgency: 'asap', area: 'AMD' }),
    T('t3', 'Grant budget', { due_date: daysAgo(-3), area: 'Research' }),
    T('t4', 'Someday closet', { urgency: 'norush', area: 'Home' }),
    T('t5', 'Clean fountain', { status: 'recurring', recurrence: 'rolling', recurrence_interval_n: 5, recurrence_interval_unit: 'days', scheduled_date: today, area: 'Home' }),
    T('t6', 'Was on today', { today_date: daysAgo(1), today_order: 1 }),
  ] }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const offered = async () => page.$$eval('.ol-off-title', els => els.map(e => e.textContent));
    let off = await offered();
    expect(off[0] === 'Clean fountain', 'recurring pinned first: ' + off);
    expect(off[1] === 'Urgent reply', 'asap next: ' + off);
    expect(off[off.length - 1] === 'Someday closet', 'norush last: ' + off);
    const why = await page.$$eval('.ol-off-why', els => els.map(e => e.textContent));
    expect(why.some(w => w.includes('on Today yesterday')), 'carry-over reason: ' + why);
    // entry: title → tab → asap → tab → a → enter
    const inp = '#ol-input-today';
    await page.click(inp);
    await page.keyboard.type('Write the plan');
    await page.keyboard.press('Tab');
    await page.keyboard.type('asap');
    await page.keyboard.press('Tab');
    await page.keyboard.type('r');
    await page.keyboard.press('Enter');
    off = await offered();
    expect(off.includes('Write the plan'), 'saved to offered: ' + off);
    // shift+enter → Today, with inline shortcuts
    await page.keyboard.type('Call the bank #home by fri');
    await page.keyboard.press('Shift+Enter');
    let todayTitles = await page.$$eval('.ol-row-title', els => els.map(e => e.textContent));
    expect(todayTitles[0] === 'Call the bank', 'shift+enter to today: ' + todayTitles);
    // recurring via entry
    await page.keyboard.type('Water plants');
    await page.keyboard.press('Tab');
    await page.keyboard.type('every 2w');
    await page.keyboard.press('Enter');
    const rec = await page.evaluate(() => Data.recurringTasks().find(t => t.title === 'Water plants'));
    expect(rec && rec.recurrence === 'rolling' && rec.recurrenceIntervalUnit === 'weeks', 'recurring created');
    // backspace steps back
    await page.keyboard.type('abc');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Backspace');
    expect(await page.inputValue(inp) === 'abc', 'backspace steps back');
    await page.keyboard.press('Escape');
    expect(await page.inputValue(inp) === '', 'esc clears');
    // pull two from Offered
    await page.click('.ol-off-row[data-id="t2"] .ol-add'); await page.waitForTimeout(300);
    await page.click('.ol-off-row[data-id="t3"] .ol-add'); await page.waitForTimeout(300);
    todayTitles = await page.$$eval('.ol-row-title', els => els.map(e => e.textContent));
    expect(todayTitles.join('|') === 'Call the bank|Urgent reply|Grant budget', 'pulled: ' + todayTitles);
    expect(await page.$$eval('.ol-start', e => e.length) === 1, 'one start button');
    // drag Grant budget above Call the bank
    await page.dragAndDrop('.ol-li[data-id="t3"]', '.ol-li:first-child', { targetPosition: { x: 40, y: 5 } });
    todayTitles = await page.$$eval('.ol-row-title', els => els.map(e => e.textContent));
    expect(todayTitles[0] === 'Grant budget', 'reorder: ' + todayTitles);
    // not today + done
    await page.hover('.ol-li[data-id="t2"]');
    await page.click('.ol-li[data-id="t2"] .ol-notoday'); await page.waitForTimeout(300);
    await page.hover('.ol-li[data-id="t3"]');
    await page.click('.ol-li[data-id="t3"] .ol-done'); await page.waitForTimeout(300);
    todayTitles = await page.$$eval('.ol-row-title', els => els.map(e => e.textContent));
    expect(todayTitles.join('|') === 'Call the bank', 'after done/back: ' + todayTitles);
    expect(await page.evaluate(() => Data.get().archive.some(a => a.id === 't3')), 'archived');
    // recurring check-off from Offered spawns next
    await page.click('.ol-off-row[data-id="t5"] .ol-off-check'); await page.waitForTimeout(400);
    const spawned = await page.evaluate(() => Data.recurringTasks().filter(t => t.title === 'Clean fountain').length);
    expect(spawned === 1, 'recurring respawned');
    // I'm set
    await page.click('.ol-set');
    expect(await page.$('.ol-show-off'), 'collapsed');
    await page.click('.ol-show-off');
    expect(await page.$('.ol-set'), 'restored');
    // nav
    await page.click('text=zoom out'); await page.waitForTimeout(200);
    await page.click('text=back to today'); await page.waitForTimeout(200);
    await page.click('text=log'); await page.waitForTimeout(200);
    await page.click('text=← today'); await page.waitForTimeout(200);
    console.log('  today assertions passed');
  },
};
