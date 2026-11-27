# Focus Mode — breathing orb (pop-out by default)

## Pop-out by default (2026-11-27)
**This section wins over anything below it.** Superseded below: the "Dock orb" button, the overlay as the default surface, the post-Done "up next" card and its **Start ›**, the handoff ⌥Enter, and "minutes accrue per 60s interval".

- **Surface** = in-memory `_focusSurface`: `'pip'` | `'pending'` (requestWindow in flight) | `'overlay'` (fallback). Set in `startTask`.
- **Default (Chromium):** `startTask(id, opts)` (from `.ol-start`, ⌥S, ⌥⇧S) calls `_openPip()` **synchronously** inside the click/keydown — `requestWindow()` needs that user activation (keydown counts; verified with a stub that reads `navigator.userActivation.isActive`). Window 260×240. `#focus-zone` stays hidden; the main window stays on Today and fully usable (no blur, entry bar autofocuses — `_focusOpen()` is now true only while the overlay is up).
- **Fallback:** PiP unsupported (`_pipSupported` false), mobile, or `requestWindow` rejects → `_focusSurface = 'overlay'` and the full-screen overlay works as before. Its controls keep a **Float ↗** (when PiP exists) that tries the pop-out again. No Dock button anywhere.
- **Today line:** `#ol-focus-line` slot at the top of `.ol-today-main`, filled by `_renderFocusLine()` (from `_renderFocusRow` and `_renderOL`): "in focus: <title> · <clock>" (`#ol-focus-clock`, written by `_renderClock`; "break time" at a boundary). Click → `focusRaise()` (`_pipWin.focus()`, or reopen the PiP if a session is running without one). Pop-out path only.
- **PiP hover** (`_renderPipExtras`): `.pip-title`, `#pip-clock-time`, `.pip-state` (work / break / flow / "· paused" / work done / break done), controls **Back to Today · Pause/Resume · Skip · Flow · Done**; at a work→break boundary **Start Nm break › · Skip**; at break→work just **Start Nm work ›**.
- **Close = Back to Today.** `_onPipPagehide` runs `removeFromDoing()` only if `_pipWin` is still set; every app-initiated close (`closeFocusPip`) nulls `_pipWin` first, so Done/close can't double-log. `removeFromDoing()` is a no-op without a session. `closeFocusPip()` no longer re-renders and never ends anything.
- **Done:** accrue → complete → close the PiP → `_olFlash(view, "✓ <title> · Nm", 3200)` on Today/Everything's entry bar. **Nothing starts next** anywhere. Overlay fallback: the post-Done card shows only "✓ <title> · Nm" + Back to Today (`_focusHandoff` is overlay-only). Ticking the in-focus task off on Today (`olDone`) routes to `markDoingDone`. A task deleted mid-session ends the session in `_renderFocusRow`.
- `.ol-start` / ⌥S / ⌥⇧S on the task already in Focus just raise the PiP (⌥⇧S also turns flow on) — never restart the segment.
- The boundary nudge (`_pipBoundaryNudge`) is unchanged.

### Work time = seconds, wall clock
- `_workSecs` + `_workSince`; `_syncCounters()` closes the open interval and reopens it if the state counts. Called from `_startTimer`, pause, the boundary in `_timerTick`, `toggleFlow`, `_endFocusSession`. Counts while: a work segment runs · flow runs · **waiting at a work→break boundary (overrun)** (`timerSegIdx` has already advanced to the break). Not counted: paused, breaks, waiting at a break→work boundary. (Before this, a 60s interval counted whole minutes, was cleared at every boundary/pause, and dropped the overrun and partial minutes.)
- `_endFocusSession(item)` → `{secs, mins, flow}` (secs = round(total), mins = round(secs/60)); `item.timeSpent += mins`. Seconds go on `task_events.seconds` (migration `task_events_seconds`), rounded minutes stay in `minutes`; one event per session (started row on Back, done row on Done). The Log sums seconds (`seconds ?? minutes×60`, archive fallback `time_spent×60`) and rounds once per displayed total (`_logFmtMin(secs)`).
- **Skip at a work→break boundary** = skip the break (straight into the next work segment). Shown in both surfaces; not at break→work.

