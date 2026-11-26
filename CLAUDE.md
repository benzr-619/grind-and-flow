# CLAUDE.md — Grind & Flow

## [AUTOMATIC MAINTENANCE]

New area-specific detail is appended directly to a targeted `.claude/rules/<area>.md` with a one-line pointer here — no rewrite of this file. Changing behavior already documented here requires confirmation first.

**After every session where a bug was fixed, a schema fact was discovered, or a gotcha was identified: update the relevant `.claude/rules/<area>.md` file immediately — do not wait to be asked.** If no rules file fits, create a new one under `.claude/rules/`. This is mandatory, not optional.

- [One List](./.claude/rules/one-list.md) — the desktop app: `_renderOL()` (`olView` today / everything / log); Today + Offered ranking (`RANK_WEIGHTS`), Tab-flow entry bar (`parse.js` / `GFParse`), duplicate hint, Everything clusters + inline detail popover, Log.
- [Phone stopgap](./.claude/rules/mobile.md) — bare ≤640px surface (`_renderPhone`): numbered Today (tap/swipe to complete + undo), due recurring, capture with tap chips. Fuller phone design is future work.
- [Focus Mode orb](./.claude/rules/focus-mode.md) — full-screen `#focus-zone` overlay (visual language unchanged), PiP float; One List hookup: in-memory `_focusId`, `started`/`done` events with minutes, post-Done "up next on Today" card.
- [Recurring tasks](./.claude/rules/recurring-tasks.md) — rolling/anchored data + spawn/due logic (kept); created via `every …` in the entry bar, pinned in Offered when due, edited in `openRecurringModal`. Top of the file says what changed for One List.
- [Supabase MCP](./.claude/rules/supabase-mcp.md) — project id, migrations (incl. `one_list_model`), gotchas.
- `.claude/rules/_retired/` — Tasks board, Projects canvas, Week view, Inbox Review (deleted 2026-11-25; history only).

---

> This file is the persistent context document for this codebase. Read it at the start of every session. Update it after any change that affects the data model, module interfaces, or feature status.

---

## App Overview

Grind & Flow is a single-user personal to-do app built around **one list** (rebuilt 2026-11-25 — see `ONE-LIST-BRIEF.md`, progress log `ONE-LIST-PROGRESS.md`). The previous app went unused because it needed upkeep; the principles now are: one list always visible, no upkeep, nothing disappears on its own, Today is a fresh page each day, capture is one line, simple first.

- **Today** (desktop home) — a numbered list you build each morning, drag to reorder, start item 1 into Focus.
- **Offered** — a ranked column beside Today (due recurring tasks pinned on top, then transparent points); "I'm set ✓" puts it away for the day.
- **Entry bar** — one line: title → Tab → priority/date → Tab → area. `every …` makes a recurring task; `idea:` makes an idea.
- **Everything** — "zoom out": every open task, recurring task and idea floating in clusters by area / urgency / date entered.
- **Focus** — the breathing-orb timer overlay (unchanged look).
- **Log** — week of finished tasks and focus minutes by area.
- **Phone** — a bare stopgap: Today, due recurring, capture.

Areas: exactly four — **Research, AMD, EDBA, Home** — one optional area per task. Tags, projects, Inbox, the Kanban board, Week view and Archive view are gone. Installable PWA. **Aesthetic:** minimal — Inter, off-white ground, near-black ink, almost no chrome (Design.md §0); the old planner look survives only inside the Focus overlay.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JS — no framework, no build step |
| Database + Auth | Supabase (Postgres + Auth), JS SDK v2 via CDN |
| CDN dependency | `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` |
| Fonts | Inter (Google Fonts, the app); Bricolage Grotesque / Source Serif 4 / JetBrains Mono (Focus overlay only) |
| PWA | `manifest.json` + `sw.js` (network-first, cache `gf-shell-v5`) |
| Hosting | GitHub Pages at `/grind-and-flow/` |
| Supabase project | `https://copzqbnjoakvcrvmedev.supabase.co` |
| Supabase MCP | Connected — project ID `copzqbnjoakvcrvmedev`. Use MCP tools for schema changes, migrations, and data inspection. See `.claude/rules/supabase-mcp.md`. |

Script load order in `index.html` is load-order dependent: `data.js` → `parse.js` → `auth.js` → `app.js`. Do not reorder.

---

## Module Map

### `auth.js` — Auth layer
Initializes the Supabase client, resolves the session, renders the sign-in overlay. Injects the client into `data.js` via `Data.setClient()` before any data calls, then calls `App.init()`. Owns the `DOMContentLoaded` entry point.
**Must not:** contain UI rendering logic beyond the auth overlay, know the schema, or call `Data.*` other than `setClient()`.

