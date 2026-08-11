# CLAUDE.md — Grind & Flow

## [AUTOMATIC MAINTENANCE]

New area-specific detail is appended directly to a targeted `.claude/rules/<area>.md` with a one-line pointer here — no rewrite of this file. Changing behavior already documented here requires confirmation first.

**After every session where a bug was fixed, a schema fact was discovered, or a gotcha was identified: update the relevant `.claude/rules/<area>.md` file immediately — do not wait to be asked.** If no rules file fits, create a new one under `.claude/rules/`. This is mandatory, not optional.

- [Mobile responsive layer](./claude/rules/mobile.md) — sticky header offsets, show/hide pattern, `mobileTab` state, bottom sheet wiring, Inbox/backlog relabel map.
- [Focus Mode orb](./claude/rules/focus-mode.md) — full-screen `#focus-zone` overlay, persistent-orb/class-swap render, stable-id mapping, `_renderTimerTrack` now a no-op, `--focus-*` tokens, mobile `!important` hide.
- [Inbox Review wheel](./claude/rules/inbox-review.md) — Inbox removed from board columns (now This Week/Next/Done); full-screen `#inbox-review` 3D task-wheel review; `_reviewSeq`/`_reviewOutcome`/`_reviewCenterId` model; due→oldest order; staged-delete-on-close + undo; `later_count` column.
- [Week (Calendar) view](./claude/rules/calendar-week.md) — phase-4 Grind weekly-review surface; top-level `view==='calendar'` rendered in `#board`; Monday-start `_weekOffset` with past (accomplishments) / current / future (tentative) states; `_isFutureWeek` removes future-placed `this-week` tasks from the live board column; drag sets `scheduledDate`+`dayOrder`; lightweight `commitments` table; `time_spent` focus-minute capture foundation.
- [Projects canvas](./claude/rules/projects-canvas.md) — **Column-per-tag layout** (max 4 cols/row, user-draggable column order via `tags.sortOrder`) laid out as a **shared status grid**: every column in a grid-row aligns its Active/Up-next/Ideation/On-hold bands at the same Y, so an empty status in one column is just empty space, not a floated-up stack; column titles sit above a divider, status row labels run down a fixed left gutter (once per grid-row, not repeated per column). Orbs sized+colored by status (`PROJ_STATUS_COLORS`: amber/yellow/blue/pink); `.proj-orb-hit` child handles circular click target; hover via `:has(.proj-orb-hit:hover)`; `drop-shadow` filter provides ambient glow (escapes `clip-path`). Same-status overlap lightened + alternating left/right offset so overlapping orbs stay individually clickable. Subtasks are first-class `tasks` rows (`parentProject`); project-space modal (1040px, enlarged type) shows grouped child tasks + quick-add. Legend bar above canvas (always visible). Migration done 2026-06-16 (41 rows).
- [Tasks board](./claude/rules/tasks-board.md) — This Week/Next/Done drag-reorder now persists via new `board_order` column (This Week/Done) and the existing `dayOrder` (Next); fixed a shared `_dragAfterEl` selector bug that also silently broke Week view day-column reorder; legibility font-size pass; persistent `.next-start-orb` (click + drag-swap) replaces the old overlapping `.focus-drop-zone`; `_dailyRollover` now also re-runs live at midnight.
- [Recurring tasks](./claude/rules/recurring-tasks.md) — reworked same day (2026-07-01): `rolling`/`anchored` recurrence (not weekly/monthly/interval) as flat columns on `tasks`; recurring tasks live permanently in a dedicated `Recurring` board column (`status:'recurring'`, never auto-promoted) and are created/edited only via `openRecurringModal`, not the Detail/New Item modals; next occurrence spawned on completion via `_maybeSpawnRecurrence` (rolling silent, anchored via a manual-confirm prompt); each occurrence archives as its own permanent row, traced by a shared `recurrenceSeriesId`. Later same day: rolling-only "+Nd overdue" escalation badge on the Recurring card, driven by `recurrenceLastCompletedAt` vs. the cadence interval, plus optional rolling-only alternating pairs (`recurrenceAlternate` jsonb) that ping-pong a second title/tags/notes template in and out on each completion. **2026-08-11**: recurring tasks are now completed by a direct checkmark (`completeRecurringToday`/`_completeRecurring`) — the old Focus-start button is gone entirely; unified `_recurDueState` drives due-soon/overdue styling for both rolling and anchored (rolling now reads its own `scheduledDate`, with a settable `recurrenceLeadDays` due-soon window like anchored already had); a `.recur-due-banner` surfaces due-soon/overdue recurring tasks across the top of the Tasks board; completions can be backdated via `openRecurLogDate`. A learned/algorithmic interval suggestion (surfacing due-soon ahead of a learned average gap instead of the fixed interval) is scoped but not built.