### Flow mode
- `_flowMode` / `_flowUsed` / `_flowSecs` + `_flowSince` — in-memory, reset when any session starts or ends (`_endFocusSession`). No schema.
- `toggleFlow()` (running state only — no-op at a boundary). **On:** the segment never ends (`_timerTick` returns early: no boundary, chime, Notification, nudge), the clock counts **up** from 0 (`_fmtClock`, h:mm:ss past an hour), Skip hidden, orb forced to work classes (persistent nodes, classes swapped), `.fmeta-sub` / `.pip-state` = "flow". Turning it on while paused or in a break starts running work. **Off:** start small — `timerSegIdx = 0` (the first 5-min work segment) and start it.
- Every flow second is work time. Telemetry: the first flow-on patches the `started` event `meta.flow = true` (`Data.patchEventMeta`); ⌥⇧S logs `started` with `{flow:true}` directly; Done adds `flow: true` to the `done` meta (`completeTask(id, {meta})` merges it over the position meta).
- Buttons: "Flow" / "End flow" (`.oc-btn.on`), `data-sc="flow"` on the overlay's. Shortcut ⌥W.

### Checks
`dev/scenarios/flow-mode.cjs` (`pip: 'stub'` + `page.clock`): click → pop-out with activation, Today line, usable bar, flow 6 min with no boundary, flow off → 5:00, 3-min overrun + Skip, Done (15m, seconds, meta.flow, Today note, window closed); real ⌥⇧S keypress → activation + flow; ⌥W from Today; Space only in the PiP; close = Back logged once; `__pipReject` → overlay fallback, 2-min overrun counted, break→work wait not; Log total. `smoke.cjs` takes `scenario.pip` = `'off'` (default — old scenarios test the overlay) | `'stub'` | `'reject'`, and `scenario.before(page)`. The stub popup doesn't load the cloned `<link>` stylesheets (real PiP does), so the screenshot inlines the CSS.

