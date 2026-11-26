// Keyboard shortcuts — ⌥T / ⌥E / ⌥L / ⌥S / ⌥/ (matched on e.code, work while the entry bar
// has focus); detail-popover guard; Focus: Space, Esc, ⌥Enter (Done), handoff ⌥Enter (start
// up-next). ⌥F/PiP needs a real window + user gesture, so it isn't driven here.
// Run with --mobile too: keys do nothing there.
const UID = '00000000-0000-0000-0000-000000000001';
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
const T = (id, title, order) => ({ id, type: 'standalone', title, status: 'open', date_added: today, tags: [], user_id: UID, today_date: today, today_order: order });
module.exports = {
  seed: () => ({ tasks: [T('a', 'First thing', 1), T('b', 'Second thing', 2), T('c', 'Third thing', 3)] }),
  run: async (page, { mobile } = {}) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const wait = (ms = 250) => page.waitForTimeout(ms);
    const view = () => page.evaluate(() => document.body.dataset.olView);
    const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    const focusVisible = () => page.evaluate(() => getComputedStyle(document.getElementById('focus-zone')).display !== 'none');
    // Synthetic keydown with the code + altKey, and the `key` a Mac really reports for ⌥+key
    // (special characters / 'Dead') — proves matching is on e.code, not e.key.
    const MAC_KEY = { KeyT: '†', KeyE: 'Dead', KeyL: '¬', KeyS: 'ß', Slash: '÷', KeyF: 'ƒ', Enter: 'Enter' };
    const alt = async (code) => {
      const prevented = await page.evaluate(({ code, key }) => {
        const ev = new KeyboardEvent('keydown', { code, key, altKey: true, bubbles: true, cancelable: true });
        (document.activeElement || document.body).dispatchEvent(ev);
        return ev.defaultPrevented;
      }, { code, key: MAC_KEY[code] || code });
      await wait();
      return prevented;
    };

    if (mobile) {
      await alt('KeyS'); await alt('Slash');
      expect(!(await page.$('#ol-shortcuts')), 'no cheat sheet on phone');
      expect(await page.evaluate(() => Data.events().length) === 0, 'nothing started on phone');
      console.log('  shortcuts (phone) assertions passed'); return;
    }

    // The entry bar autofocuses; shortcuts work from inside it.
    expect(await active() === 'ol-input-today', 'entry bar focused on load: ' + await active());
    expect(await alt('KeyE'), '⌥E (dead key on Mac) prevented');
    expect(await view() === 'everything', '⌥E → everything');
    expect(await alt('KeyL'), '⌥L prevented');
    expect(await view() === 'log', '⌥L → log');
    await alt('KeyT');
    expect(await view() === 'today', '⌥T → today');

    // Real key presses with text typed: no stray character, text not wiped.
    // (Headless Chromium doesn't insert ⌥ characters itself, so also check the press was
    // preventDefault-ed — that's what stops a Mac from typing † / starting a dead key.)
    await page.evaluate(() => window.addEventListener('keydown', e => { window.__lastPrevented = e.defaultPrevented; }));
    const prevented = () => page.evaluate(() => window.__lastPrevented);
    await page.click('#ol-input-today');
    await page.keyboard.type('Buy milk');
    await page.keyboard.press('Alt+KeyT'); await wait(300);
    expect(await prevented(), 'real ⌥T prevented');
    expect(await page.inputValue('#ol-input-today') === 'Buy milk', 'after ⌥T: ' + JSON.stringify(await page.inputValue('#ol-input-today')));
    expect(await active() === 'ol-input-today', 'still in the bar after ⌥T');
    await page.keyboard.press('Alt+KeyE'); await wait(400);
    expect(await view() === 'everything', 'real ⌥E → everything');
    expect(await prevented(), 'real ⌥E prevented');
    await page.keyboard.press('Alt+KeyT'); await wait(400);
    expect(await view() === 'today', 'real ⌥T → today');
    expect(await page.inputValue('#ol-input-today') === 'Buy milk', 'text kept across ⌥E/⌥T: ' + JSON.stringify(await page.inputValue('#ol-input-today')));
    // Plain letters still just type
    await page.keyboard.type('s');
    expect(await page.inputValue('#ol-input-today') === 'Buy milks', 'plain s types');
    expect(!(await focusVisible()), 'plain s is not a shortcut');
    await page.keyboard.press('Backspace');
    // ⌥ + Shift / ⌘ variants don't match
    await page.keyboard.press('Alt+Shift+KeyL'); await wait();
    expect(await view() === 'today', '⌥⇧L ignored');

    // ⌥/ cheat sheet — opens from inside the bar; plain Esc closes it without clearing the text
    expect(await alt('Slash'), '⌥/ prevented');
    expect(!!(await page.$('#ol-shortcuts')), '⌥/ opens cheat sheet');
    expect((await page.textContent('#ol-shortcuts')).includes('Start Today item 1'), 'sheet lists shortcuts');
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/shortcuts-sheet.png' });
    await alt('KeyL');
    expect(await view() === 'today', 'other keys inert while sheet open');
    await page.keyboard.press('Escape'); await wait(100);
    expect(!(await page.$('#ol-shortcuts')), 'Esc closes sheet');
    expect(await page.inputValue('#ol-input-today') === 'Buy milk', 'Esc on sheet keeps typed text');
    expect(await active() === 'ol-input-today', 'focus returns to the bar');
    expect((await page.textContent('.ol-kbd-hint')).includes('/ shortcuts'), 'header hint shows ⌥/');
    await page.click('.ol-kbd-hint'); await wait(100);
    expect(!!(await page.$('#ol-shortcuts')), 'header hint opens sheet');
    await alt('Slash');
    expect(!(await page.$('#ol-shortcuts')), '⌥/ closes sheet');
    await page.fill('#ol-input-today', '');

    // Detail popover open → shortcuts ignored
    await page.click('.ol-li[data-id="a"] .ol-row-title'); await wait();
    await alt('KeyL');
    expect(await view() === 'today', 'ignored while detail popover open');
    await page.evaluate(() => App.olCloseDetail());

    // ⌥S → Focus on item 1 (from inside the bar)
    await page.click('#ol-input-today');
    await alt('KeyS'); await wait(100);
    expect(await focusVisible(), '⌥S opens focus');
    expect((await page.textContent('#focus-meta')).includes('First thing'), '⌥S started item 1');
    expect(await active() !== 'ol-input-today', 'entry bar not focused behind overlay');
    await alt('KeyL');
    expect(await view() === 'today' && await focusVisible(), '⌥L ignored in focus');
    // Space pauses / resumes, without scrolling
    const label = () => page.textContent('#focus-orb-controls .oc-btn.primary');
    expect((await label()).includes('Pause'), 'running: ' + await label());
    const y0 = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Space'); await wait();
    expect((await label()).includes('Resume'), 'Space pauses: ' + await label());
    await page.keyboard.press('Space'); await wait();
    expect((await label()).includes('Pause'), 'Space resumes');
    expect(await page.evaluate(() => window.scrollY) === y0, 'Space does not scroll');
    // Esc → Back to Today
    await page.keyboard.press('Escape'); await wait(300);
    expect(!(await focusVisible()), 'Esc → back to today');
    expect((await page.$$('.ol-li')).length === 3, 'still 3 on today');
    // ⌥Enter → Done → handoff; ⌥Enter again → start up-next
    await alt('KeyS'); await wait(100);
    await page.keyboard.press('Alt+Enter'); await wait(300);
    expect(await focusVisible(), 'handoff showing');
    expect((await page.textContent('#focus-orb-controls')).includes('Second thing'), 'up next = second');
    expect(await page.evaluate(() => Data.get().archive.length) === 1, 'first archived');
    expect(await active() !== 'ol-input-today', 'bar not refocused under handoff');
    await alt('Enter'); await wait(100);
    expect((await page.textContent('#focus-meta')).includes('Second thing'), '⌥Enter in handoff started second');
    await alt('Enter'); await wait(100);
    // Esc in handoff → back to Today
    await page.keyboard.press('Escape'); await wait(300);
    expect(!(await focusVisible()), 'Esc closes handoff');
    expect((await page.$$('.ol-li')).length === 1, 'one left on today');
    expect(await page.evaluate(() => Data.get().tasks.filter(t => t.title === 'Buy milk').length) === 0, 'nothing saved by accident');
    const ev = await page.evaluate(() => Data.events().map(e => e.event).join(','));
    expect(ev === 'started,started,done,started,done', 'events: ' + ev);
    console.log('  shortcuts assertions passed');
  },
};
