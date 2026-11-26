// Prompt 8 — phone stopgap (run with --mobile): numbered Today, due recurring, tap/swipe complete + undo, capture chips.
const UID = '00000000-0000-0000-0000-000000000001';
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
const T = (id, title, order, extra) => ({ id, type: 'standalone', title, status: 'open', date_added: today, tags: [], user_id: UID, today_date: today, today_order: order, area: 'AMD', ...extra });
module.exports = {
  seed: () => ({ tasks: [
    T('a', 'RME one-pager', 1), T('b', 'Reply to cardiology', 2), T('c', 'COVID analysis plan', 3, { area: 'Research' }),
    { id: 'r', type: 'standalone', title: 'Clean cat fountain', status: 'recurring', recurrence: 'rolling', recurrence_interval_n: 5, recurrence_interval_unit: 'days', scheduled_date: today, area: 'Home', tags: [], user_id: UID },
  ] }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    expect(await page.isVisible('#mobile-app'), 'phone visible');
    expect(!(await page.isVisible('#ol-app')), 'desktop hidden');
    const nums = await page.$$eval('.ph-list:not(.ph-due) .ph-num', e => e.map(x => x.textContent));
    expect(nums.join() === '1,2,3', 'numbered: ' + nums);
    expect((await page.textContent('.ph-due')).includes('Clean cat fountain'), 'due recurring shown');
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/phone.png' });
    // tap circle → done, then undo
    await page.click('.ph-row[data-id="a"] .ph-done'); await page.waitForTimeout(300);
    expect(!(await page.$('.ph-row[data-id="a"]')), 'completed');
    await page.click('.ph-toast >> text=Undo'); await page.waitForTimeout(100);
    expect(await page.$('.ph-row[data-id="a"]'), 'undo restored');
    expect(!(await page.evaluate(() => Data.get().archive.some(x => x.id === 'a'))), 'undo un-archived');
    // swipe right on b
    const box = await page.$eval('.ph-row[data-id="b"]', el => { const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, w: r.width }; });
    await page.evaluate(({ x, y, w }) => {
      const el = document.querySelector('.ph-row[data-id="b"]');
      const mk = (type, cx) => { const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y }); el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true })); };
      mk('touchstart', x); mk('touchmove', x + 20); mk('touchmove', x + w * 0.6); mk('touchend', x + w * 0.6);
    }, box);
    await page.waitForTimeout(400);
    expect(!(await page.$('.ph-row[data-id="b"]')), 'swiped done');
    // recurring circle
    await page.click('.ph-row[data-id="r"] .ph-done'); await page.waitForTimeout(400);
    expect(await page.evaluate(() => Data.recurringTasks().length) === 1 && !(await page.$('.ph-row[data-id="r"]')), 'recurring completed + respawned');
    // capture with chips
    await page.fill('#ph-input', 'Renew hospital badge');
    await page.click('.ph-chip >> text=asap');
    await page.click('.ph-chip >> text=EDBA');
    await page.click('.ph-save');
    const t = await page.evaluate(() => Data.openTasks().find(x => x.title === 'Renew hospital badge'));
    expect(t && t.urgency === 'asap' && t.area === 'EDBA' && t.source === 'phone', 'captured with chips');
    expect(await page.inputValue('#ph-input') === '', 'input cleared');
    await page.fill('#ph-input', 'water plants every 1w');
    await page.press('#ph-input', 'Enter'); await page.waitForTimeout(100);
    expect(await page.evaluate(() => Data.recurringTasks().some(x => x.title === 'water plants')), 'every via phone');
    console.log('  phone assertions passed');
  },
};
