# One List — unattended build progress (2026-11-25)

Branch `one-list`. One entry per prompt from `ONE-LIST-BRIEF.md`.

**How each prompt was checked:** I can't sign in as you, so `dev/smoke.cjs` (Playwright, headless Chromium)
boots the real `index.html` with `dev/fake-supabase.js` swapped in for the supabase-js CDN script — a fake
session and in-memory seed data, no network, no credentials. A scenario script per prompt clicks through
the touched views and the run fails on any console error / page error. Run it yourself:
`./dev/serve.sh &` then `NODE_PATH=<dir with playwright 1.61> node dev/smoke.cjs dev/scenarios/<file>.cjs`.

---

## Prompt 1 — Schema migration + fresh start ✅
- Migration `one_list_model` (applied via Supabase MCP): `tasks` + `today_date`, `today_order`, `area`,
  `urgency`, `purpose`, `effort`, `source`, `meta`; check constraints on area (Research/AMD/EDBA/Home),
  urgency (asap/norush), effort (S/M/L), source (app/phone/claude). `archive` + `area`.
- New `task_events` table (text id PK, `user_id` default `auth.uid()`, event check constraint), RLS
  `auth.uid() = user_id` (using + with check), index `(user_id, at)`.
- **Counts before:** tasks = 15 (backlog 7, next 1, this-week 1, done 1, recurring 5); archive = 153.
- Moved the 1 `done` task into `archive` (`archived_at` = its `scheduled_date` 2026-11-01, since the real
  completion date lives only in browser localStorage; `time_spent` preserved). **After:** archive = 154, tasks = 0.
- Deleted all `tasks` rows (open + recurring), no backup, as pre-approved. `projects`/`tags`/`commitments` untouched.
- Decision: no DB check constraint on `status` (the old app code still writes old values until Prompts 2–3; enforcing in app code).
- Decision: `task_events.id` is text (app-generated, like every other table) rather than uuid.
- Docs: CLAUDE.md Data Model + `.claude/rules/supabase-mcp.md` updated.
- Added `dev/` smoke harness (fake-supabase.js, smoke.cjs, serve.sh). Old board loads with no console errors.

## Prompt 2 — Data layer ✅
- `data.js` only: mappers for the 8 new task columns, `archive.area`, and `task_events` (`_eventFromDb/_eventToDb`); events loaded into `_state.events`.
- Mutations: `addTask`, `pullToToday`, `sendBack`, `reorderToday`, `completeTask`, `logEvent` — all optimistic. Selectors: `todayList`, `openTasks`, `recurringTasks`, `ideas`, `events`.
- Decisions:
  - `addTask` takes an optional `recur` object so the entry bar can create recurring tasks (status `recurring`) through the same path (needed for Prompt 3/7).
  - `addTask(toToday)` logs `added` **and** `pulled`; ideas can't go straight to Today.
  - `pullToToday` on an idea converts it to `open`.
  - `completeTask` archives immediately (no lingering `done` row → no midnight sweep needed for new tasks).
  - Added `Data.localToday()` because the app's `_today()` uses `toISOString()` (UTC date — wrong in US evenings). Today membership uses local dates.