---

> This file is the persistent context document for this codebase. Read it at the start of every session. Update it after any change that affects the data model, module interfaces, or feature status.

---

## App Overview

Grind & Flow is a single-user personal productivity web app for managing projects, tasks, and focus sessions. It targets people who want the intentionality of an analog planner with the convenience of a digital tool. Users manage dual Kanban boards (Projects and Tasks), start tasks into a full-screen focus session, triage their Inbox in a dedicated review, and review completed work in a time-grouped Archive. The app is installable as a PWA on desktop and mobile.

> **Active redesign — read `Design.md` §0 (North Star) + `REDESIGN-BRIEF.md` before UI work.** The app is being rebuilt around **four modes** (Planning · Focus · Projects · Calendar), governed by one aesthetic axis: **Flow = soft/calm (the breathing orb — reserved for Focus only); Grind = firm/structured (solid shapes, connected nodes, vivid flat colours — e.g. the Inbox Review wheel).** Deliberate activities are full-screen overlays (`z-index 200`). Shipped: Focus orb (phase 1), Inbox Review wheel + 3-column board (phase 2), Projects spatial canvas (phase 3), **Calendar week view (phase 4)**. A **design polish pass** (2026-06-22) replaced the topbar wordmark/icon buttons with a see-vs-do nav split (quiet left tabs · firm right action buttons), introduced tag-colored orb bullets on the Tasks board, and redesigned the Week view as **"The Thread"** — editorial thread with station nodes + serif task lines. A **navigation restructure** (2026-07-01) sharpened that split further: Tasks/Projects are now large primary tabs (Archive moved off the primary row); Review Inbox, Week, and Archive collapse into a compact label-less icon row, grouped apart and de-emphasized until hovered/active — see the Navigation redesign section of `.claude/rules/calendar-week.md`. The four-mode redesign is now feature-complete on desktop. **Desktop-first; do not touch mobile during redesign passes.**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JS — no framework, no build step |
| Database + Auth | Supabase (Postgres + Auth), JS SDK v2 via CDN |
| CDN dependency | `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` |
| Fonts | Bricolage Grotesque (display), Source Serif 4 (body), JetBrains Mono / IBM Plex Mono (labels) |
| PWA | `manifest.json` + iOS meta tags |
| Supabase project | `https://copzqbnjoakvcrvmedev.supabase.co` |
| Supabase MCP | Connected — project ID `copzqbnjoakvcrvmedev`. Use MCP tools for schema changes, migrations, and data inspection instead of manual SQL. See `.claude/rules/supabase-mcp.md`. |

Script load order in `index.html` is load-order dependent: `data.js` → `auth.js` → `app.js`. Do not reorder.

---

## Module Map

### `auth.js` — Auth layer
Initializes the Supabase client, resolves the current session, and renders the login/signup overlay. Injects the client into `data.js` via `Data.setClient()` before any data calls are made. Calls `App.init()` once a valid session is confirmed. Owns the `DOMContentLoaded` entry point — this is where the app boots.

**Must not:** contain UI rendering logic, know about the database schema, or call `Data.*` functions other than `setClient()`.

