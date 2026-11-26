// Prompt 2 — exercises the One List data layer in the browser.
module.exports = {
  run: async (page) => {
    const r = await page.evaluate(() => {
      const a = Data.addTask({ title: 'Alpha', urgency: 'asap', area: 'AMD' });
      const b = Data.addTask({ title: 'Bravo', toToday: true });
      const c = Data.addTask({ title: 'Charlie', toToday: true });
      const i = Data.addTask({ title: 'Idea one', isIdea: true });
      Data.pullToToday(a.id);
      Data.reorderToday([a.id, c.id, b.id]);
      Data.sendBack(c.id);
      Data.completeTask(b.id, { minutes: 12 });
      return {
        today: Data.todayList().map(t => t.title),
        open: Data.openTasks().map(t => t.title).sort(),
        ideas: Data.ideas().map(t => t.title),
        events: Data.events().map(e => e.event),
        archived: Data.get().archive.some(x => x.title === 'Bravo'),
      };
    });
    await page.waitForTimeout(300);
    r.dbArea = await page.evaluate(() => window.__FAKE_DB.tasks.find(t => t.title === 'Alpha').area);
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m + ' ' + JSON.stringify(r)); };
    expect(JSON.stringify(r.today) === '["Alpha"]', 'today');
    expect(JSON.stringify(r.open) === '["Alpha","Charlie"]', 'open');
    expect(r.ideas[0] === 'Idea one', 'ideas');
    expect(r.archived, 'archived');
    expect(r.events.join() === 'added,added,pulled,added,pulled,added,pulled,sent_back,done', 'events');
    expect(r.dbArea === 'AMD', 'db area');
    console.log('  data layer assertions passed');
  },
};
