# CLAUDE.md — Grind & Flow

> This file is the persistent context document for this codebase. Read it at the start of every session. Update it after any change that affects the data model, module interfaces, or feature status.

---

## App Overview

Grind & Flow is a single-user personal productivity web app for managing projects, tasks, and focus sessions. It targets people who want the intentionality of an analog planner with the convenience of a digital tool. Users manage dual Kanban boards (Projects and Tasks), drag tasks into a Doing zone with an integrated focus timer, and review completed work in a time-grouped Archive. The app is installable as a PWA on desktop and mobile.

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
Static DOM structure only: auth overlay, topbar, focus zone (doing section + timer track), board section, modal root. No logic. Inline event handlers call into `App.*` and `Auth.*` by name.

### `style.css` — Styling
All CSS custom properties (variables) that map to design tokens from `Design.md`. Use these variables everywhere — never hardcode hex values in new rules.

### `Design.md` — Design system spec
Source of truth for color hex values, font stacks, spacing scales, and the "analog planner" aesthetic. Read this before adding any new styled elements or components.

### `manifest.json` — PWA manifest
App name, icons, theme color (`#ece2cd`), display mode. No logic.

---

## Data Model

Three Supabase tables, all scoped by `user_id` (uuid from Supabase Auth).

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
| tags | tags | jsonb array of strings |
| subtasks | subtasks | jsonb array of subtask objects |
| capacitiesUrl | capacities_url | text or null — deep link to the linked Capacities object |
| — | user_id | injected by `_projToDb()` |

Subtask object shape: `{ id, title, done, promoted, loc, promotedTaskId? }`

### `tasks` table

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| id | id | `'t' + Date.now()` format |
| type | type | `standalone` or `task` (linked to project) |
| title | title | |
| status | status | `backlog`, `this-week`, `next`, `doing`, `done` |
| parentProject | parent_project | project id or null |
| dueDate | due_date | |
| scheduledDate | scheduled_date | |
| scheduledTime | scheduled_time | |
| notes | notes | |
| dateAdded | date_added | |
| blocked | blocked | boolean |
| blockedReason | blocked_reason | |
| tags | tags | jsonb array |
| backlogEnteredAt | backlog_entered_at | set when item enters backlog; drives age counter |
| — | user_id | injected by `_taskToDb()` |

### `archive` table

Same shape as `tasks`, plus two additional fields:

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| archivedAt | archived_at | date stamped at archive time |
| originalStatus | original_status | status before archiving |

Archived projects also carry a `subtasks` jsonb array (same as the projects table).

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
- Column drop zones: `data-col="{colId}"` on `.col-body` elements
- Card identification: `data-id="{itemId}"` on `.card` and `.proj-card`
- Subtask list containers: `id="stlist-{projId}"`
- Subtask row items: `.subtask-row-item` and `.subtask-item`
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
The main data store is Supabase. localStorage is only used for two lightweight items that do not need server persistence:
- `gf-tags` — the user's custom tag list (default: `['work','personal','school']`)
- `gf-completion-dates` — map of `taskId → YYYY-MM-DD` used by the midnight auto-archive to know which "done" tasks belong to a previous day

Do not add new localStorage keys without a strong reason.

---

## Feature Status

### Complete and working
- **Dual Kanban boards**: Tasks (`backlog → this-week → next → done`) and Projects (`active → up-next → on-hold → someday`). Drag-and-drop between columns. `+ add` button per column (except Done).
- **Archive view**: Time-grouped layout (Today / This Week / Last Week / Earlier). Restore, delete, and Clear Archive actions.
- **Doing zone**: Drag any task from the board into the focus strip. Left flank sends it back to Next; right flank marks it Done. Only one task in Doing at a time — dropping a new one bumps the existing one back to Next.
- **Focus timer**: Progressive sequence (5m work → 5m break → 10m → 5m → 25m → 5m → 50m → 5m → 50m). Wall-clock drift correction (immune to browser background tab throttling). Pause/resume, segment jump by clicking track. "Calm" boundary state after work ends; "Pushy" boundary state after break ends. Elapsed-minutes counter. Browser notification on segment completion.
- **Task cards**: Color-coded tag pills, age counter (days in backlog; stale at 7d, old at 14d), scheduled date/day display, blocked badge + reason inline, parent project reference.
- **Project cards**: Subtask list (inline add, checkbox toggle, drag reorder, progress bar + percentage). Promote subtask to task board as a `this-week` task. Recall a promoted subtask back to the project. Blocked badge + reason. Tags. Collapsed/expanded toggle with animated collapse.
- **Detail modal**: Edit title, move status, toggle tags, scheduled date/time, due date, notes, blocked state + reason, subtask management (projects), delete with confirmation.
- **New item modal**: Task or project. Task type toggle (standalone vs. linked to project). Tag selection, status, dates, notes. Subtask pre-population for new projects before saving.
- **Filters**: By tag (multi-select OR logic) and by scheduled date. Filter count badge on button.
- **Midnight auto-archive**: Done tasks from previous days archived automatically on page load and at the next midnight without requiring a reload.
- **Export / Import**: JSON backup download and restore (with confirmation prompt).
- **Auth**: Email/password sign-in and sign-up. Session persistence across tabs. Cross-tab sign-out via `onAuthStateChange`.
- **localStorage migration**: One-time automatic migration of legacy data into Supabase on first login for existing users.
- **PWA**: Installable on desktop and mobile, theme color, app icons.
- **Capacities integration**: One-way bootstrap integration with Capacities.io. Project detail modal exposes a "Create Capacities page" button (fires an X-callback URL that opens the Capacities desktop app and pre-populates a new object with project title, notes, due date, and tags) and a paste field for the returned deep link. Once linked, a bookmark icon appears on the project card as a persistent shortcut to open the linked Capacities object. The linked state shows an "Open in Capacities" link and a "remove link" action. Stored as `capacitiesUrl` / `capacities_url` on the projects table.

### Not yet built / known gaps
- **Timer loop button**: The loop icon is rendered in the timer track but is not wired up — clicking it does nothing.
- **Search**: The `searchQuery` state variable and filter logic exist in `app.js`, but there is no search input in `index.html`. The feature is partially scaffolded but not exposed in the UI.
