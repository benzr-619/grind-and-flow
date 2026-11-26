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