- Recurring spawn/due logic untouched (lives in app.js). Old board still loads (new `open` tasks just don't show there until Prompt 3).
- Check: `dev/scenarios/p2-data.cjs` asserts list/selector/event behavior; desktop + mobile boot with no console errors.

## Prompt 3 — Tokens + Today screen ✅
- **Tokens:** `--ol-*` set in `style.css :root` (ground #FCFCFA, ink #171717, ink-2, three greys, two hairlines, chip, one warm accent #C98B2A, start dot #E89A38, hot #A0522D, highlight) + four area colours + `--font-ol` (Inter via Google Fonts link). `--focus-*` untouched. Design.md §0 rewritten as the One List North Star; old palette marked legacy/Focus-only. Body background is now the off-white ground; PWA theme colour updated.
- **Today** is the only desktop home: `#ol-app` replaces the topbar + board markup in `index.html`; `renderBoard()` early-returns into `_renderOL()` on desktop (old render code left in place, unreachable, for Prompt 9 to delete).
- Entry bar with the full Tab flow; numbered drag-reorder list; hover "not today →" + done circle; "start" on item 1; divider after 10; Offered column with `RANK_WEIGHTS` + "I'm set ✓" (hidden for that day only) + "+ n more".
- New file **`parse.js`** (pure parser, `GFParse`) — I pulled the parser forward from Prompt 7 because Prompt 3 already needs `every …`. Inline shortcuts (`#amd asap`, `idea:`, `by fri`, `every 2w`) already work in the title step; Prompt 7 adds the duplicate hint + unit tests.
- Decisions:
  - New rolling recurrences start **one interval from today** (not due immediately); anchored get the next matching weekday/month-day; lead time 1 day. You can backdate/edit via the recurring modal.
  - Offered "why" for overdue reads "overdue · was Dec 4"; recurring pinned rows get both `+` (pull to Today) and `✓` (check off).
  - Invalid date text blocks Tab/Enter with a hint instead of silently dropping it.
  - Clicking a Today/Offered title opens the recurring modal for recurring tasks; the inline detail for normal tasks comes with Everything (Prompt 5).
  - `_today()` now returns the **local** date (was UTC via `toISOString`).
  - `_dailyRollover` no longer called (init + midnight); function deleted in Prompt 9.
  - Zoom out / log go to placeholder views until Prompts 5/6.
- Check: `dev/scenarios/p3-today.cjs` — ranking order, carry-over reason, Tab flow, Shift+Enter, inline shortcuts, `every 2w`, Backspace/Esc, pull, drag-reorder, not-today, done→archive, recurring check-off respawn, I'm set, nav. No console errors.

## Prompt 4 — Focus hookup ✅
- Focus no longer uses the `doing` status or the Next column: in-memory `_focusId` + `_focusStartEventId`. Overlay visuals unchanged.
- `started` logged on start; `done` logged with the session's work minutes; `time_spent` still accrues.
- On Done the overlay stays open with a "Up next on Today" card (next Today item + **Start ›**) or "Today's list is clear", plus **Back to Today**. "Return to Next" renamed "Back to Today".
- Decisions:
  - A reload ends a Focus session (it used to resume because `doing` was persisted). Simpler and avoids a stale `doing` row; minutes up to the last Back/Done are kept. If you want resume-after-reload later, store `_focusId` in `tasks.meta`.
  - Back-to-Today minutes are written onto that session's `started` event (new `Data.setEventMinutes`) so the Log can attribute minutes to days without double counting.
  - Starting a different task while one is in Focus ends the first as Back to Today.
- Check: `dev/scenarios/p4-focus.cjs` (start → back → start → done → up-next → start → done → clear → back; event sequence + archive). Today scenario still passes. No console errors.

## Prompt 5 — Everything (zoom out) ✅
- Zoom-out view with labeled clusters by area (incl. "No area" + "Ideas") / urgency (Now/Soon/Whenever/No rush/Ideas, from the Offered scoring) / date entered; items glide between groupings and drift gently; reduced-motion respected.
- Same entry bar; new items highlight briefly. Inline detail popover (also opens from Today/Offered titles).
- Legibility at ~60 items (decision instead of "propose"): layout search over 1–3 cluster rows and two line heights, sub-columns for big clusters, columns ≥200px or the canvas grows and scrolls. Verified no overlapping items with 57 seeded tasks.
- Check: `dev/scenarios/p5-everything.cjs`. No console errors.

## ⛔ Stopped here — usage limit reached (not a failure)
- **Not done:** Prompt 6 (Log — the "log" button shows a placeholder; old Archive view is unreachable but `archive` data is intact), Prompt 7 (duplicate hint + `dev/parse.test.js`; the parser itself and inline shortcuts already work), Prompt 8 (phone stopgap — **the old mobile companion is still live and does not understand the new `open` status**, so on a phone new tasks won't show and phone captures go to the retired `backlog` status), Prompt 9 (cleanup).
- **Not merged to main / not pushed**, because of the phone issue above: deploying now would give you a desktop One List but a phone surface that hides your tasks. Everything is committed on `one-list`.

---
*(Resumed after the usage-limit stop.)*

## Prompt 6 — Log ✅
- Log replaces Archive: "← today", week picker (‹ week of Nov 23 ›, no future weeks), big week total, totals by area, then days (newest first) → finished tasks → minutes.
- Minutes = sum of the task's `task_events` minutes, else `archive.time_spent` (so your 154 historical rows still show their focus time).
- Decisions: focus minutes on still-open tasks are shown on the day they were logged, marked "· still open", and count toward the week total. Restore brings a row back as a plain open task (archive rows don't keep recurrence/Today state). Delete uses an inline "delete for good? yes / no".
- Check: `dev/scenarios/p6-log.cjs` (totals, fallback, area totals, week nav, restore, delete). No console errors.

## Prompt 7 — Capture polish ✅
- Duplicate hint ("already have: …" · keep both · open existing) on a close title match against open tasks, ideas and recurring tasks.
- Inline shortcuts (`asap`, `no rush`/`norush`, `#area`, `by <date>`, simple dates), `idea:` prefix and `every …` were already built in Prompt 3 (`parse.js`); confirmed end-to-end here.
- `dev/parse.test.js` — 60 plain-node assertions covering urgency, dates (weekday/same-day/next, month-day, numeric, relative, year rollover, invalid), rolling vs anchored recurrence (incl. month-end clamp), areas, inline title shortcuts, duplicate matching.
- Decision: "keep both" is remembered for that exact title until the entry is saved/cleared.
- Check: `node dev/parse.test.js`; `dev/scenarios/p7-capture.cjs`; all earlier scenarios re-run green. No console errors.
