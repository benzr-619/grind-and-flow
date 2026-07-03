# Grind & Flow — Refinement Brief (2026-07-01)

Decisions below came out of a planning conversation, not implementation. Paste each "Prompt for Claude Code" block into a Claude Code session on this repo — one area at a time, in the suggested order, since a couple of areas (nav, drag-reorder) touch shared code that later prompts depend on. Claude Code should read `CLAUDE.md` and the relevant `.claude/rules/*.md` file before starting each one, per the project's standing rules, and update those docs after.

Suggested order: **1 → 7 → 2 → 3 → 4 → 5 → 6** (nav first since it's low-risk and touched everywhere; drag-reorder bug next since Tasks and Week both depend on the fix; recurring tasks is the biggest new feature so give it its own session).

---

## 1. Navigation restructure

**Decision:** Tasks and Projects become large primary tabs. Archive, Review Inbox, and Week collapse into a compact, label-less icon row, grouped separately from the primary tabs so they're still one click away but visually secondary.

**Prompt for Claude Code:**
> Read CLAUDE.md and the Navigation redesign section of `.claude/rules/calendar-week.md`. Restructure the topbar: make Tasks and Projects visually primary (larger tab styling, more prominent than today's `.tab-group`). Move Archive, Review Inbox (`#act-review`), and Week (`#act-week`) into a compact icon-only row, visually grouped apart from the primary tabs, de-emphasized relative to them (smaller, muted until hovered/active). Keep all existing ids and click handlers (`switchView`, `openInboxReview`, `toggleArchive`) — this is a visual/layout change, not a behavior change. Update `.claude/rules/calendar-week.md`'s Navigation section and CLAUDE.md if the nav structure description changes.

---

## 2. Tasks page — legibility, start flow, live refresh

**Decisions:**
- Increase font sizes across the Tasks page (cards, column headers, meta text) — current sizing reads as too small.
- Replace whatever currently overlaps as the "start focus" target with a small persistent orb anchored at the bottom of the Next column, acting as both the drag-drop target and click target to start a task into Focus Mode.
- The app should self-refresh once a day even if left open in a tab: clear/archive the Done column and re-run the scheduled-date rollover (currently `_dailyRollover` only runs from `init()` on page load, not on a live timer). Match the pattern already used for midnight auto-archive, which does trigger live without a reload.

**Prompt for Claude Code:**
> Read CLAUDE.md, `.claude/rules/focus-mode.md`, and `.claude/rules/calendar-week.md` (`_dailyRollover` section). Three changes to the Tasks page:
> 1. Increase font sizes across Tasks board cards, column headers, and meta text (tags, age counters, dates) in `style.css` — audit current sizes and scale them up meaningfully, keeping the existing type tokens/hierarchy.
> 2. Replace the current "start focus" drop target with a small persistent orb anchored at the bottom of the Next column. It should accept the same drag-swap interaction that currently starts a task into Focus Mode, plus be clickable directly, and should not visually overlap other column content. Preserve the existing `_onDoingDrop` / start-into-focus logic — this is about relocating and restyling the target, not changing the underlying start mechanism.
> 3. Investigate how the midnight auto-archive currently re-triggers live (without reload) and extend the same mechanism so `_dailyRollover()` also re-runs live at midnight, not just on `init()`. Confirm both the Done-column archive and the overdue-task/day rollover fire correctly if the tab is left open across midnight.
> Update the relevant `.claude/rules/*.md` file(s) and CLAUDE.md after.

---

## 3. Recurring tasks (new feature)

**Decisions:**
- Scope: fixed weekly schedule (specific day(s) of week), fixed monthly date, and rolling interval from completion (e.g. "3 months after I last did it"). No daily recurrence — daily items are habits, explicitly out of scope for this feature.
- Each occurrence, once completed, should leave a permanent record — archived like a normal task (its own completed date, notes, time spent) — so the user can scroll back and see the history of when each occurrence actually happened. Recurring tasks should not be invisible/traceless once done.
- Everything else (schema shape, whether the "next occurrence" is generated on completion vs. on rollover, how it's exposed in the New Item / Detail modals) is open for Claude Code to propose, following existing module boundaries and naming conventions.

**Prompt for Claude Code:**
> Read CLAUDE.md fully, especially the Data Model and Module Map sections. Design and implement recurring tasks with this scope: a task can recur (a) weekly on specific day(s) of the week, (b) monthly on a fixed date, or (c) on a rolling interval measured from the date it was last completed. Daily recurrence is out of scope (handled elsewhere as "habits," a different feature). When a recurring occurrence is completed, it must archive as its own permanent row (own completed date, notes, time spent) exactly like a normal task does today — the user needs to be able to look back and see the history of each occurrence, not just the current pending one. Propose the schema addition (new columns on `tasks` vs. a separate recurrence-rule table — your call, but follow the existing `camelCase`/`snake_case` mapping convention in `data.js` and the id-generation convention in CLAUDE.md), the UI for setting/editing recurrence (New Item modal + Detail modal), and how the "next occurrence" gets created (on completion, or picked up by the existing daily rollover). Confirm the approach with me before writing the migration if it's not obvious from CLAUDE.md's conventions. Update CLAUDE.md's Data Model and Feature Status after.

---

## 4. Inbox Review — project grouping, colors, exit flow

**Decisions:**
- Add a new review card type, distinct from the current single-task card, for when the active item is a project cluster: it shows all of that project's inbox tasks at once, and lets the user either decide on individual tasks within it or dismiss the whole project to Later in one action.
- The constellation tree itself keeps one dot per task regardless of grouping — the tree is purely decorative/visual, not the thing driving the grouping logic.
- Drop outcome-meaning from dot colors entirely. All dots (decided or not, active or ghost) get colors from a fun, rotating/random palette — purely for visual variety, no need to preserve a "read the color to know what I decided" affordance.
- When the user closes/leaves Inbox Review, navigate them to the Week view afterward, so they can immediately place the tasks that went to "This Week" across specific days.

**Prompt for Claude Code:**
> Read `.claude/rules/inbox-review.md` fully. Three changes:
> 1. Add a project-group review card: when the active/centered item in review is a project cluster (group `backlog` tasks by `parentProject`), render a distinct card type listing all of that project's inbox tasks together, with per-task This Week / Later / Never actions plus one "defer whole project to Later" bulk action. Non-project (standalone) tasks keep today's single-task card. The constellation tree still renders one dot per individual task regardless — grouping is a review-card-level concept only, not a tree-rendering concept.
> 2. Replace the outcome-based dot coloring (`_outcomeColor`) with a fun, rotating or randomized color palette applied to all dots — decided, active, and ghost/upcoming alike. Color should no longer encode This Week vs. Later vs. Never.
> 3. When the user closes Inbox Review (`closeInboxReview()`), after staged deletes are applied, navigate to the Week (`calendar`) view so newly-this-week tasks can be placed onto specific days right away.
> Update `.claude/rules/inbox-review.md` after, including the retired outcome-color scheme and the new project-group card.

---

## 5. Week view — shift-based busy blocks

**Decision:** Fully replace the current time-picker/work-exercise-type commitment editor with four fixed shift types that shade half or all of a day cell:
- **Day** shift → shades the full day.
- **Night** shift → shades the bottom half of the day it starts, and the top half of the following day (cross-midnight).
- **Morning** shift → shades the top half of the day.
- **Evening** shift → shades the bottom half of the day.

No start/end time picker — just a shift-type selector per commitment.

**Prompt for Claude Code:**
> Read `.claude/rules/calendar-week.md`, especially the Commitments section. Replace the current commitment editor (`_openCommitEditor`, type segmented toggle Busy/Work/Exercise, start/end time fields) with four fixed shift types: Day, Night, Morning, Evening. No time picker — the editor should just be a shift-type selector plus the existing end-date/notes/delete affordances. Rendering: Day shades the full day cell; Night shades the bottom half of its start date's cell and the top half of the following day's cell (reuse the existing `end_date` cross-midnight rendering path); Morning shades the top half of the day; Evening shades the bottom half. Decide new CSS classes for these four shading states (replacing `.cb-type-work`/`.cb-type-exercise`) and pick colors that fit the existing token palette (consult `DESIGN.md`). Migrate/backfill existing commitment rows if needed, or confirm with me first if that's ambiguous. Update `.claude/rules/calendar-week.md`'s Commitments section and CLAUDE.md after.

---

## 6. Projects canvas — legibility pass

**Decisions:**
- No new information needs to be shown at a glance — the problem is purely that overlap and visual haze make it hard to scan what projects exist.
- Make column (tag) titles more visible/prominent.
- Make columns (tag groups) re-orderable by the user.
- Within each column, add clearer vertical separation between the status "rows" (active/up-next/someday/on-hold) — keep the overlap within a status row, but separate rows from each other so scanning top-to-bottom is easier.
- Enlarge the project-space modal and its fonts.

**Prompt for Claude Code:**
> Read `.claude/rules/projects-canvas.md` fully. Four changes, all layout/legibility — no new data or badges on the orbs themselves:
> 1. Make `.proj-group-label` (column/tag titles) more visually prominent — bigger, higher-contrast against the canvas.
> 2. Make tag columns user-reorderable (drag to reorder columns; persist the order — decide where: a new per-user preference, or inferred from a stored column-order array; confirm with me if the persistence approach isn't obvious).
> 3. Within a column, add clearer vertical separation between the status groups (active/up-next/someday/on-hold) — e.g. a visible gap or subtle divider between each status "row" — while preserving the existing overlap/stacking *within* each status row (`stepFactor` behavior stays for orbs of the same status).
> 4. Enlarge `.proj-space` (project-space modal) and increase its font sizes throughout.
> Watch for the two documented gotchas (`z-index` on hover, `clip-path`/`drop-shadow` interaction) when touching orb CSS. Update `.claude/rules/projects-canvas.md` after.

---

## 7. Known bug — drag-to-reorder not persisting

**Decision:** Card stacks within a column are supposed to be reorderable (the UI affordance suggests it — drag handles/cursor), but the reorder doesn't actually take effect. This affects both the Tasks board columns and possibly the Week view day-columns (the user reported it in both places). Needs investigation before a fix — it's not clear yet whether the persistence field exists for the Tasks board case.

**Prompt for Claude Code:**
> Read CLAUDE.md and `.claude/rules/calendar-week.md` (the `dayOrder` / `_weekDaySort` / `_dragAfterElH` sections). Investigate two things:
> 1. On the Tasks board (This Week / Next / Done columns), dragging to reorder cards within a column visually looks supported but doesn't persist a new order. Check whether these columns have any per-column ordering field at all today, or whether the drag affordance exists without a backing sort key. Report back what you find before implementing — if there's no ordering field, we need one (naming/placement should follow the `dayOrder` precedent used in the Week view).
> 2. In the Week view, confirm whether the existing `dayOrder` fractional-insertion drag-and-drop (`_dragAfterElH`, `_onWeekDrop`) is actually working today — the user reports it's also not taking effect there. If it's broken, find the regression; if it was never fully wired up, fix it.
> Fix both, then update the relevant rule file(s) with what was found and changed.
