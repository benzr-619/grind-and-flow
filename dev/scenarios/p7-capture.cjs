// Prompt 7 — capture polish: duplicate hint (keep both / open existing), inline shortcuts, idea:, every.
const UID = '00000000-0000-0000-0000-000000000001';
module.exports = {
  seed: () => ({ tasks: [{ id: 'd1', type: 'standalone', title: 'Reply to cardiology about LifeNet', status: 'open', tags: [], user_id: UID, date_added: '2026-11-01' }] }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    await page.click('#ol-input-today');
    await page.keyboard.type('reply to cardiology');
    expect(await page.isVisible('#ol-entry-today .ol-dup'), 'dup hint shown');
    expect((await page.textContent('#ol-entry-today .ol-dup')).includes('Reply to cardiology about LifeNet'), 'dup names existing');
    await page.click('#ol-entry-today .ol-dup >> text=keep both');
    expect(!(await page.isVisible('#ol-entry-today .ol-dup')), 'hint dismissed');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Data.openTasks().length) === 2, 'kept both');
    await page.keyboard.type('Reply to cardiology');
    await page.click('#ol-entry-today .ol-dup >> text=open existing');
    expect(await page.isVisible('#ol-detail'), 'opened existing');
    expect(await page.inputValue('#ol-input-today') === '', 'entry cleared');
    await page.keyboard.press('Escape');
    await page.click('#ol-input-today');
    await page.keyboard.type('Grant budget #r by dec 4');
    expect((await page.textContent('#ol-entry-today .ol-hints')).includes('Research'), 'inline preview chips');
    await page.keyboard.press('Enter');
    const g = await page.evaluate(() => Data.openTasks().find(t => t.title === 'Grant budget'));
    expect(g && g.area === 'Research' && /-12-04$/.test(g.dueDate), 'inline parsed');
    await page.keyboard.type('idea: residents stats series');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => Data.ideas().length) === 1, 'idea saved');
    await page.keyboard.type('Pay rent every 1st #home');
    await page.keyboard.press('Enter');
    const r = await page.evaluate(() => Data.recurringTasks()[0]);
    expect(r && r.recurrence === 'anchored' && r.recurrenceMonthDay === 1 && r.area === 'Home', 'anchored via title');
    console.log('  capture assertions passed');
  },
};