### `data.js` — Persistence layer
All Supabase reads and writes go through this module. Uses optimistic updates: every mutation updates the in-memory `_state` object immediately (keeping UI instant), then fires a background Supabase call. Contains all field mappers for JS camelCase ↔ DB snake_case. Has a one-time migration path that imports legacy localStorage data into Supabase on first load for existing users. `Data.save()` / `Data.saveNow()` are no-op shims kept for backward compatibility — do not use them in new code.

**Must not:** render any UI, reference DOM elements, or know anything about auth beyond accepting the injected client.

### `app.js` — UI layer
All rendering and event handling lives here. Calls `Data.*` functions for all state mutations. `App.init()` is called by `auth.js` — there is deliberately no `DOMContentLoaded` auto-init in this file. The `_initialized` flag on the `App` object prevents double-init on token refresh.

**Must not:** call Supabase directly, reference `_client`, or contain auth logic.

### `index.html` — Shell
Static DOM structure only: auth overlay, topbar, `#focus-zone` (Focus orb overlay), board section, `#inbox-review` (Inbox Review overlay), modal root. No logic. Inline event handlers call into `App.*` and `Auth.*` by name.

### `style.css` — Styling
All CSS custom properties (variables) that map to design tokens from `Design.md`. Use these variables everywhere — never hardcode hex values in new rules.

### `Design.md` — Design system spec
Source of truth for color hex values, font stacks, spacing scales, and the "analog planner" aesthetic. Read this before adding any new styled elements or components.

### `manifest.json` — PWA manifest
App name, icons, theme color (`#ece2cd`), display mode. No logic.

---

## Data Model

Four Supabase tables, all scoped by `user_id` (uuid from Supabase Auth).

### `projects` table

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| id | id | `'p' + Date.now()` format |
| title | title | |
| status | status | `active`, `up-next`, `on-hold`, `someday` |
| dueDate | due_date | date string or null |
| scheduledDate | scheduled_date | date string or null |
| scheduledTime | scheduled_time | time string or null |
| notes | notes | |
| dateAdded | date_added | date string |
| blocked | blocked | boolean |
| blockedReason | blocked_reason | text or null |
| waiting | waiting | boolean — true when one or more child tasks are blocked (or manually set) |
| waitingReason | waiting_reason | text or null |
| waitingAuto | waiting_auto | boolean — true if the waiting state was set automatically by a blocked child task; false if manually set |
| tags | tags | jsonb array of strings |
| subtasks | subtasks | jsonb array of subtask objects |
| capacitiesUrl | capacities_url | text or null — deep link to the linked Capacities object |
| — | user_id | injected by `_projToDb()` |

Subtask object shape (**deprecated — phase 3**): `{ id, title, done, promoted, loc, promotedTaskId? }`. The `subtasks` jsonb column is kept for backward-compat/archive rows but is no longer read or written by the app. A project's tasks are now first-class `tasks` rows linked by `parentProject`. See [Projects canvas rule](./claude/rules/projects-canvas.md).

