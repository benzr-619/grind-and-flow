# Grind & Flow — One List Brief (2026-11-25)

Decisions came out of a design interview, not implementation. This replaces the four-mode redesign
(Planning · Focus · Projects · Calendar) with **one list**: a numbered Today, a ranked Offered column,
a zoom-out Everything view, Focus, a simple Log, and a bare phone stopgap.

- **Design plan (source of truth for behavior):** https://claude.ai/artifact/2jnJ388TkAdxUL3giRB96H
- **Mockups — use the "v2 — minimal" page, ignore v1:** https://claude.ai/artifact/KDSaMbWsxxmp1xfWoPJumr
  (Today and Everything artboards are interactive prototypes: their logic is a working reference.)

Run the prompts **in order, one Claude Code session each**. Each session: read `CLAUDE.md` and the relevant
`.claude/rules/*.md` first, confirm the approach before multi-module changes, and update docs at the end.
Desktop-first; only Prompt 8 touches mobile.

## Locked decisions

- **Why:** the app went unused because it needed upkeep. Principles: one list always visible, no upkeep,
  nothing disappears on its own, Today is a fresh page each day, capture is one line, simple first.
- **Start fresh.** Every open and recurring task is deleted, no backup (the old list is saved in
  `Grind-and-Flow-snapshot-2026-11-25.docx`); Ben re-enters what still matters, recurring included, as a way
  to learn the new entry flow. Projects become unused. The `archive` table (past completions + focus minutes)
  is kept as-is — it is the Log's history.
- **Keep:** Focus orb + timer (visual language unchanged), Recurring tasks (data + due/spawn logic),
  Supabase/auth/module boundaries.
- **Cut:** Inbox Review, Week view + commitments UI, Projects canvas + project-space modal, This Week/Next/Done
  columns, `_dailyRollover`, Inbox age counters, tags (work/personal/school), Archive view (→ Log).
- **Areas:** exactly four — Research, AMD, EDBA, Home. One optional area per task.
- **Aesthetic:** minimal. Off-white ground, near-black ink, one sans (Inter), lots of white space, almost no
  chrome. The old paper/serif/mono planner look is retired everywhere except the Focus orb overlay.
- **Today:** numbered 1…n in priority order, drag to reorder, hover → "not today →" and a done circle,
  item 1 has "start" (opens Focus). A quiet divider after item 10, nothing more.
- **Offered:** a separate right column, ranked; "I'm set ✓" collapses it, "+ show offered (n)" restores it.
- **Ranking (no ML):** due/overdue recurring pinned on top; then points — ASAP +50; by-date overdue +60 /
  ≤2d +40 / ≤7d +25 / later +10; on Today in last 3 days & not done +30; added in last 3 days +15;
  age +1/week (max +10); no rush −40. Show ~12; each row shows area + its single strongest reason.
  Weights live in one constant. ("Skipped" was considered and dropped — passive.)
- **Entry (inline, no card):** type title → Tab → priority/date (`asap`, `no rush`, `a`/`n`, or a date like
  `fri`, `dec 4`) → Tab → area (one letter). Enter saves at any step → Offered/Everything. Shift+Enter →
  straight onto Today. Backspace on empty field steps back; Esc clears. `idea:` prefix → Ideas.
  Inline shortcuts (`#amd asap`) also parsed in the title step.
  **Recurring is created here too:** in the priority/date step, `every 5d` / `every 2w` / `every month` →
  rolling; `every mon` / `every 15th` → anchored (default rule). No separate recurring screen.
  Show a "already have: …" hint on a close
  title match. Same bar appears on Everything.
- **Everything:** reached by "zoom out" with a zoom-out animation. All open tasks + ideas float gently in
  labeled clusters; regroup by area / urgency (same ranking buckets) / date entered, items glide between
  clusters. Solid ink dot = on Today; hollow = idea. No legend.
- **Log:** simple — week total, totals by area, then days → tasks → minutes. Expect a later redesign.
- **Phone (stopgap only):** numbered Today (check off), due recurring, one-line capture with tap chips
  (priority/date, area) above the keyboard. Full phone design comes later.