### Manual checklist (real Chrome — can't be automated)
1. Click **start** on Today item 1 → a small dark always-on-top window with the orb opens; no full-screen overlay; Today shows "in focus: … · mm:ss" ticking.
2. Hover the window → title, clock, state, Back to Today · Pause · Skip · Flow · Done fit (two rows).
3. Type in the entry bar, drag-reorder, open zoom out — all work while focusing.
4. Click the "in focus" line → the window comes forward. Close the window with its native ✕ / back-to-tab → session ends; the Log shows the minutes once.
5. ⌥S, then ⌥⇧S on the same item → no restart, window raised, flow turns on. ⌥⇧S from scratch → opens straight into flow (if the window doesn't open from a keypress, it falls back to the overlay — tell me).
6. Flow: clock counts up past 5:00 with no chime/notification/ring; End flow → 05:00 counting down.
7. Let a work segment end → ring nudge + chime; wait a few minutes; **Skip** → next work segment; Done → window closes, Today flashes "✓ title · Nm" with the overrun included.
8. With the window focused: Space pauses, Esc = Back to Today, ⌥Enter = Done, ⌥W = flow. From Today: ⌥Enter / ⌥W / ⌥F work; Space/Esc behave normally in the bar.
9. Recurring anchored task Done from the window → the confirm prompt appears on the main window.

---

# (History) Focus Mode — full-screen breathing orb

Redesign Phase 1 (session 2026-06-15). Replaced the old inline "doing strip + linear timer track" with an immersive full-screen orb overlay. **Timer logic was not changed** — only the rendering layer.

---

## Layout

`#focus-zone` is a **fixed full-screen overlay** (`position:fixed; inset:0; z-index:200`), hidden by default and shown only while a task has `status === 'doing'`.

Structure in `index.html`:
```
#focus-zone .focus-zone
  #focus-meta .focus-meta        ← top-left: label · tags · title · #focus-clock-time · sub  (JS-rendered)
  #doing-cards-row .orb-area     ← drop target (drag-swap); holds the orb layers
    #focus-orb-glow .orb-glow    ← persistent; class swapped work/break/paused
    .orb-wrap > #focus-orb .orb  ← persistent; class swapped work/break/paused
  #doing-section .doing-section  ← bottom controls bar
    #focus-orb-controls .orb-controls   ← buttons (JS-rendered)
```

The orb itself carries **no text**. Work/break is conveyed by orb color + the `work`/`break` word in `.fmeta-sub` under the timer.

---

## Key technique — persistent orb, swapped classes

`_renderFocusRow()` (app.js) must NOT rebuild the orb elements — that would restart the breathing animation and break the 1.6s work→break color crossfade. Instead it:
1. toggles overlay visibility (`fz.style.display='flex'` + rAF → `.active`),
2. swaps `work`/`break`/`paused` classes on the **persistent** `#focus-orb` + `#focus-orb-glow`, and toggles `break` on `#focus-zone` (paper-tint shift),
3. rebuilds only `#focus-meta` and `#focus-orb-controls` innerHTML.

`#focus-clock-time` lives inside `#focus-meta` (rebuilt each render) — `_renderClock()` finds it by id every second; fine.

---

## Stable ids preserved (CLAUDE.md DOM-stability)

- `#focus-zone`, `#doing-section`, `#focus-clock-time` — kept.
- `#doing-cards-row` — on `.orb-area`; the subtree that moves into the PiP window. (The drag-swap drop handlers were removed in One List Prompt 9 — nothing is dragged onto the orb any more.)

---

## State → orb mapping (in `_renderFocusRow`)

- `kind = TIMER_SEQ[timerSegIdx].kind` → `work` (amber) / `break` (blue).
- **At a boundary** `timerSegIdx` has already advanced, so the orb shows the *next* segment's color and the boundary copy renders in `.fmeta-sub` (`.fmeta-boundary.calm`/`.pushy`).
- `paused` = active && `!timerRunning` && `!timerAtBoundary` → adds `.paused` (settles breathing, dims).

## Controls (bottom)
- Normal: **Pause/Resume** (`timerTogglePlay`) · **Skip** (`skipSegment`) · **Done** (`markDoingDone`) · **Return to Next** (`removeFromDoing`).
- Boundary: primary **Start N-min break/work ›** (`startNextSegment`) · Done · Return to Next.
- `skipSegment()` (new, exposed on `App`): advances one segment and starts it.

**Exit is only via Done or Return to Next.** Pause keeps you on the focus page. There is no "minimize to board" escape.

---

## `_renderTimerTrack()` is now a no-op

The linear segment track is gone. `_renderTimerTrack()` is an empty stub so its ~9 call sites don't need editing. `_updateSegFill()` no-ops (its `.tseg.current .fill` target no longer exists). `_timerJump`/`startNextSegment` now call `_renderFocusRow()` instead of the track.

---

## Tokens (`style.css :root`)
`--focus-amber-core/mid/edge` (work, anchored to the `--amber` family), `--focus-blue-core/mid/edge` (break), `--focus-break-paper` (overlay tint on break). Keyframes: `orb-breathe` (8s scale/opacity), `orb-morph` (19s asymmetric border-radius = imperfect blob), `glow-drift` (13s). `prefers-reduced-motion` disables all three.

---

## Mobile — untouched, must stay hidden

`#focus-zone` is hidden at ≤640px via `#focus-zone { display: none !important; }`. The `!important` is required because JS sets inline `display:flex` to show the overlay on desktop, and inline beats a plain media-query rule. **Do not remove the `!important`.** Mobile orb is a later pass.

---

## PiP float — orb detached into an always-on-top window

Session 2026-06-16. The deferred "float reach goal" is built. A **Float ↗** button in the focus controls pops the orb into a **Document Picture-in-Picture** window that floats above all other apps and follows the user across screens; **Dock orb** (or the window's native close) returns it.

### Why Document PiP (not a popup)
`window.documentPictureInPicture.requestWindow()` opens an OS-level always-on-top window that **shares this JS realm**. So the live timer (`timerInterval`/`_timerTick`/wall-clock drift) keeps running with **zero cross-window messaging** — we just physically relocate the orb DOM between documents.

### The relocation model
- `let _pipWin = null` (module scope) — the open PiP `Window`, null when docked. `const _pipSupported = 'documentPictureInPicture' in window` (Chromium only; Float button hidden otherwise).
- `_focusDoc()` → `_pipWin ? _pipWin.document : document`. **The orb nodes (`#focus-orb`/`#focus-orb-glow`) are looked up via `_focusDoc()`** in `_renderFocusRow`/`_renderClock`, because they move into the PiP doc. `#focus-meta` + `#focus-orb-controls` stay in the **main** doc (all task text/title/elapsed stays on the main screen — the float is *just the orb*).
- `openFocusPip()` (async, needs the button's user gesture): `requestWindow({width:220,height:220})`, clone all `<link rel=stylesheet>`/`<style>` into the PiP head, `body.className='pip-orb'`, **`pip.App = App`** (so inline `onclick="App.*"` in the PiP hover controls resolve against the PiP global), move `#doing-cards-row` (the `.orb-area` subtree) into a `#pip-stage` + `.pip-hover` overlay, wire `pagehide → closeFocusPip`.
- `closeFocusPip()`: null `_pipWin` first (pagehide re-entrancy guard), reinsert `#doing-cards-row` into `#focus-zone` before `#doing-section`, `pip.close()`, re-render.
- `_renderPipExtras()` rebuilds the hover overlay (`#pip-clock-time` + compact `.oc-btn` controls: Return/Pause-Resume/Skip/Done/Dock) each `_renderFocusRow` so state stays in sync. `_renderClock` writes both `#focus-clock-time` (main) and `#pip-clock-time` (PiP).
- Task end: `removeFromDoing`/`markDoingDone` → `_renderFocusRow` no-task branch calls `closeFocusPip()`.

### Boundary cue (nudge, not alarm)
At a segment boundary `_timerTick` calls `_pipBoundaryNudge()`: one `_pipWin.focus()` raise + `.boundary-nudge` on `#pip-stage` (brief stronger ring pulse for 2.6s), which then settles into `.boundary-settle` (slow soft ring) kept on while `atBoundary`. CSS rings are `#pip-stage::after` box-shadow keyframes `orb-nudge`/`orb-settle` (amber, reduced-motion-gated). Intentionally **not** a sustained alarm — the user may want to finish a thought. Chime + browser Notification remain as backup.

### Styles (`style.css`, `body.pip-orb` scope)
`body.pip-orb` is **dark** (`background:#18191b; color-scheme:dark`) to match the un-stylable title bar (see gotchas) — the window is one seamless dark surface, orb glowing on it. `.pip-stage` (fixed full-window), `.orb-wrap` shrunk to 150px, `.orb-glow` tightened to `inset:28%`. `.pip-hover` is a **light** dark scrim (`rgba(24,25,27,0.45)` + `backdrop-filter:blur(3px)`), opacity 0→1 on `.pip-stage:hover`, so the orb stays visible behind it. `.pip-clock` is paper-coloured; controls are light-on-dark via `body.pip-orb .pip-controls .oc-btn` (faint at rest, brighten on hover). **All overrides are `body.pip-orb`-scoped** because `style.css` is cloned into both docs — never recolour bare `html`/`:root` here. Reuses `--focus-*` tokens + orb gradients/keyframes via the cloned stylesheet.

### Controls (`_renderPipExtras`)
Return · Pause/Resume (+ Skip) / boundary Start · Done. **No `.primary` emphasis** (uniform, hover-only) and **no custom Dock button** — the PiP title bar's native **back-to-tab** button closes the window → `pagehide` → `closeFocusPip()` docks the orb. (The *full-screen* controls keep their `.primary` and the `Dock orb` button.)

### Constraints / gotchas
- **Chromium only** — Safari/Firefox lack Document PiP; Float button is feature-gated.
- **`requestWindow()` requires a user gesture** — so the float is manual (button), never auto-on-blur. Also means it can't be driven in automated preview.
- The OS window has an **unavoidable native title bar** — can't be recoloured, forced to light, or removed (confirmed: no CSS/`color-scheme`/`theme-color` lever works). Its black is `#18191b`; we match the window background to it for a seamless surface rather than fighting it.

---

## One List hookup (Prompt 4, 2026-11-25)
- **No `doing` status any more.** Which task is in Focus is the in-memory `_focusId` (app.js); `_renderFocusRow()` reads `Data.findItem(_focusId)`. The task stays on Today the whole time. A page reload ends the session (minutes already written are kept) — the old persisted-`doing` resume is gone.
- Entry: Today item 1's **start** (`olStart` → `startTask(id)`) or the up-next card. `startTask` ends any other in-flight session first (as Back to Today) and logs a `started` task_event (id kept in `_focusStartEventId`).
- **Back to Today** (`removeFromDoing`, label changed from "Return to Next"): `_endFocusSession(item)` stops the timer and accrues work minutes onto `timeSpent`; the minutes are also written onto the session's `started` event (`Data.setEventMinutes`) so the Log can count them by day.
- **Done** (`markDoingDone`): accrues `timeSpent`, then `Data.completeTask(id, {minutes})` (archive + `done` event with this session's minutes); recurring tasks spawn their next occurrence and archive instead. Then `_focusHandoff = {doneTitle, minutes}` and the overlay stays open in a `.handoff` state: orb settles (paused), meta shows "✓ <title> · Nm focused", and a `.focus-upnext` card offers the next Today item (`Data.todayList()[0]`) with **Start ›**, or "Today's list is clear". **Back to Today** (`focusBackToToday`) exits. PiP is docked when the handoff shows.
- Minutes never double-count: a session's minutes are on exactly one event — its `started` row (if it ended with Back to Today) or the `done` row (if it ended with Done).
- Visual language of the overlay is unchanged (legacy paper/serif/mono tokens are allowed here and only here).