### `tasks` table

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| id | id | `'t' + Date.now()` format |
| type | type | `standalone` or `task` (linked to project) |
| title | title | |
| status | status | `backlog`, `this-week`, `next`, `doing`, `done`, `recurring` — **`backlog` is surfaced as "Inbox" in all UI labels; the internal string is unchanged**. `recurring` is the permanent home for a recurring task between occurrences — it renders in its own dedicated `Recurring` board column (leftmost in `TASK_COLS`) and is never auto-promoted to another status; created/edited only via `openRecurringModal`, not the New Item/Detail modals (see [recurring-tasks rule](./claude/rules/recurring-tasks.md)) |
| parentProject | parent_project | project id or null |
| dueDate | due_date | |
| scheduledDate | scheduled_date | |
| scheduledTime | scheduled_time | |
| notes | notes | |
| dateAdded | date_added | |
| blocked | blocked | boolean |
| blockedReason | blocked_reason | |
| tags | tags | jsonb array |
| backlogEnteredAt | backlog_entered_at | set when item enters backlog; drives the "time in Inbox" age counter |
| laterCount | later_count | integer, default 0 — times the task has been bumped to "Later" in Inbox Review; shown as "bumped N×" |
| dayOrder | day_order | numeric, nullable — within-day priority order in the Week (Calendar) view; nulls sort last |
| timeSpent | time_spent | integer, default 0 — actual Focus work-minutes logged on the task (capture foundation for future duration estimates) |
| boardOrder | board_order | numeric, nullable — manual drag-reorder position within the Tasks board's This Week / Done columns; nulls sort last. (Next column reuses `dayOrder` instead — see [tasks-board rule](./claude/rules/tasks-board.md).) |
| recurrence | recurrence | `null` \| `'rolling'` \| `'anchored'` — see [recurring-tasks rule](./claude/rules/recurring-tasks.md) |
| recurrenceSeriesId | recurrence_series_id | stable id shared by every occurrence in a recurring series |
| recurrenceWeekdays | recurrence_weekdays | jsonb int[], `0=Mon…6=Sun` — anchored-only, optional default-rule suggestion (not a hard schedule) |
| recurrenceMonthDay | recurrence_month_day | int 1–31 — anchored-only, optional default-rule suggestion |
| recurrenceIntervalN | recurrence_interval_n | int — rolling-only |
| recurrenceIntervalUnit | recurrence_interval_unit | `'days'` \| `'weeks'` \| `'months'` — rolling-only |
| recurrenceLeadDays | recurrence_lead_days | int, nullable — anchored-only; days before `dueDate` the Recurring-column card starts styling as due-soon |
| recurrenceLastCompletedAt | recurrence_last_completed_at | date, nullable — rolling-only; date the cadence last had any completion, drives the "+Nd overdue" escalation badge (null = unknown, not "today") — see [recurring-tasks rule](./claude/rules/recurring-tasks.md) |
| recurrenceAlternate | recurrence_alternate | jsonb `{title, notes, tags}`, nullable — rolling-only; the "other side" of an alternating pair, swapped in as the spawned occurrence's content on each completion — see [recurring-tasks rule](./claude/rules/recurring-tasks.md) |
| — | user_id | injected by `_taskToDb()` |

### `archive` table

Same shape as `tasks`, plus two additional fields:

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| archivedAt | archived_at | date stamped at archive time |
| originalStatus | original_status | status before archiving |
| timeSpent | time_spent | integer, default 0 — carried over from the task's logged Focus minutes |
| recurrence | recurrence | `null` \| `'rolling'` \| `'anchored'` — carried over for history; not re-read to spawn anything (that only happens off the live occurrence in `tasks`) |
| recurrenceSeriesId | recurrence_series_id | lets the Detail modal's "Past occurrences" list find every archived occurrence of a recurring series — see [recurring-tasks rule](./claude/rules/recurring-tasks.md) |

Archived projects also carry a `subtasks` jsonb array (same as the projects table). Note `laterCount`/`dayOrder`/`boardOrder` are **not** carried into archive — "same shape as tasks" is approximate, not literal.

### `tags` table

Stores user-defined custom tags and any color overrides for built-in tags. Built-in tags (`work`, `personal`, `school`) are hardcoded in `app.js` and only appear here if the user has manually reassigned their color.

**Create with:**
```sql
create table tags (
  user_id    uuid references auth.users not null,
  name       text not null,
  color_slot integer,
  created_at timestamptz default now(),
  primary key (user_id, name)
);
alter table tags enable row level security;
create policy "Users manage own tags" on tags
  for all using (auth.uid() = user_id);
```

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| name | name | tag string, e.g. `'exercise'` |
| colorSlot | color_slot | 0–4 index into the 5-color rotation; null = use rotation default |
| sortOrder | sort_order | integer, nullable — user-dragged column order on the Projects canvas (`_projSortedTagKeys`); null = not yet reordered, falls back to alphabetical. See [Projects canvas rule](./claude/rules/projects-canvas.md). |
| — | user_id | scopes rows to the authenticated user |

