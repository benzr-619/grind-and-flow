// nth-weekday recurrence: "every 2st and 4rd monday" (typo suffixes) through the entry bar,
// then check it off early and confirm the next due date skips past the current occurrence.
// Also: the entry-bar preview chip, the detail popover cadence, and the edit window's
// 1st/2nd/3rd/4th/last chip row. Expected dates come from an independent brute force
// below (not parse.js), using the real local date.
module.exports = {
  seed: () => ({ tasks: [] }),
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // nth Monday check by counting Mondays in the month (independent of parse.js).
    const isNthMon = (d, ks) => {
      if (d.getDay() !== 1) return false;
      let k = 0; for (let x = 1; x <= d.getDate(); x++) if (new Date(d.getFullYear(), d.getMonth(), x).getDay() === 1) k++;
      return ks.includes(k);
    };
    const nextMon = (fromStr, ks, inclusive) => {
      const d = new Date(fromStr + 'T00:00:00'); if (!inclusive) d.setDate(d.getDate() + 1);
      while (!isNthMon(d, ks)) d.setDate(d.getDate() + 1);
      return ymd(d);
    };
    const today = await page.evaluate(() => Data.localToday());
    const firstDue = nextMon(today, [2, 4], true);
    const nextDue = nextMon(firstDue, [2, 4], false); // completing early → the occurrence after

    // Entry bar: inline "every …" with typo suffixes → preview chip, then Enter.
    await page.click('#ol-input-today');
    await page.keyboard.type('neuro consult data every 2st and 4rd monday');
    const preview = await page.textContent('#ol-entry-today');
    expect(preview.includes('↻ 2nd & 4th Mon'), 'entry-bar preview chip: ' + preview);
    await page.keyboard.press('Enter');
    const t = await page.evaluate(() => Data.get().tasks.find(x => x.title === 'Neuro consult data'));
    expect(t, 'task created (title stripped + sentence-cased)');
    expect(t.status === 'recurring' && t.recurrence === 'anchored', 'anchored recurring: ' + JSON.stringify(t));
    expect(JSON.stringify(t.recurrenceWeekdays) === '[0]' && JSON.stringify(t.recurrenceNth) === '[2,4]', 'weekdays + nth: ' + JSON.stringify(t));
    expect(t.dueDate === firstDue, `first due ${t.dueDate} = ${firstDue}`);
    await page.waitForTimeout(400);
    const db = await page.evaluate(id => (window.__FAKE_DB.tasks || []).find(r => r.id === id), t.id);
    expect(db && JSON.stringify(db.recurrence_nth) === '[2,4]', 'recurrence_nth synced: ' + JSON.stringify(db && db.recurrence_nth));

    // Detail popover shows the cadence.
    await page.evaluate(id => App.olOpenDetail(id), t.id);
    const rec = await page.textContent('#ol-detail .od-rec');
    expect(rec.includes('↻ 2nd & 4th Mon'), 'detail cadence: ' + rec);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const d = document.getElementById('ol-detail'); if (d) d.remove(); });

    // Edit window: weekly rule, Monday active, 2nd + 4th chips active.
    await page.evaluate(id => App.openRecurringModal(id), t.id);
    expect(await page.isVisible('#rm-rule-nth'), 'nth chip row visible with a weekday picked');
    const on = await page.$$eval('#rm-rule-nth .rm-nth-btn.active', e => e.map(x => x.textContent));
    expect(on.join() === '2nd,4th', 'nth chips: ' + on);
    expect((await page.$$eval('#rm-rule-nth .rm-nth-btn', e => e.map(x => x.textContent))).join() === '1st,2nd,3rd,4th,last', 'chip labels');
    // Unpicking Monday hides the row.
    await page.click('#rm-rule-weekly .recur-day-btn[data-d="0"]');
    expect(!(await page.isVisible('#rm-rule-nth')), 'row hidden with no weekday');
    await page.click('#rm-rule-weekly .recur-day-btn[data-d="0"]');
    expect(await page.isVisible('#rm-rule-nth'), 'row back');
    await page.evaluate(id => App._saveRecurModal(id), t.id);
    expect(JSON.stringify(await page.evaluate(id => Data.findItem(id).recurrenceNth, t.id)) === '[2,4]', 'save keeps nth');

    // Check it off today (early) → confirm pre-filled with the occurrence after the due date.
    await page.evaluate(id => App.completeRecurringToday(id), t.id);
    await page.waitForSelector('#rc-date');
    const sugg = await page.inputValue('#rc-date');
    expect(sugg === nextDue, `confirm pre-fill ${sugg} = ${nextDue} (after due ${firstDue}, not before)`);
    await page.click('.rc-modal .btn-save');
    const next = await page.evaluate(() => Data.get().tasks.filter(x => x.title === 'Neuro consult data'));
    expect(next.length === 1 && next[0].id !== t.id, 'one live occurrence, a new one');
    expect(next[0].dueDate === nextDue && JSON.stringify(next[0].recurrenceNth) === '[2,4]', 'next occurrence: ' + JSON.stringify(next[0]));
    expect(next[0].recurrenceLastCompletedAt === today, 'last completed = today');

    // Turning the nth chips off → every Monday (today's behavior).
    await page.evaluate(id => App.openRecurringModal(id), next[0].id);
    for (const b of await page.$$('#rm-rule-nth .rm-nth-btn.active')) await b.click();
    await page.evaluate(id => App._saveRecurModal(id), next[0].id);
    const plain = await page.evaluate(id => Data.findItem(id), next[0].id);
    expect(plain.recurrenceNth === null && JSON.stringify(plain.recurrenceWeekdays) === '[0]', 'no chips → nth null: ' + JSON.stringify(plain.recurrenceNth));
    console.log('  nth-recur assertions passed');
  },
};
