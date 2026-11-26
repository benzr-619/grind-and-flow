// Prompt 4 — Focus: start on Today item 1, back to Today, done → up-next card → start next → done → clear.
const UID = '00000000-0000-0000-0000-000000000001';
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
const T = (id, title, order) => ({ id, type: 'standalone', title, status: 'open', date_added: today, tags: [], user_id: UID, today_date: today, today_order: order });
module.exports = {
  seed: () => ({ tasks: [T('a', 'First thing', 1), T('b', 'Second thing', 2)] }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const visible = () => page.evaluate(() => getComputedStyle(document.getElementById('focus-zone')).display !== 'none');
    await page.click('.ol-start'); await page.waitForTimeout(300);
    expect(await visible(), 'focus open');
    expect((await page.textContent('#focus-meta')).includes('First thing'), 'title in meta');
    await page.click('#focus-orb-controls >> text=Back to Today'); await page.waitForTimeout(300);
    expect(!(await visible()), 'focus closed');
    expect((await page.$$('.ol-li')).length === 2, 'still on today');
    await page.click('.ol-start'); await page.waitForTimeout(200);
    await page.click('#focus-orb-controls >> text=Done'); await page.waitForTimeout(300);
    expect(await visible(), 'handoff visible');
    expect((await page.textContent('#focus-orb-controls')).includes('Second thing'), 'up next shows second');
    await page.click('#focus-orb-controls >> text=Start'); await page.waitForTimeout(300);
    expect((await page.textContent('#focus-meta')).includes('Second thing'), 'started second');
    await page.click('#focus-orb-controls >> text=Done'); await page.waitForTimeout(300);
    expect((await page.textContent('#focus-orb-controls')).includes('clear'), 'list clear');
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/focus-handoff.png' });
    await page.click('#focus-orb-controls >> text=Back to Today'); await page.waitForTimeout(300);
    expect(!(await visible()), 'closed after handoff');
    const ev = await page.evaluate(() => Data.events().map(e => e.event).join(','));
    expect(ev.startsWith('started,started,done,started,done'), 'events: ' + ev);
    expect(await page.evaluate(() => Data.get().archive.length) === 2, 'both archived');
    console.log('  focus assertions passed');
  },
};