### `commitments` table

Lightweight non-task "busy" blocks the user drops onto days in the Week (Calendar) view as context to plan around — the app has no real-calendar sync, so these are manually entered. Scoped by `user_id`; RLS `auth.uid() = user_id`. Mapped in `data.js` (`_commitFromDb`/`_commitToDb`), CRUD via `Data.upsertCommitment` / `Data.deleteCommitment`. See [Week (Calendar) view rule](./claude/rules/calendar-week.md).

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| id | id | `'c' + Date.now()` format |
| title | title | e.g. "Work shift" |
| date | date | `YYYY-MM-DD` the block sits on |
| startTime | start_time | time or null |
| endTime | end_time | time or null |
| colorSlot | color_slot | reserved; currently always null |
| notes | notes | text or null |
| — | user_id | scopes rows to the authenticated user (composite PK `(user_id, id)`) |

---

## Rules & Conventions

### Architecture — hard rules
- `app.js` never calls Supabase directly. All persistence goes through `Data.*`.
- `data.js` never touches the DOM or references any HTML elements.
- `auth.js` is the sole owner of the Supabase client. It injects it into `data.js` via `Data.setClient()` before `App.init()` is called.
- `App.init()` is only ever called from `auth.js`. Never add a `DOMContentLoaded` listener in `app.js`.

### Editing discipline
- Never rewrite whole files. Make targeted, minimal edits to the relevant section only.
- Before any change that touches more than one module or the state flow between them, confirm the approach first.
- After any change that affects the data model, module interfaces, or feature completeness, update this file.

### Data mutations
- After modifying an item object, always persist it: `Data.upsertProject(item)` or `Data.upsertTask(item)`.
- Never mutate `_state` directly from `app.js`. Go through the `Data.*` mutation functions.
- `Data.save()` is a no-op. Do not call it in new code.

### DOM stability — do not rename these
Drag-and-drop and dynamic rendering depend on these selectors being stable:
- Column drop zones: `data-col="{colId}"` on `.col-body` elements (Tasks board only)
- Card identification: `data-id="{itemId}"` on `.card` (tasks) and `.proj-orb` (projects canvas)
- ~~Subtask list containers / row items~~ — **retired in phase 3.** Embedded subtasks no longer exist; a project's tasks are first-class `tasks` rows (`parentProject`). The project-space list uses `id="pspace-tasklist-{projId}"`.
- Modal container: `id="modal-root"` — cleared by setting `.innerHTML = ''`
- Doing zone drop target: `id="doing-cards-row"`
- Focus clock display: `id="focus-clock-time"`

### Styling
- All colors must use CSS custom properties from `style.css` (e.g., `var(--paper)`, `var(--ink)`, `var(--sage)`, `var(--amber)`). Never hardcode hex values.
- New components should inherit the paper/ink/steel/sage/amber palette. Consult `Design.md` for token values if adding new variables.

### ID generation
- Tasks: `'t' + Date.now()`
- Projects: `'p' + Date.now()`
- Subtasks: `'st' + Date.now()`

### localStorage — narrow, intentional use only
The main data store is Supabase. localStorage is only used for one item that does not need server persistence:
- `gf-completion-dates` — map of `taskId → YYYY-MM-DD` used by the midnight auto-archive to know which "done" tasks belong to a previous day

Do not add new localStorage keys without a strong reason. Tags and tag color overrides previously lived in `gf-tags` / `gf-tag-colors` — these are now in Supabase and a one-time migration in `data.js` will move them on first load.

### Sync-friendly development
This app is intended for use across multiple devices (desktop and eventually mobile). All user data — including preferences and configuration like tags — must live in Supabase, not localStorage. When adding any new feature that stores user state, default to a Supabase table or column. Only use localStorage for truly ephemeral, device-local concerns (e.g. the completion-dates map used for same-device midnight archiving).

