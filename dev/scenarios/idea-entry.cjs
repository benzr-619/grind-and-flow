// Idea via the entry bar's priority/date step: title → Tab → "i" → Tab → area → Enter.
// Desktop: Tab flow, idea chip, idea wins over `idea:` + date, Shift+Enter → Everything not Today.
// --mobile: the phone's "idea" chip (mutually exclusive with asap/date/no rush).
const UID = '00000000-0000-0000-0000-000000000001';
module.exports = {
  seed: () => ({ tasks: [{ id: 'i0', type: 'standalone', title: 'Residents stats series', status: 'idea', tags: [], user_id: UID, date_added: '2026-11-01' }] }),
  run: async (page, { mobile }) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const find = t => page.evaluate(t => Data.get().tasks.find(x => x.title === t) || null, t);
    if (mobile) {
      await page.fill('#ph-input', 'Podcast on triage');
      await page.click('.ph-chip >> text=asap');
      await page.click('.ph-chip >> text=idea');
      expect((await page.$$eval('.ph-chip.on', e => e.map(x => x.textContent))).join() === 'idea', 'idea chip replaces asap');
      await page.click('.ph-chip >> text=EDBA');
      await page.click('.ph-save');
      const t = await find('Podcast on triage');
      expect(t && t.status === 'idea' && t.area === 'EDBA' && t.source === 'phone' && !t.urgency && !t.dueDate, 'phone idea saved: ' + JSON.stringify(t));
      expect((await page.textContent('.ph-toast')).includes('Everything'), 'toast says Everything');
      console.log('  idea (phone) assertions passed');
      return;
    }
    // Tab flow: title → Tab → i → Tab → area → Enter
    await page.click('#ol-input-today');
    await page.keyboard.type('Wearable ECG study');
    await page.keyboard.press('Tab');
    expect((await page.textContent('#ol-entry-today .ol-hints')).includes('idea'), 'idea hint chip in step 2');
    await page.keyboard.type('i');
    expect(await page.isVisible('#ol-entry-today .ol-chip.on >> text=idea'), 'idea chip lit for "i"');
    await page.keyboard.press('Tab');
    expect((await page.textContent('#ol-entry-today .ol-tok-when')) === 'idea', 'when token = idea');
    await page.keyboard.type('r');
    await page.keyboard.press('Enter');
    const t = await find('Wearable ECG study');
    expect(t && t.status === 'idea' && t.area === 'Research' && !t.urgency && !t.dueDate && !t.todayDate, 'idea with area: ' + JSON.stringify(t));
    expect((await page.textContent('#ol-entry-today .ol-keyhint')).includes('Everything'), 'flash says Everything');
    expect(!(await page.$(`.ol-off-row[data-id="${t.id}"]`)), 'not in Offered');
    // "in 3d" still a date in step 2
    await page.keyboard.type('Call Dana'); await page.keyboard.press('Tab');
    await page.keyboard.type('in 3d'); await page.keyboard.press('Enter');
    const d = await find('Call Dana');
    expect(d && d.status === 'open' && d.dueDate, '"in 3d" saved as a date');
    // chip click + Shift+Enter → Everything, not Today
    await page.keyboard.type('Gym playlist'); await page.keyboard.press('Tab');
    await page.click('#ol-entry-today .ol-chip >> text=idea');
    await page.keyboard.press('Shift+Enter');
    const g = await find('Gym playlist');
    expect(g && g.status === 'idea' && !g.todayDate, 'shift+enter idea not on Today');
    expect(!(await page.$(`.ol-li[data-id="${g.id}"]`)), 'not rendered on Today');
    // idea: prefix + step-2 value → idea wins
    await page.keyboard.type('idea: grant pitch'); await page.keyboard.press('Tab');
    await page.keyboard.type('asap'); await page.keyboard.press('Enter');
    const p = await find('grant pitch');
    expect(p && p.status === 'idea' && !p.urgency, 'idea: wins over asap');
    // duplicate hint still applies to ideas
    await page.keyboard.type('residents stats series');
    expect(await page.isVisible('#ol-entry-today .ol-dup'), 'dup hint for existing idea');
    await page.keyboard.press('Escape');
    // shows in Everything as a hollow dot
    await page.evaluate(() => App.olGo('everything')); await page.waitForTimeout(900);
    expect(await page.$(`.ev-it.is-idea[data-id="${t.id}"] .ev-dot.idea`), 'idea in Everything (hollow dot)');
    console.log('  idea (desktop) assertions passed');
  },
};
