// Keyboard shortcuts — ⌥T / ⌥E / ⌥L / ⌥S / ⌥/ (matched on e.code, work while the entry bar
// has focus); detail-popover guard; Focus (overlay fallback — PiP off): Space, Esc, ⌥Enter
// (Done → "✓ title" card, nothing starts next), ⌥W flow, ⌥⇧S start in flow. The pop-out
// path (incl. ⌥F) is covered by flow-mode.cjs with a stubbed PiP.
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
    const MAC_KEY = { KeyT: '†', KeyE: 'Dead', KeyL: '¬', KeyS: 'ß', Slash: '÷', KeyF: 'ƒ', KeyW: '∑', Enter: 'Enter' };
    const alt = async (code, shift = false) => {
      const prevented = await page.evaluate(({ code, key, shift }) => {
        const ev = new KeyboardEvent('keydown', { code, key, altKey: true, shiftKey: shift, bubbles: true, cancelable: true });
        (document.activeElement || document.body).dispatchEvent(ev);
        return ev.defaultPrevented;
      }, { code, key: shift && code === 'KeyS' ? 'Í' : (MAC_KEY[code] || code), shift });
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
    // Mac Chrome delivers ⌥ text via the IME after keydown, into the newly focused bar.
    // Simulate both shapes: an insertText '†' (⌥T) and a dead-key composition '´' (⌥E).
    const strayInsert = (ch) => page.evaluate((ch) => {
      const el = document.activeElement;
      const bi = new InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true });
      if (el.dispatchEvent(bi)) { el.value += ch; el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true })); return 'inserted'; }
      return 'blocked';
    }, ch);
    await alt('KeyT');
    expect(await strayInsert('†') === 'blocked', '† after ⌥T is cancelled');
    expect(await page.inputValue('#ol-input-today') === 'Buy milk', 'no † in the bar');
    await alt('KeyE');
    await page.evaluate(() => {
      const el = document.activeElement;
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      el.value += '´';
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: '´', isComposing: true, bubbles: true }));
    });
    await wait(100);
    expect(await view() === 'everything', '⌥E (dead key) → everything');
    expect(await page.inputValue('#ol-input-everything') === '', 'no ´ in the everything bar: ' + JSON.stringify(await page.inputValue('#ol-input-everything')));
    expect(await active() === 'ol-input-everything', 'bar still focused after the dead key');
    // Typing right after a shortcut still works
    await page.keyboard.type('x');
    expect(await page.inputValue('#ol-input-everything') === 'x', 'typing after ⌥E works: ' + JSON.stringify(await page.inputValue('#ol-input-everything')));
    await page.keyboard.press('Backspace');
    await alt('KeyT');
    expect(await page.inputValue('#ol-input-today') === 'Buy milk', 'today text intact');

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

    // Hold ⌥ → faint hints after a short delay; gone on release / on another key
    const hints = () => page.evaluate(() => document.body.classList.contains('kbd-hints'));
    await page.keyboard.down('Alt'); await wait(150);
    expect(!(await hints()), 'no hints before the delay');
    await wait(400);
    expect(await hints(), 'hints after holding ⌥');
    const zoomHint = await page.evaluate(() => document.querySelector('[data-sc="everything"]').dataset.kbd);
    expect(/E$/.test(zoomHint), 'zoom out hint: ' + zoomHint);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-sc="start"]'), '::after').opacity) !== '0', 'start hint visible');
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/shortcuts-hints.png' });
    await page.keyboard.up('Alt'); await wait(50);
    expect(!(await hints()), 'hints gone on release');
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyL'); await wait(600);
    expect(!(await hints()), 'quick ⌥L does not show hints');
    expect(await view() === 'log', '⌥L (held) → log');
    await page.keyboard.up('Alt');
    await alt('KeyT');

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
    await page.keyboard.down('Alt'); await wait(500);
    expect(await hints(), 'hints in focus');
    await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/shortcuts-hints-focus.png' });
    await page.keyboard.up('Alt');
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
    // ⌥Enter → Done → "✓ title" card only; ⌥Enter again does nothing (no start-next)
    await alt('KeyS'); await wait(100);
    await page.keyboard.press('Alt+Enter'); await wait(300);
    expect(await focusVisible(), 'done card showing');
    const card = (await page.textContent('#focus-zone')).replace(/\s+/g, ' ');
    expect(card.includes('✓ First thing') && !card.includes('Second thing') && !card.includes('Start ›'), 'done card: ' + card);
    expect(await page.evaluate(() => Data.get().archive.length) === 1, 'first archived');
    expect(await active() !== 'ol-input-today', 'bar not refocused under the card');
    await alt('Enter'); // no handoff start-next any more: this must not start anything
    expect(await page.evaluate(() => Data.events().filter(e => e.event === 'started').length) === 2, 'nothing started from the card');
    // Esc on the card → back to Today
    await page.keyboard.press('Escape'); await wait(300);
    expect(!(await focusVisible()), 'Esc closes the card');
    // ⌥⇧S → item 1 straight into flow; ⌥W toggles flow off (→ 5-min segment) and on
    await alt('KeyS', true); await wait(150);
    expect(await focusVisible(), '⌥⇧S opens focus');
    expect((await page.textContent('#focus-meta')).includes('Second thing'), '⌥⇧S started item 1');
    expect((await page.textContent('.fmeta-sub')).trim() === 'flow', 'starts in flow');
    expect(!(await page.$('#focus-orb-controls >> text=Skip')), 'no Skip in flow');
    expect(await page.evaluate(() => Data.events().filter(e => e.event === 'started').pop().meta?.flow === true), 'started meta.flow');
    expect(await alt('KeyW'), '⌥W handled');
    expect((await page.textContent('.fmeta-sub')).includes('work'), '⌥W → flow off');
    const clk = (await page.textContent('#focus-clock-time')).replace(/\s/g, '');
    expect(clk === '05:00' || clk === '04:59', 'flow off → 5-min segment: ' + clk);
    await alt('KeyW');
    expect((await page.textContent('.fmeta-sub')).trim() === 'flow', '⌥W → flow on again');
    await page.keyboard.press('Escape'); await wait(300);
    expect((await page.$$('.ol-li')).length === 2, 'two left on today');
    expect(await page.evaluate(() => Data.get().tasks.filter(t => t.title === 'Buy milk').length) === 0, 'nothing saved by accident');
    const ev = await page.evaluate(() => Data.events().map(e => e.event).join(','));
    expect(ev === 'started,started,done,started', 'events: ' + ev);
    console.log('  shortcuts assertions passed');
  },
};