---

## Feature Status

### Complete and working
- **Tasks Kanban board**: `this-week → next → done` (`backlog`/Inbox is no longer a board column — see Inbox Review). Drag-and-drop between columns, with reorder-within-column now persisted (`board_order` / `dayOrder` — see [tasks-board rule](./claude/rules/tasks-board.md)). `+ add` button per column (except Done). A persistent `.next-start-orb` at the bottom of Next is both a click and drag-swap target for starting the top-priority task into Focus. The `.columns` grid is sized to the rendered column count via `data-cols`.
- **Projects spatial canvas (redesign phase 3, legibility pass 2026-07-01)**: replaces the Projects Kanban with a **drifting-orb canvas** (`#board` → `_renderProjCanvas`/`_renderProjOrb`), grouped into **tag columns** the user can **drag to reorder** (persisted as `tags.sortOrder`). Each project is a soft tag-coloured orb, **sized by status** (Active largest → On Hold smallest/faded), deterministic hash scatter + gentle `proj-drift` (distinct from the Focus breathing orb); orbs of *different* statuses within a column now get a full separating gap (not just the tighter same-status overlap) so the status rows read as distinct. Tag column labels are bigger/higher-contrast and double as the drag handle. Click an orb → enlarged **project-space modal** (`.proj-space`, 1040px, bigger type throughout) showing the project's **first-class child tasks** grouped by status (Inbox/This Week/Next/Doing/Done) with an **inline quick-add** (Inbox default / "Start now" → This Week). **No progress bar** — projects accumulate tasks over time, so a completion ratio would be misleading; the orb instead shows a neutral "N open" count. Legend in the corner. Subtasks are no longer embedded — they are `tasks` rows linked by `parentProject`. Unified add: `openNewModal({parentProject,defaultStatus})` is shared by the board "+ New Task" and the project space. See [Projects canvas rule](./claude/rules/projects-canvas.md). The one-time **subtask→task migration ran 2026-06-16** (41 rows; `subtasks` column kept as backup).
- **Archive view**: Time-grouped layout (Today / This Week / Last Week / Earlier). Restore, delete, and Clear Archive actions.
- **Focus Mode orb (redesign phase 1)**: Starting a task (tap "start →" on a Next card, or drag-swap onto the orb) opens a **full-screen breathing-orb overlay** (`#focus-zone`), covering the board + topbar. Warm amber orb while working, cool blue on breaks, with a slow breathing + organic-morph animation; smooth 1.6s color crossfade between segments. Task title + large timer sit top-left (`#focus-meta`); the orb carries no text (`work`/`break` shown under the timer). Minimal bottom controls: Pause/Resume, Skip, Done, Return to Next. **Exit only via Done or Return to Next; Pause stays on the page.** Desktop only — hidden at ≤640px. See [focus-mode rule](./claude/rules/focus-mode.md). A **Float ↗** control pops the orb into an always-on-top **Document Picture-in-Picture** window that follows the user across apps (Chromium only; manual, gesture-triggered) — Dock orb / native close returns it; the boundary cue is a brief ring-pulse nudge that settles, not an alarm. See the PiP section of the focus-mode rule.
- **Focus timer**: Progressive sequence (5m work → 5m break → 10m → 5m → 25m → 5m → 50m → 5m → 50m). Wall-clock drift correction (immune to browser background tab throttling). Pause/resume, skip segment. Calm boundary state after work ends; pushy boundary state after break ends (both surfaced in the orb meta). Elapsed-minutes counter. Browser notification on segment completion. *(The old inline doing strip + linear segment track were replaced by the orb; `_renderTimerTrack()` is now a no-op stub.)*
- **Inbox Review (redesign phase 2, extended 2026-07-01)**: "Review Inbox" button (Tasks header) opens a **full-screen constellation** (`#inbox-review`, desktop only). Walks `backlog` items one at a time — order **by due date, then oldest** — as a connected tree of dots (color is now purely decorative, not outcome-coded); the centered task shows a triage callout with **This Week / Later / Never**, or — when it belongs to a project — a **project-group card** listing all of that project's pending inbox tasks together with per-task triage plus a bulk "defer whole project to Later". Acting rotates it up into faded **history** (scroll/click back to **Undo**); the next unprocessed task centers. "Later" increments a persistent `laterCount` ("bumped N×") and keeps the task in Inbox; **deletes are staged and applied on Close** (so undoable mid-pass). Closing the review now lands on the **Week view** so newly-This-Week tasks can be placed onto days right away. This Week cards also get a hover `← later` to demote back to Inbox. See [inbox-review rule](./claude/rules/inbox-review.md).
- **Task cards**: Color-coded tag pills, age counter (time in Inbox via `_ageLabel()` — e.g. "3d ago", "1w ago"; stale at 7d amber, old at 14d red), scheduled date/day display, blocked badge + reason inline, parent project reference.
- **Project cards**: Subtask list (inline add, checkbox toggle, drag reorder, progress bar + percentage). Promote subtask to task board as a `this-week` task. Recall a promoted subtask back to the project. Three-state blocking: Blocked (amber), Waiting (gold `#c49a2a`), or Clear — each with an optional reason line. Waiting auto-sets when a linked task card is blocked and auto-clears when all linked blocked tasks are resolved. Manual waiting is sticky (not auto-cleared). Tags. Collapsed/expanded toggle with animated collapse.
- **Detail modal**: Edit title, move status, toggle tags, scheduled date/time, due date, notes, blocked state + reason, subtask management (projects), delete with confirmation.
- **New item modal**: Task or project. Task type toggle (standalone vs. linked to project). Tag selection, status, dates, notes. Subtask pre-population for new projects before saving.
- **Filters**: By tag (multi-select OR logic) and by scheduled date. Filter count badge on button.
- **Midnight auto-archive**: Done tasks from previous days archived automatically on page load and at the next midnight without requiring a reload.
- **Export / Import**: JSON backup download and restore (with confirmation prompt).
- **Auth**: Email/password sign-in and sign-up. Session persistence across tabs. Cross-tab sign-out via `onAuthStateChange`.
- **localStorage migration**: One-time automatic migration of legacy data into Supabase on first login for existing users.
- **PWA**: Installable on desktop and mobile, theme color, app icons.
- **Capacities integration**: One-way bootstrap integration with Capacities.io. Project detail modal exposes a "Create Capacities page" button (fires an X-callback URL that opens the Capacities desktop app and pre-populates a new object with project title, notes, due date, and tags) and a paste field for the returned deep link. Once linked, a bookmark icon appears on the project card as a persistent shortcut to open the linked Capacities object. The linked state shows an "Open in Capacities" link and a "remove link" action. Stored as `capacitiesUrl` / `capacities_url` on the projects table.