### `data.js` — Persistence layer
All Supabase reads/writes. Optimistic: every mutation updates in-memory `_state` (`tasks`, `archive`, `events`) immediately, then syncs in the background. Field mappers camelCase ↔ snake_case.
- Generic: `load`, `get`, `findItem`, `upsertTask`, `deleteItem`, `archiveItemWithDate`, `restoreFromArchive`, `deleteFromArchive`.
- One List: `addTask({title, urgency, dueDate, area, toToday, isIdea, source, notes, recur})` (the single creation path; `recur` = recurrence fields → status `recurring`), `pullToToday`, `sendBack`, `reorderToday(ids)`, `completeTask(id, {minutes, dateStr})` (archives immediately), `logEvent(taskId, event, minutes?)`, `setEventMinutes(eventId, m)`. Selectors: `todayList()`, `openTasks()`, `recurringTasks()`, `ideas()`, `events()`. `localToday()` (local YYYY-MM-DD — never `toISOString`), `AREAS`.
**Must not:** render UI, touch the DOM, or know about auth beyond the injected client.

### `parse.js` — Entry-bar parser (pure)
`GFParse.parseWhen` / `parseArea` / `parseTitle` / `parseDate` / `parseEvery` / `closeMatch`. No DOM, no Data. UMD-style: global in the browser, `require()`-able in node. Tests: `node dev/parse.test.js`.

### `app.js` — UI layer
All rendering and events, in the `App` IIFE: recurring logic + modal, Focus overlay + timer + PiP, the One List desktop views (Today / Offered / entry bar / Everything / detail popover / Log), the phone stopgap. `App.init()` is called only by `auth.js`; `_initialized` guards double-init. `renderBoard()` → `_renderPhone()` at ≤640px, else `_renderOL()`.
**Must not:** call Supabase directly or contain auth logic.

### `index.html` — Shell
Static DOM only: auth overlay, `#ol-app > #ol-view` (desktop), `#mobile-app` (phone), `#focus-zone` (Focus overlay), `#modal-root`. Inline handlers call `App.*` / `Auth.*`.

### `style.css` — Styling
Tokens in `:root`: `--ol-*` + `--area-*` + `--font-ol` for the app; legacy `--paper/--ink/--steel/…` and `--focus-*` for the Focus overlay only (legacy shells like the recurring modal re-point the legacy tokens to `--ol-*` locally). Never hardcode hex in new rules.

### `Design.md` — Design spec
§0 is the One List North Star; everything after it is legacy (Focus overlay reference).

### `dev/` — Local checks (not loaded by the app)
`serve.sh` (serves the repo at `localhost:8765/grind-and-flow/`), `smoke.cjs` + `fake-supabase.js` (headless Playwright boot against an in-memory fake Supabase — no credentials), `scenarios/*.cjs` (per-feature click-throughs), `parse.test.js`.

---

## Data Model

Tables in use: `tasks`, `archive`, `task_events` — all scoped by `user_id`, RLS `auth.uid() = user_id`. Still in Supabase but **unused** since 2026-11-25: `projects`, `tags`, `commitments`.

### `tasks`

`status`: `open` / `recurring` / `idea` (and `done` transiently — completion archives immediately). The old `backlog`/`this-week`/`next`/`doing` values are retired.

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| id | id | `'t' + Date.now() + rand` |
| type | type | `standalone` (legacy `task` = project-linked) |
| title | title | |
| status | status | see above |
| todayDate | today_date | date — on Today when `= local today`. No rollover job |
| todayOrder | today_order | numeric — position on Today |
| area | area | check `Research`/`AMD`/`EDBA`/`Home`, nullable |
| urgency | urgency | check `asap`/`norush`, nullable |
| dueDate | due_date | the soft by-date; for anchored recurring = next due date |
| scheduledDate | scheduled_date | rolling recurring = next expected date; otherwise unused |
| notes | notes | |
| dateAdded | date_added | drives "added N days ago" + age points |
| timeSpent | time_spent | int, Focus work-minutes accrued |
| purpose / effort / source / meta | purpose / effort / source / meta | future-proofing; `source` = `app`/`phone`/`claude`; `effort` S/M/L; `meta` jsonb |
| recurrence, recurrenceSeriesId, recurrenceWeekdays, recurrenceMonthDay, recurrenceIntervalN, recurrenceIntervalUnit, recurrenceLeadDays, recurrenceLastCompletedAt, recurrenceAlternate | recurrence_* | see [recurring-tasks rule](./.claude/rules/recurring-tasks.md) |
| parentProject, scheduledTime, blocked, blockedReason, tags, backlogEnteredAt, laterCount, dayOrder, boardOrder | … | legacy columns, no longer read or written by the UI |
| — | user_id | injected by `_taskToDb()` |

### `archive` — finished tasks (the Log's history)
Same shape as tasks (lean subset) plus `archived_at` (completion date, text YYYY-MM-DD), `original_status`, `time_spent`, `area`, `recurrence`, `recurrence_series_id`. Gotcha: `archive.blocked/tags/subtasks` are `text`, not boolean/jsonb. Old rows include `type = 'project'` (skipped by the Log).

