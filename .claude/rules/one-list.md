# One List — Today, Offered, entry bar (2026-11-25)

Replaces the Tasks board / Projects canvas / Week view / Inbox Review on desktop.
Source of truth for behavior: `ONE-LIST-BRIEF.md` (Locked decisions) + the "v2 — minimal" mockups.

## Render path
- `index.html`: `#ol-app > #ol-view` (the old `.topbar` and `.board-section` markup were removed).
- `renderBoard()` → `_renderPhone()` at ≤640px, else `_renderOL()`. (The old board/canvas/week/inbox/archive code was deleted in Prompt 9.)
- `_renderOL()` dispatches on module state `olView` (`'today' | 'everything' | 'log'`); each view renders its own header. `App.olGo(v)` switches. `document.body.dataset.olView` is stamped.
- Today = `_renderTodayView()` (shell) + `_renderTodayList()` + `_renderOffered()`; `_olRefreshLists()` re-renders lists without touching the entry bar (keeps focus/typed text).

## Today
- `Data.todayList()` (todayDate === local today, sorted by `todayOrder`). Numbered 1…n; item 1 gets **start** (`olStart` → Focus, Prompt 4); a quiet `.ol-ten-line` divider before item 11 and greyed numerals after 10.
- Hover reveals "not today →" (`olSendBack` → `Data.sendBack`) and the done circle (`olDone`: recurring → `_completeRecurring(id, today)`; else `Data.completeTask`). Rows fade out (`.ol-leaving`, reduced-motion skips).
- Drag-reorder: HTML5 DnD on `.ol-li`; `_olDropTarget` picks before/after by cursor midpoint; `Data.reorderToday(ids)` rewrites `todayOrder` 1..n. Drop indicator = `.drop-above/.drop-below` accent border.
- No rollover: `_dailyRollover` is gone; a midnight timer (`_scheduleMidnight`) just re-renders. Yesterday's items just stop matching and earn the "on Today <day>" carry-over points in Offered.

## Offered (ranking)
- `RANK_WEIGHTS` constant (app.js) is the one place to tune. `_olScore(task, today)` → `{score, why, hot}`; `why` = the single strongest positive reason (fallback: "no rush" / "added N days ago").
- Order: due-soon/overdue recurring (`_recurDueList()`) pinned on top with a ✓ check-off + `+` pull; then open tasks not on Today by score desc, then older first. Shows `OFFER_LIMIT = 12` (pinned count against it), "+ n more" expands.
- "I'm set ✓" hides the column **for the rest of that day** (`_offerHiddenDate`); "+ show offered (n)" restores. Saving a task to Offered un-hides it (shows where it went — matches the mockup).
- `offered` events logged once per task per day (`_olLogOffered`, deduped against loaded events).
- `_today()` was changed to local date (it used `toISOString()` = UTC, which flips to tomorrow in US evenings).