- **Inbox relabel (phase 4)**: The desktop Tasks board "Backlog" column is labelled "Inbox" (hint: "move or leave"). The age counter on task cards and mobile inbox rows uses `_ageLabel()` for human-readable copy ("3d ago", "1w ago") instead of raw `Nd`. The subtask location badge shows "INBOX" instead of "BACKLOG". Internal status enum `backlog`, `data-col` attribute, `backlogEnteredAt` field, archive logic, and all status comparisons are **unchanged**.

- **Mobile capture/Inbox + triage (phases 1–3)**: At ≤640px, the focus/Doing zone and Projects board are hidden. A sticky capture bar (`#mobile-capture-bar`, `top: 50px`) creates `backlog` tasks instantly. Directly below it, a segmented toggle (`#mobile-seg-bar`, `top: 107px`, state in `mobileTab`) switches between two views rendered into `#mobile-inbox`:
  - **Inbox** — backlog tasks oldest-first; each row shows title, tag pills, age counter (stale/old styling). "Inbox" is a UI-only label; `backlog` status and `backlog_entered_at` are unchanged.
  - **Today** — tasks with `scheduledDate === today` across all non-`done` statuses, sorted by `scheduledTime`; shows time and status badge instead of age counter.
  Tapping either view's rows opens the Phase 2 bottom sheet (`_openInboxSheet` → `#modal-root`). Sheet actions work correctly from both views: Complete removes item from Today; rescheduling to a different date removes it from Today; moving out of backlog removes it from Inbox. Desktop layout fully unaffected.

