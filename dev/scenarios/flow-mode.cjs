// Focus rework (2026-11-27): pop-out by default, flow mode, boundary overrun, ⌥⇧S.
// PiP is stubbed (smoke.cjs pip:'stub' → requestWindow opens a window.open popup in the
// same realm and records navigator.userActivation), and time is driven with page.clock.
//   A. Click start → pop-out (with user activation), overlay hidden, Today line + usable bar
//      → Flow on → 6 min with no boundary, clock counts up → Flow off → 5-min segment
//      → boundary (work→break) → wait 3 min → Skip → Done → window closed, done minutes /
//      seconds / meta.flow, "✓ title · Nm" note on Today.
//   B. ⌥⇧S (a real keypress) → pop-out with activation, in flow → 2 min → close the window
//      = Back to Today (minutes on the started event, logged once).
//   C. requestWindow rejects → overlay fallback with Float ↗; work 5m → wait 2m at work→break
//      (counts) → break 5m → wait 4m at break→work (doesn't) → Back → 7 min.
const UID = '00000000-0000-0000-0000-000000000001';
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
const T = (id, title, order) => ({ id, type: 'standalone', title, status: 'open', date_added: today, tags: [], user_id: UID, today_date: today, today_order: order });
const MIN = 60 * 1000;
module.exports = {
  pip: 'stub',
  seed: () => ({ tasks: [T('a', 'First thing', 1), T('b', 'Second thing', 2), T('c', 'Third thing', 3)] }),
  before: async (page) => { await page.clock.install(); },
  run: async (page) => {
    const expect = (c, m) => { if (!c) throw new Error('assert: ' + m); };
    const wait = (ms = 250) => page.waitForTimeout(ms);
    const run = ms => page.clock.runFor(ms);
    const overlayVisible = () => page.evaluate(() => getComputedStyle(document.getElementById('focus-zone')).display !== 'none');
    const ev = () => page.evaluate(() => Data.events().map(e => ({ event: e.event, taskId: e.taskId, minutes: e.minutes, seconds: e.seconds, meta: e.meta })));
    const near = (v, target, tol, label) => expect(v != null && Math.abs(v - target) <= tol, `${label}: ${v} ≉ ${target}`);
    const clockSecs = txt => { const p = txt.replace(/\s/g, '').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };

    // ── A. pop-out by default ──
    const popA = page.waitForEvent('popup');
    await page.click('.ol-start');
    const pip = await popA; await wait(300);
    const calls = await page.evaluate(() => window.__pipCalls);
    expect(calls.length === 1 && calls[0].active === true, 'click opened PiP with user activation: ' + JSON.stringify(calls));
    expect(!(await overlayVisible()), 'overlay not shown on the pop-out path');
    expect(await pip.$('#pip-stage #focus-orb'), 'orb moved into the PiP');
    const line = () => page.textContent('#ol-focus-line');
    expect((await line()).includes('in focus: First thing'), 'Today line: ' + await line());
    // Today stays usable: the bar is focused and takes typing
    await page.click('#ol-input-today'); await page.keyboard.type('Buy milk'); await wait(100);
    expect(await page.inputValue('#ol-input-today') === 'Buy milk', 'entry bar usable during focus');
    await page.keyboard.press('Escape'); await wait(100);
    expect(await page.$('#ol-focus-line .ol-focus-line'), 'Esc on Today did not end the session');
    // PiP hover: title, clock, state, controls (no Dock)
    await pip.hover('#pip-stage'); await wait(200);
    const hov = (await pip.textContent('#pip-hover')).replace(/\s+/g, ' ');
    for (const w of ['First thing', 'Back to Today', 'Pause', 'Skip', 'Flow', 'Done']) expect(hov.includes(w), `pip hover has ${w}: ${hov}`);
    expect(!/Dock/.test(hov), 'no Dock button');

    // Flow on (PiP button) → no boundary past 5 min, clock counts up
    await pip.click('.pip-controls >> text=Flow'); await wait(100);
    expect((await pip.textContent('.pip-state')).trim() === 'flow', 'state flow');
    expect(!(await pip.$('.pip-controls >> text=Skip')), 'Skip hidden in flow');
    const startedA = (await ev()).find(e => e.event === 'started' && e.taskId === 'a');
    expect(startedA.meta && startedA.meta.flow === true, 'started meta patched with flow: ' + JSON.stringify(startedA.meta));
    await run(6 * MIN); await wait(100);
    expect((await pip.textContent('.pip-state')).trim() === 'flow', 'still flow after 6 min (no boundary)');
    expect(!(await pip.$eval('#pip-stage', el => el.classList.contains('boundary-settle'))), 'no boundary ring');
    near(clockSecs(await pip.textContent('#pip-clock-time')), 360, 2, 'flow clock counts up');
    near(clockSecs(await page.textContent('#ol-focus-clock')), 360, 2, 'Today line clock');
    const shots = process.env.SHOT_DIR || '.';
    await page.screenshot({ path: shots + '/flow-today-line.png', clip: { x: 0, y: 0, width: 1360, height: 260 } });
    // The stub popup won't load the cloned <link>s (real Document PiP does) — inline the CSS for the shot.
    await pip.evaluate(css => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); },
      require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'style.css'), 'utf8'));
    await pip.setViewportSize({ width: 260, height: 240 }); await pip.hover('#pip-stage'); await wait(250);
    await pip.screenshot({ path: shots + '/flow-pip-hover.png' });
    expect(await page.evaluate(() => App.focusRaise.length === 0), 'focusRaise exposed');

    // Flow off → fresh 5-minute segment
    await pip.hover('#pip-stage'); await pip.click('.pip-controls >> text=End flow'); await wait(100);
    expect((await pip.textContent('.pip-state')).trim() === 'work', 'flow off → work');
    near(clockSecs(await pip.textContent('#pip-clock-time')), 300, 1, 'flow off → 5:00');
    // Run past the end of the 5-min work segment → work→break boundary
    await run(5 * MIN + 1000); await wait(100);
    expect((await pip.textContent('.pip-state')).trim() === 'work done', 'at work→break boundary');
    const bh = (await pip.textContent('#pip-hover')).replace(/\s+/g, ' ');
    expect(/Start 5m break/.test(bh) && /Skip/.test(bh), 'boundary shows Start break + Skip: ' + bh);
    expect(await pip.$eval('#pip-stage', el => el.classList.contains('boundary-settle')), 'boundary ring on');
    // Sit at the boundary for 3 minutes, then Skip → straight into the next work segment
    await run(3 * MIN); await wait(100);
    await pip.hover('#pip-stage'); await pip.click('.pip-controls >> text=Skip'); await wait(100);
    expect((await pip.textContent('.pip-state')).trim() === 'work', 'Skip at boundary → work');
    near(clockSecs(await pip.textContent('#pip-clock-time')), 600, 1, 'Skip skipped the break (10-min work)');
    await run(1 * MIN);
    // Done → window closes, no handoff, note on Today
    const closedA = pip.waitForEvent('close');
    await pip.hover('#pip-stage'); await pip.click('.pip-controls >> text=Done');
    await closedA; await wait(200);
    expect(!(await overlayVisible()), 'no overlay/handoff after Done in the pop-out');
    const doneA = (await ev()).find(e => e.event === 'done' && e.taskId === 'a');
    // 6 flow + 5 work + 3 overrun + 1 work = 15 min
    near(doneA.seconds, 15 * 60, 3, 'done seconds');
    expect(doneA.minutes === 15, 'done minutes: ' + doneA.minutes);
    expect(doneA.meta.flow === true && doneA.meta.position === 1, 'done meta: ' + JSON.stringify(doneA.meta));
    expect((await ev()).find(e => e.event === 'started' && e.taskId === 'a').seconds == null, 'time only on the done row');
    const kh = await page.textContent('#ol-entry-today .ol-keyhint');
    expect(kh.includes('✓ First thing · 15m'), 'Today note: ' + kh);
    expect(!(await page.$('#ol-focus-line .ol-focus-line')), 'Today line gone');
    expect(await page.evaluate(() => Data.get().archive.find(a => a.id === 'a')?.timeSpent) === 15, 'timeSpent 15');

    // ── B. ⌥⇧S real keypress → pop-out in flow; closing the window = Back to Today ──
    await page.click('#ol-input-today');
    const popB = page.waitForEvent('popup');
    await page.keyboard.press('Alt+Shift+KeyS');
    const pipB = await popB; await wait(300);
    const callsB = await page.evaluate(() => window.__pipCalls);
    expect(callsB[1] && callsB[1].active === true, 'keydown counts as user activation: ' + JSON.stringify(callsB));
    const startedB = (await ev()).find(e => e.event === 'started' && e.taskId === 'b');
    expect(startedB && startedB.meta && startedB.meta.flow === true, '⌥⇧S started meta.flow');
    expect((await pipB.textContent('.pip-state')).trim() === 'flow', '⌥⇧S → flow from the first render');
    expect(await page.inputValue('#ol-input-today') === '', 'no stray character in the bar');
    // ⌥ focus combos from the main window during a pop-out session: ⌥W toggles flow
    await page.keyboard.press('Alt+KeyW'); await wait(100);
    expect((await pipB.textContent('.pip-state')).trim() === 'work', '⌥W from Today → flow off');
    await page.keyboard.press('Alt+KeyW'); await wait(100);
    expect((await pipB.textContent('.pip-state')).trim() === 'flow', '⌥W from Today → flow on');
    // Plain Space on Today types into the bar, it doesn't pause
    await page.keyboard.press('Space'); await wait(100);
    expect((await pipB.textContent('.pip-state')).trim() === 'flow', 'Space on Today does not pause');
    await page.keyboard.press('Escape');
    // Space in the PiP document pauses
    await pipB.click('#pip-stage', { position: { x: 5, y: 5 } }); await pipB.keyboard.press('Space'); await wait(100);
    expect((await pipB.textContent('.pip-state')).includes('paused'), 'Space in the PiP pauses');
    await pipB.keyboard.press('Space'); await wait(100);
    await run(2 * MIN);
    const evCount = (await ev()).length;
    await pipB.evaluate(() => window.close()); await wait(300);
    const startedB2 = (await ev()).find(e => e.event === 'started' && e.taskId === 'b');
    near(startedB2.seconds, 120, 3, 'close = Back: seconds on started');
    expect(startedB2.minutes === 2, 'close = Back: minutes ' + startedB2.minutes);
    expect((await ev()).length === evCount, 'closing logged nothing extra (no double Back)');
    expect(!(await page.$('#ol-focus-line .ol-focus-line')), 'session ended on close');
    expect((await page.$$('.ol-li')).length === 2, 'task b still on Today');
    expect(await page.evaluate(() => Data.findItem('b').timeSpent) === 2, 'timeSpent 2');

    // ── C. requestWindow rejects → overlay fallback; overrun counts only at work→break ──
    await page.evaluate(() => { window.__pipReject = true; });
    await page.click('.ol-start'); await wait(300);
    expect(await overlayVisible(), 'rejected → full-screen overlay');
    expect(await page.$('#focus-orb-controls >> text=Float ↗'), 'Float ↗ offered in the fallback');
    expect(await page.$('#focus-orb-controls [data-sc="flow"]'), 'flow button tagged for hints');
    expect(!(await page.$('#ol-focus-line .ol-focus-line')), 'no Today line under the overlay');
    await run(5 * MIN + 1000); await wait(100);
    expect(await page.$('#focus-orb-controls >> text=Skip'), 'Skip at work→break boundary (overlay)');
    await run(2 * MIN);
    await page.click('#focus-orb-controls >> text=Start 5-min break'); await wait(100);
    await run(5 * MIN + 1000); await wait(100);
    expect(await page.$('#focus-orb-controls >> text=Start 10-min work'), 'break→work boundary');
    expect(!(await page.$('#focus-orb-controls >> text=Skip')), 'no Skip at break→work');
    await run(4 * MIN);
    await page.click('#focus-orb-controls >> text=Back to Today'); await wait(200);
    const startedC = (await ev()).filter(e => e.event === 'started' && e.taskId === 'b').pop();
    near(startedC.seconds, 7 * 60, 3, '5 work + 2 overrun, break and break→work wait uncounted');
    expect(!startedC.meta || !startedC.meta.flow, 'no flow meta when flow unused');
    // Log sums seconds and rounds once
    await page.evaluate(() => App.olGo('log')); await wait(200);
    const big = await page.textContent('.lg-big');
    expect(big.trim() === '24m', 'log total (15 + 2 + 7): ' + big);
    console.log('  flow-mode assertions passed');
  },
};