---

## Prompt 1 — Schema migration + fresh start

> Read CLAUDE.md, `.claude/rules/supabase-mcp.md`, and ONE-LIST-BRIEF.md (Locked decisions). We are moving
> the app to a "one list" model and **starting fresh** — no task migration, no backup tables, no confirmation
> step (a snapshot of the old list is already saved in the repo). This session is data only — no UI changes.
> 1. Migration `one_list_model` (additive) on `tasks`: `today_date date`, `today_order numeric`, `area text`
>    (check in Research/AMD/EDBA/Home or null), `urgency text` (`asap`|`norush`|null), `purpose text`,
>    `effort text` (S/M/L), `source text` (app/phone/claude), `meta jsonb`. Reuse `due_date` as the soft due
>    date. Add `area` to `archive`.
> 2. New table `task_events` (id, user_id, task_id, event text — added/offered/pulled/sent_back/started/done,
>    at timestamptz default now(), minutes int null), RLS `auth.uid() = user_id`, index on (user_id, at).
> 3. **Keep history for the Log:** move any `tasks` rows with `status='done'` into `archive` first (same path
>    the midnight auto-archive uses, preserving `time_spent` and completion date). Leave `archive` untouched
>    otherwise — it is the Log's history.
> 4. Then delete every row in `tasks` (open and recurring). Statuses going forward: `open` / `done` /
>    `recurring` / `idea`. Leave `projects`, `tags`, `commitments` tables in place, unused.
> 5. Report counts. Update CLAUDE.md's Data Model and supabase-mcp.md.

## Prompt 2 — Data layer

> Read CLAUDE.md and ONE-LIST-BRIEF.md. Update `data.js` only (module boundaries per CLAUDE.md):
> - Mappers for the new task columns and for `task_events`.
> - Mutations: `addTask({title, urgency, dueDate, area, toToday, isIdea, source})`, `pullToToday(id)`,
>   `sendBack(id)`, `reorderToday(ids)`, `completeTask(id)` (existing archive path), `logEvent(taskId, event, minutes?)`.
>   All optimistic, same pattern as today. `addTask`/`pullToToday`/`sendBack`/`complete` log their event.
> - Selectors: `todayList()` = `today_date == today` and not done, sorted by `today_order`;
>   `openTasks()`, `ideas()`. No rollover job — yesterday's items simply stop matching.
> Keep the recurring-task logic (spawn, due state, completion) working — the table just starts empty. Don't touch UI yet beyond what's needed to not crash.

## Prompt 3 — New design tokens + Today screen

> Read CLAUDE.md, Design.md, ONE-LIST-BRIEF.md, and the "Today" artboard on the v2 page of the mockups
> (its logic is a working reference). Two parts:
> 1. **Tokens:** add a new minimal token set to `style.css :root` (off-white ground, near-black ink, 2–3 greys,
>    one warm accent, Inter). Keep the `--focus-*` tokens. Rewrite Design.md §0 North Star to describe the
>    One List aesthetic; mark the old planner palette as Focus-only/legacy.
> 2. **Today** becomes the default (and only) home view, replacing the Tasks board: inline entry bar with
>    the Tab flow, numbered drag-reorderable list, hover "not today →" + done circle, "start" on item 1,
>    divider after 10, Offered column with the ranking rule (weights in one constant), "I'm set ✓" collapse.
> >    Header: date left; "zoom out" and "log" right. Recurring tasks are created from the entry bar (`every …`
>    in the priority/date step — see Locked decisions) and edited from Everything (Prompt 5). Due recurring
>    tasks appear pinned at the top of Offered and can be checked off there (existing `completeRecurringToday`),
>    or pulled onto Today like any task. Keep `_maybeSpawnRecurrence` and the anchored confirm prompt.
>    Remove the old topbar tabs and board render paths from the nav (code deletion happens in Prompt 9).
>    Update CLAUDE.md feature status.

## Prompt 4 — Focus hookup

