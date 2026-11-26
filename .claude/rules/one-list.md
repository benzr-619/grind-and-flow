# One List — Today, Offered, entry bar (2026-11-25)

Replaces the Tasks board / Projects canvas / Week view / Inbox Review on desktop.
Source of truth for behavior: `ONE-LIST-BRIEF.md` (Locked decisions) + the "v2 — minimal" mockups.

## Render path
- `index.html`: `#ol-app > #ol-view` (the old `.topbar` and `.board-section` markup were removed).
- `renderBoard()` → on mobile still the phone path; on desktop `_renderOL()` and return (old board code below it is unreachable until Prompt 9 deletes it).
- `_renderOL()` dispatches on module state `olView` (`'today' | 'everything' | 'log'`); each view renders its own header. `App.olGo(v)` switches. `document.body.dataset.olView` is stamped.
- Today = `_renderTodayView()` (shell) + `_renderTodayList()` + `_renderOffered()`; `_olRefreshLists()` re-renders lists without touching the entry bar (keeps focus/typed text).

## Today
- `Data.todayList()` (todayDate === local today, sorted by `todayOrder`). Numbered 1…n; item 1 gets **start** (`olStart` → Focus, Prompt 4); a quiet `.ol-ten-line` divider before item 11 and greyed numerals after 10.
- Hover reveals "not today →" (`olSendBack` → `Data.sendBack`) and the done circle (`olDone`: recurring → `_completeRecurring(id, today)`; else `Data.completeTask`). Rows fade out (`.ol-leaving`, reduced-motion skips).
- Drag-reorder: HTML5 DnD on `.ol-li`; `_olDropTarget` picks before/after by cursor midpoint; `Data.reorderToday(ids)` rewrites `todayOrder` 1..n. Drop indicator = `.drop-above/.drop-below` accent border.
- No rollover: `_dailyRollover` is no longer called (init + midnight timer). Yesterday's items just stop matching and earn the "on Today <day>" carry-over points in Offered.

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