- **Week / Calendar view (redesign phase 4)**: The final mode — a desktop **weekly-review** surface in the **Grind** visual language (graph-paper grid, flat vivid tag-coloured chips). New "Week" tab → `view==='calendar'` rendered into `#board` (`_renderWeekView`). 7 Monday-start day-columns with prev/next/Today nav (`_weekOffset`). Three week states: **past** = accomplishment look-back (done + archived items via `_doneOnDate`, no rail); **current** = active placement + a "This Week · unplaced" rail (this-week tasks without a day); **future** = tentative planning (placing onto a future-week day keeps `this-week` status but `_isFutureWeek` removes it from the live This Week board column until its week arrives). Drag a rail/day chip → sets `scheduledDate` + within-day `dayOrder` (priority stack, top = first); drop back on the rail unschedules; rail chips have a `→ Later` (reuses `_sendToLater`). Today's column emphasised; the `doing` task shows a coral "now" marker (drag never starts Focus). **Commitment blocks** ("＋ busy") add lightweight non-task busy context per day (`commitments` table) as four fixed **shift types** (Day/Night/Morning/Evening — no time picker) that shade the full or half day-cell, Night crossing midnight onto the following day (session 2026-07-01; see [Week (Calendar) view rule](./claude/rules/calendar-week.md) for the shading-layer restructure). **Focus-time capture**: actual work-segment minutes accrue to `time_spent` on Done/Return (shown as `Σ Nm` on chips + a "Focus time logged" line in the detail modal) — a foundation for future duration prediction. See [Week (Calendar) view rule](./claude/rules/calendar-week.md).

- **Recurring tasks (2026-07-01, reworked same day)**: A task can recur `rolling` (a fixed interval from its completion date — days/weeks/months) or `anchored` (a real due date, optionally with a default weekday/day-of-month rule; daily recurrence is out of scope — that's "habits"). Recurring tasks live permanently in a dedicated **Recurring** board column (leftmost) and are created/edited exclusively through a dedicated modal (`openRecurringModal`) — not the New Item or Detail modals. Completion is a direct checkmark on the card (or the top-of-board due banner) — never a trip through Focus mode. On completion, rolling occurrences spawn silently; anchored occurrences pop a small confirm prompt for the next due date + lead time (dismissing it accepts the pre-filled suggestion — a series is never silently dropped). Completions can be backdated (for logging a forgotten chore after the fact). A slim banner surfaces due-soon/overdue recurring tasks across the top of the Tasks board. Every completed occurrence archives as its own permanent row; the Recurring modal shows a "Past occurrences" history for the series. See [recurring-tasks rule](./claude/rules/recurring-tasks.md).

### Not yet built / known gaps
- **Tasks board redesign (phase 3.5)** — designed in `REDESIGN-BRIEF.md`, not started. (Calendar week view, phase 4, is now **shipped** — see above.)
- **Calendar follow-ups**: duration **prediction** from the new `time_spent` data, mid-stack within-day drop insertion (currently appends), and a **mobile** week view are all deferred.
- **PWA update strategy**: `sw.js` is now **network-first** for same-origin assets (cache `gf-shell-v3`) so deploys appear on the next online refresh; cache is the offline fallback. (Was cache-first, which served stale assets until `sw.js` itself changed.)
- **Search**: The `searchQuery` state variable and filter logic exist in `app.js`, but there is no search input in `index.html`. The feature is partially scaffolded but not exposed in the UI.