> Read CLAUDE.md, `.claude/rules/focus-mode.md`, ONE-LIST-BRIEF.md. Wire Focus to the new model: "start" on
> Today item 1 opens the existing orb overlay unchanged. Log `started` and `done` events with work minutes
> (keep accruing `time_spent` too). On Done, show a small "up next on Today" card with the next item and a
> one-tap start; "back to Today" exits. Remove dependencies on the old `doing` status / Next column.

## Prompt 5 — Everything (zoom out)

> Read CLAUDE.md, ONE-LIST-BRIEF.md, and the "Everything" v2 artboard (interactive reference: cluster
> layout, glide transitions, drift animation, entry bar). Build it as a view reached from "zoom out":
> zoom-out transition from Today; clusters by area / urgency / date entered with glide between groupings;
> solid dot = on Today, hollow = idea; same entry bar; click a task → small inline detail (title, urgency,
> due, area, notes, "add to Today", delete; ideas get "make a task"; recurring tasks show ↻ + cadence and
> open the existing `openRecurringModal` for editing). Unassigned tasks get their own
> "No area" cluster. Respect prefers-reduced-motion. Must stay legible at ~60 items — scale cluster
> spacing/text, and propose an approach if it doesn't.

## Prompt 6 — Log

> Read CLAUDE.md, ONE-LIST-BRIEF.md, the "Log" v2 artboard. Replace the Archive view with a simple Log:
> week picker, week total, totals by area, then each day → finished tasks with focus minutes (from
> `task_events`, falling back to `time_spent`). Keep restore/delete for archived items accessible but quiet.
> Keep it simple — this will be redesigned later.

## Prompt 7 — Capture polish

> Read ONE-LIST-BRIEF.md (Entry). Add: duplicate hint ("already have: …", keep both / open existing) on a
> close title match; inline shortcut parsing in the title step (`asap`, `norush`, `#area`, simple dates);
> `idea:` prefix; the `every …` recurrence syntax (rolling vs anchored, as in Locked decisions). Unit-test the parser with a small set of examples in a plain JS test file.

## Prompt 8 — Phone stopgap

> Read CLAUDE.md, `.claude/rules/mobile.md`, ONE-LIST-BRIEF.md, the "Phone" v2 artboard. The current mobile
> companion depends on the retired statuses. Replace it with a deliberately bare ≤640px surface: numbered
> Today (tap circle or swipe to complete), due recurring tasks, one-line capture pinned at the bottom with
> tap chips (asap / date… / no rush | areas) and Save. No Everything, Log or Focus on mobile yet. Rewrite
> `.claude/rules/mobile.md` to match and note the fuller phone design is future work.

## Prompt 9 — Cleanup

> Read CLAUDE.md and all `.claude/rules/*.md`. Delete dead code and CSS for: Inbox Review, Week view +
> commitments UI, Projects canvas + project space, the Tasks board columns, `_dailyRollover`, tag UI,
> Archive view, the old mobile companion. Keep the data tables. Rewrite CLAUDE.md (overview, module map,
> data model, feature status) for the One List app; archive the obsolete rules files under
> `.claude/rules/_retired/` with a one-line note each. Run the app and click through every remaining view.

## Phase 2 (after ~2 weeks of real use — not now)

A Claude skill ("add to Grind") using the Supabase connector: parse free text into title/area/urgency/
due/purpose and insert via one fixed, tested template (never freeform SQL — the connector bypasses RLS);
answer "what's open for EDBA?" / "what did I spend time on?". Later: tune ranking weights from
`task_events`. Decide whether `gf-coach_ARCHITECTURE.md` is absorbed into this. Keep patient details out.

## Later: native rebuild (decided 2026-11-25, not now)

Ship One List on the web (GitHub Pages + Supabase) first. Once the habit sticks, rebuild as a native
SwiftUI multiplatform app (iPhone + Mac — admin days are on Ben's own Mac) in Xcode, reading the same
Supabase data. Native wins worth it then: home/lock-screen capture widget, share sheet, notifications for
due recurring tasks. The v2 mockups carry over; the fuller phone flow (Today without the Offered column,
Everything, Log) gets designed at that point.