### `task_events` — activity log
`id` text PK, `user_id` (default `auth.uid()`), `task_id` text (no FK), `event` check `added`/`offered`/`pulled`/`sent_back`/`started`/`done`, `at` timestamptz, `minutes` int nullable. Index `(user_id, at)`. A Focus session's work minutes live on exactly one event: its `started` row (ended with Back to Today) or its `done` row (ended with Done). `offered` is logged once per task per day.

**Fresh start (2026-11-25, migration `one_list_model`):** all open/recurring tasks were deleted (old list snapshot: `Grind-and-Flow-snapshot-2026-11-25.docx`); the 1 done task moved into `archive`.

---

## Rules & Conventions

### Architecture — hard rules
- `app.js` never calls Supabase directly. All persistence goes through `Data.*`.
- `data.js` and `parse.js` never touch the DOM.
- `auth.js` owns the Supabase client and injects it via `Data.setClient()` before `App.init()`.
- `App.init()` is only called from `auth.js`. No `DOMContentLoaded` listener in `app.js`.

### Editing discipline
- Targeted, minimal edits. Confirm the approach before multi-module changes.
- Update this file after any change to the data model, module interfaces, or feature status.
- After changing behavior, run the relevant `dev/scenarios/*.cjs` (and `node dev/parse.test.js` for parser changes).

### Data mutations
- Create tasks only via `Data.addTask`. Persist edits with `Data.upsertTask(item)`. Complete via `Data.completeTask` (plain) or `_completeRecurring` (recurring — spawns the next occurrence first).
- Dates are local: use `Data.localToday()` / `_today()`, never `toISOString().split('T')[0]`.

### DOM stability — do not rename
- `#ol-view`, `#mobile-app`, `#modal-root`, `#focus-zone`, `#focus-meta`, `#focus-orb`, `#focus-orb-glow`, `#doing-cards-row` (orb subtree — moves into the PiP window), `#doing-section`, `#focus-orb-controls`, `#focus-clock-time`.
- `data-id="{taskId}"` on `.ol-li`, `.ol-off-row`, `.ev-it`, `.ph-row`, `.lg-row`.
- Entry bar ids: `#ol-entry-{ctx}` / `#ol-input-{ctx}` (ctx `today` | `everything`).

### Styling
- New UI uses `--ol-*` tokens and Inter. No hex in new rules. Respect `prefers-reduced-motion` for every animation.

### localStorage
None. (The old `gf-completion-dates` key is no longer used.) All user state lives in Supabase.

---

## Feature Status

### Complete and working (2026-11-25, One List)
- **Today** — date header with *zoom out* / *log* / sign-out; entry bar; numbered drag-reorder list; hover *not today →* + done circle; *start* on item 1; quiet divider after item 10.
- **Offered** — due/overdue recurring pinned (✓ to check off, + to pull); points ranking (`RANK_WEIGHTS`: asap +50; by-date overdue +60 / ≤2d +40 / ≤7d +25 / later +10; on Today in last 3 days +30; added in last 3 days +15; age +1/week max +10; no rush −40); ~12 shown with "+ n more"; one reason per row; *I'm set ✓* hides it for the day.
- **Entry bar** — Tab flow, Enter → Offered/Everything, Shift+Enter → Today, Backspace steps back, Esc clears; inline shortcuts (`#amd asap`, `by fri`, `idea:`); `every 5d|2w|month` (rolling) / `every mon|15th` (anchored); duplicate hint (keep both / open existing).
- **Everything** — zoom-out transition; clusters by area / urgency / date entered with glide; drift; solid dot = on Today, hollow = idea; legible at ~60 items (row/sub-column layout search); inline detail popover (title, priority, due, area, notes, add to / take off Today, make a task, delete; recurring → ↻ cadence + edit recurrence).
- **Focus** — orb overlay + timer + PiP unchanged; in-memory focus task; Back to Today / Done; "up next on Today" handoff card; `started`/`done` events with minutes.
- **Recurring** — rolling + anchored, spawn on completion (anchored confirm prompt), backdated completion, alternating pairs; edited via the recurring modal.
- **Log** — week picker, week total, totals by area, days → finished tasks → minutes (events, falling back to `time_spent`), quiet restore/delete.
- **Phone stopgap** — numbered Today (tap/swipe to complete, undo), due recurring, capture bar with chips.
- **Auth** — email/password sign-in/up, cross-tab sign-out. **PWA** installable.

### Not built / known gaps
- Phase 2: Claude "add to Grind" skill via the Supabase connector (fixed insert template, never freeform SQL); ranking tuning from `task_events`.
- Fuller phone design (native SwiftUI rebuild planned later — see `ONE-LIST-BRIEF.md`).
- Log redesign (week/month toggles, stacked-by-area chart).
- Focus does not survive a page reload (session ends; minutes up to the last Back/Done are kept).
- Not verified on a real iPhone or against the real Supabase session in-browser (checks run against a fake client — see `dev/`).
- Search, export/import: removed with the old UI.