## Entry bar (`_entryBarHtml(ctx)`, ctx = 'today' | 'everything')
- Per-context state `_entry[ctx] = {step, title, when, whenRaw, field}`; `_entrySync(ctx)` patches tokens/hints/placeholder in place (never re-renders the input).
- Keys (`_olKey`): Tab advances title → priority/date → area (blocked with a hint if the date doesn't parse); Shift+Tab / Backspace-on-empty step back; Enter saves (→ Offered / Everything); Shift+Enter saves straight onto Today; Esc clears. Hint chips are clickable (`_olChip`).
- Parsing is `parse.js` (`GFParse`, pure, node-testable): `parseWhen` (asap / a, no rush / n, dates like fri, dec 4, 12/4, in 3d, tomorrow; `every 5d|2w|month` → rolling; `every mon [thu]` / `every 15th` → anchored with the default rule + first due date), `parseArea` (letter/prefix), `parseTitle` (inline `idea:`, `#area`, trailing asap/no rush/by <date>/every …).
- Save → `Data.addTask({... recur})`. Rolling recurrences start one interval from today (`scheduledDate`); anchored get `dueDate` = next matching day. Lead days default 1.

## Everything (Prompt 5)
- `olView === 'everything'` → `_renderEverything()` (header: back to today · group-by `area|urgency|date entered` · count; entry bar ctx `everything`; `#ev-canvas`) then `_afterEverythingRender()`.
- Items = open + recurring + idea tasks. `_refreshEverything()` groups (`_EV_GROUPS`, `_evGroupOf`; urgency buckets reuse `_olScore`), then picks a layout over 1–3 rows of clusters × line heights 34/27 maximising the narrowest column; crowded clusters split into sub-columns; if columns would be < 200px the canvas grows and the page scrolls. Measure with `offsetTop` (canvas is scaled during the zoom).
- Items are stable DOM nodes keyed by id → regroup only changes left/top (CSS glide). Inner `.ev-drift` drifts (paused on hover). Solid ink dot = on Today; hollow = idea; else area colour. Zoom-out on entry (`_evZoomed`), zoom-in on return to Today. All motion off under reduced-motion.
- Click → inline detail popover `#ol-detail` (`olOpenDetail`, also used from Today/Offered titles): title, priority, due, area, notes, add to / take off Today, ideas "make a task", delete with inline confirm; recurring shows ↻ cadence + "edit recurrence…" → `openRecurringModal`.

## Log (Prompt 6) — replaces the Archive view
- `olView === 'log'` → `_renderLog()`; week picker `_logWeek` (Mon-start, ≤ 0 — no future weeks).
- `_logData(offset)`: finished tasks = non-project `archive` rows whose `archivedAt` falls in the week, grouped by that day. Minutes per finished task = sum of its `task_events` minutes (started + done), else `archive.time_spent` (pre-events history). Focus minutes logged that week on tasks still open appear as "· still open" rows on the day the event was logged. Week total + totals by area (unknown → "No area").
- Quiet hover actions per finished row: **restore** (`logRestore` → `Data.restoreFromArchive`, then forced to a plain `open` task — no recurrence, not on Today) and **delete** (inline confirm → `Data.deleteFromArchive`).

## Capture polish (Prompt 7)
- **Duplicate hint** `_olDupHint(ctx)` (runs inside `_entrySync`): parsed title vs open/idea/recurring tasks via `GFParse.closeMatch` (exact, substring ≥6 chars, or word-overlap score ≥ 0.6; titles < 4 chars ignored). Shows `.ol-dup` "already have: …" with **keep both** (`_olDupKeep` — stores `_entry[ctx].dupKeep` so the hint stays away for that title) and **open existing** (`_olDupOpen` — clears the entry, opens the detail popover).
- Inline shortcuts in the title step show as preview chips while typing (idea / area / when).
- Parser tests: `node dev/parse.test.js` (60 assertions, fixed today = Wed 2026-11-25). Run after any `parse.js` change.

## Cleanup notes (Prompt 9)
- `_hashStr` now returns a uint32 (FNV-1a). It used to return a [0,1) float (for the old project orbs), which made Everything's `% n` jitter/drift-delays all ~0 — fixed.
- CSS was pruned automatically to selectors still referenced by `app.js` / `index.html` / `auth.js` (3,199 → ~1,000 lines), then hand-checked. Legacy shells (recurring modal, `.rc-*` overlays, phone bottom sheet, auth) get the minimal look by re-pointing legacy tokens to `--ol-*` inside them (block at the end of `style.css`).
- Smoke checks: `./dev/serve.sh &` then `NODE_PATH=<dir with playwright 1.61> node dev/smoke.cjs dev/scenarios/<name>.cjs [--mobile]`; `p9-tour.cjs` screenshots every view.

## Keyboard shortcuts (2026-11-26) — desktop only
- **⌥ (Option/Alt), not single keys.** Today and Everything autofocus the entry bar, so single-key shortcuts meant hitting Esc first. Global shortcuts now need ⌥ and work *while the bar has focus*. (The first single-key version, with N or / to focus the bar and "Esc on an empty bar blurs it", was replaced the same day. Both are gone.)
- **One key map:** `SHORTCUTS` (app.js, just above the modal shell). Each entry = `{scope, keys, action, label}`. A combo string from `_keyCombo(e)` = modifiers in a fixed order (`mod+` = ⌘/Ctrl, `alt+`, `shift+`) followed by **`e.code`** (`KeyT`, `Slash`, `Enter`, `Space`, `Escape`). Match on `e.code`, never `e.key`: on a Mac ⌥T reports `key: '†'` and ⌥E/⌥N/⌥U/⌥I are dead keys (`key: 'Dead'`). Scopes: `global` (Focus closed), `handoff` (the up-next card; checked before `focus`), `focus` (overlay open). The cheat sheet and the header hint (`_comboText(_HELP_KEY)`, "⌥/ shortcuts" or "Alt+/ shortcuts") both render from the map.
- **Keys:** ⌥T / ⌥E / ⌥L → `olGo`. ⌥S → `olStart(todayList()[0])` (no-op if Today is empty). ⌥/ → cheat sheet (Esc or ⌥/ closes; other shortcuts are inert while it's open). In Focus: **Space** (plain) → `activateTask` if the timer isn't on this task / `startNextSegment` at a boundary / else `timerTogglePlay`; **Esc** (plain) → `removeFromDoing`, or `focusBackToToday` in handoff; ⌥Enter → `markDoingDone`, or in handoff `startTask(todayList()[0])`; ⌥F → `openFocusPip`/`closeFocusPip` (skipped when `_pipSupported` is false).
- **Listener:** `_onShortcutKey`, one `document` keydown listener added in `init()` (guarded by `_initialized`). It's also attached to the PiP window's document in `openFocusPip`. It bails on `defaultPrevented`, IME composing, `_isMobile()`, `#modal-root` non-empty (recurring modal, `.rc-*` confirms) or `#ol-detail` open. **Plain** combos (Space/Esc) also bail when the target is editable (input/textarea/select/contenteditable); `alt+` combos don't. Every matched combo is `preventDefault`-ed, repeats included (so a held ⌥T never types into the bar); repeats don't run the action. Unmatched combos (⌥⇧L, ⌘L…) pass through.
- **Entry bar interplay:** `_olKey` runs first (inline handler). It ignores ⌥+letter, but ⌥Enter in the bar still hits its Enter branch and saves. That's harmless: ⌥Enter is only a Focus shortcut, and the bar is never focused under the overlay. Opening the cheat sheet blurs the bar (so a plain Esc closes the sheet instead of clearing the text) and gives it focus back on close.
- **Focus overlay vs. the entry bar:** `_renderFocusRow` blurs anything focused inside `#ol-view` when the overlay or handoff shows, and `_renderOL` doesn't autofocus while `_focusOpen()`. Without that, Space would type into the hidden bar and plain Space/Esc would be swallowed by the editable-target rule.
- CSS: `.ol-kbd-hint` (faint header button) and `.ks-*` at the end of `style.css`, hidden ≤640px.
- **Hold-⌥ hints:** pressing ⌥ alone (no ⌘/Ctrl/⇧, not a repeat) starts a `_HINT_DELAY` (400ms) timer. When it fires, `_showKbdHints` stamps `data-kbd` (from `_comboText` of the map) on every `[data-sc="<action>"]` element and adds `body.kbd-hints`, and CSS shows a faint `::after` key chip (below nav buttons, above `#focus-zone` controls). Any other keydown, ⌥ keyup (`_onShortcutKeyUp`, also on the PiP doc) or window `blur` (⌥-Tab never sends a keyup) hides them, so a quick ⌥T never flashes them. Not shown while the cheat sheet, a modal or the detail popover is up, or on the phone. **To give a new control a hint:** add `data-sc="<action>"` to it (it must be a `SHORTCUTS` action and not absolutely positioned; `[data-sc]` gets `position:relative`). Tagged today: nav today/everything/log, the header hint (help), `.ol-start`, and the Focus Back/Pause-Resume-Start/Done/Float buttons plus the handoff Start ›/Back buttons. The PiP hover controls are not tagged.
- Check: `node dev/smoke.cjs dev/scenarios/shortcuts.cjs` (plus `--mobile`: keys do nothing there). It dispatches synthetic keydowns with `code` + `altKey` + Mac-style `key` values (`'†'`, `'Dead'`), and real `Alt+KeyT`/`Alt+KeyE` presses over typed text (asserting no stray character, text kept, event `defaultPrevented`). Headless Chromium doesn't insert ⌥ characters itself, so the `defaultPrevented` assert is what really guards that. ⌥F/PiP isn't automated (it needs a real window and a user gesture).
