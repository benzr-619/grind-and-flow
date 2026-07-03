# Week (Calendar) view — redesign phase 4

Session 2026-06-19. The final of the four redesign modes (Planning · Focus · Projects · **Calendar**). A desktop-first weekly-review surface in the **Grind** visual language (graph-paper ground, flat vivid tag-coloured chips — cousin of the Inbox Review constellation; **no** Focus-orb soft/blur). Top-level `view`, rendered into `#board` like Projects — **not** a z-200 overlay.

## Entry point
- Nav tab `#tab-calendar` ("Week") → `App.switchView('calendar')`. `renderBoard()` branch: `else if (view === 'calendar') board.innerHTML = _renderWeekView();`. Title → "Week"; Filters button hidden on calendar. `data-view="calendar"` stamped for the mobile hide rule.
- Module state `let _weekOffset = 0` (weeks from the current Mon-start week). `weekPrev/weekNext/weekToday` adjust it + `renderBoard()`.

## Week math (Monday-start)
- `_wkMonday(offset)` → Date of that week's Monday. `_weekDays(offset)` → 7 `YYYY-MM-DD`.
- `_weekOffsetOf(ds)` compares the **Monday of `ds`'s week** to the current Monday (do NOT round the raw day-diff — a mid-week date would misreport as next week). `_isFutureWeek(ds)` = offset > 0.
- `_ymd(d)` builds a local `YYYY-MM-DD` (avoids `toISOString` UTC shifts).
- **Name collision:** there is a *separate* archive-view `_weekStart(date)` (takes a Date, returns Monday) — keep the calendar helper named `_wkMonday`, never `_weekStart`.

## Three week states (by `_weekOffset`)
- **Past (`<0`)** — accomplishment look-back. Days show done items via `_doneOnDate(date)` = done `tasks` + non-project `archive` rows, matched by `scheduledDate` else completion date (`_loadCompletionDates()`) / `archivedAt`. Rendered as `.past-chip` (✓, struck-soft), not draggable, no rail. Per-day "N done" tally.
- **Current (`0`)** — active placement: `tasks` where `scheduledDate === date && status !== 'done'`, sorted by `_weekDaySort`. Rail shown. Today's column emphasised (`.today`, ink inset). The `doing` task gets a coral `now` marker (drag never starts Focus).
- **Future (`>0`)** — tentative planning: same placement, rail still shown to pull tasks forward.

## Drag & drop (`_weekDragId`)
- Chips: `_onWeekChipDragStart/End` (toggles `.dragging` on the `.week-task`/`.rail-chip`). Day drop: `_onWeekDrop(e,date)` sets `scheduledDate`, computes fractional `dayOrder` via the shared **vertical** `_dragAfterEl(container, clientY)` for **mid-stack insertion** (not append-only), and promotes `backlog → this-week` **only when not a future week**. Future placement keeps `this-week` status — see filter below.
- Visual drop placeholder: `_onWeekDragOver` inserts a `.week-drop-line` div at the insertion point (also via `_dragAfterEl`); removed on `_onWeekDragLeave`/`_onWeekDrop`.
- Rail drop (`_onWeekRailDrop`) clears `scheduledDate`+`dayOrder` (stays `this-week`).
- `→ Later` on rail chips reuses existing `_sendToLater(id)` (→ backlog, `laterCount++`).
- `_weekDaySort`: `dayOrder` asc (nulls last) → `scheduledTime` → `dateAdded`.

### Bug fix (session 2026-07-01) — day-column reorder wasn't taking effect
`_dragAfterEl` (shared with the Tasks board) only matched `.card`/`.proj-card` elements — day columns render `.week-task` chips, so the reduce always found zero candidates and `afterEl` was always `null`. Net effect: the drop-line placeholder always rendered at the end of the day's stack and `_onWeekDrop`'s fractional `dayOrder` math always computed "insert after the last item," regardless of where the user actually dropped — a within-day reorder always silently pushed the task to the bottom. **Fixed** by adding `.week-task:not(.dragging)` to `_dragAfterEl`'s selector. `_dragAfterElH` (horizontal cursor-position variant) is defined near `_nextDayOrder` but has no call sites — it was never wired to the rail or anywhere else; left in place as unused/reserved rather than removed, since the vertical `_dragAfterEl` is the correct one for the vertically-stacked day columns.

## Future-week filter (touches the Planning board)
In `renderBoard()` the **This Week column** excludes `this-week` tasks where `_isFutureWeek(scheduledDate)` — so placing onto a future week moves them out of the live column (and the rail, which only lists `!scheduledDate`). They reappear when their week becomes current. Status is unchanged → fully reversible.

## Commitments (lightweight non-task busy context)
- `commitments` Supabase table (`id,user_id,title,date,start_time,end_time,end_date,type,shift,color_slot,notes`), RLS `auth.uid()=user_id`. data.js: `_commitFromDb/_commitToDb`, loaded into `_state.commitments`, `Data.upsertCommitment/deleteCommitment` (optimistic). id = `'c'+Date.now()`.
- `end_date` (date, nullable): cross-midnight commitments rendered on both start and end date, matched via `c.date === date || c.endDate === date` — reused unchanged by the shift system below.

### Fixed shift types (session 2026-07-01, replaces the free-time-picker editor)
- **Decision**: no start/end time picker. A commitment now picks one of four fixed `shift` values — `'day'` (shades the full day cell), `'night'` (shades the bottom half of its start date and the top half of the following date — cross-midnight, via `endDate`), `'morning'` (top half), `'evening'` (bottom half). `type`/`start_time`/`end_time` columns are **kept in the schema but no longer written by the editor** (not dropped — a live migration removing columns wasn't worth the churn for 3 unused fields).
- **Backfill** (migration `add_shift_to_commitments`): the 5 pre-existing rows were best-guess mapped — the two with a start time later than end time (crossing midnight, e.g. `22:00–08:00`) → `shift:'night'` + `end_date` set to the day after; the rest (no usable times, or a `20:00–20:00` full-day-style entry) → `shift:'day'`. Confirmed with the user before applying since the mapping was genuinely ambiguous.
- **Rendering is two separate layers per day-col** (restructured this session):
  - `.shift-wash` — an absolutely-positioned full/half-height background div (`.sw-full`/`.sw-top`/`.sw-bottom` for position, `.sw-day`/`.sw-night`/`.sw-morning`/`.sw-evening` for color) rendered by `_renderShiftWash(c, renderDate)`, sitting *behind* everything else in `.day-col`.
  - `.day-content` — a new wrapper div holding everything that used to be direct children of `.day-col` (commit chips, task lines, tally, `+ busy` button). **This is now where `ondragover`/`ondragleave`/`ondrop` live**, not on `.day-col` — `_onWeekDrop`'s `insertBefore` targets a direct child of `evt.currentTarget`, so those attributes had to move down a level when the shift-wash sibling was introduced, or `insertBefore` would throw ("reference node not a child of this node"). `_dragAfterEl`/`_onWeekRailDrop` etc. are otherwise unaffected — querySelectorAll doesn't care about nesting depth.
  - `.day-col` itself keeps only `position:relative` (for the wash's absolute positioning), the border, and the today/past background tints.
- Editor: `_openCommitEditor(date[,id])` → shift segmented toggle (Day/Night/Morning/Evening) + title + notes + delete (when editing). The end-date field only shows for Night (`#commit-enddate-row`, toggled by `_commitShiftSelect(btn,val,date)`) and auto-fills to `date+1` if left blank, both on toggle and again defensively in `_saveCommit`.
- `.commit-band` chip (unchanged position, in the `.day-content` flow) shows a `.cb-type-badge` shift label instead of a work/exercise type badge; border-left color keyed by `.cb-shift-day/night/morning/evening` instead of `.cb-type-work/exercise`.

## Time-tracking foundation (for future duration prediction)
- `tasks.time_spent` + `archive.time_spent` (int minutes). Mapped as `timeSpent` in data.js.
- The Focus elapsed interval accrues **work-segment** minutes only onto `timerTask._workElapsed` (gated on `TIMER_SEQ[timerSegIdx].kind === 'work'`). `markDoingDone`/`removeFromDoing` add it to `item.timeSpent` before nulling `timerTask`; carries into the archive via the `...item` spread.
- Surfaced as `Σ Nm` on week chips and a "Focus time logged" line in the task detail modal. **Prediction/estimates not built** — capture only.

## Layout: "The Thread" (session 2026-06-22 redesign pass)
Replaced horizontal day-rows with a magazine-editorial thread layout. No graph-paper ground, no vivid pill chips. Structure:
```
.week-view
  .week-head           ← week range (display font) + nav buttons
  .week-thread         ← 7-col grid; thread-line pseudo + .day-station nodes
    .day-station[.today|.past|.future]   × 7
      .today-eyebrow   ← "TODAY" mono label (today only)
      .station-node    ← small circle on the thread (filled amber/coral=today, grey=past, hollow=future)
      .station-num     ← large display numeral (date)
      .station-name    ← MON/TUE/… mono eyebrow
  .week-columns        ← 7-col grid aligned under stations
    .day-col[.today-col|.past-col]   × 7
      .commit-band...  ← hatched muted bands
      .week-task...    ← serif task lines
      .wd-add-busy     ← hidden "+ busy" button
  .week-rail           ← unplaced this-week tasks
```
- Today: amber station node + "TODAY" eyebrow + warm background wash on `.today-col`.
- Past: 50% opacity `.past-col`; station node filled grey.
- Future: hollow ring station node.
- Thread line: CSS `::before` pseudo on `.week-thread` running between first and last station centers.
- `+ busy` hidden until `.day-col:hover`.

## Task lines (`.week-task`)
- Small `.wt-tick` (5px colored square, tag color from `.week-task.tag-*`) + serif body `.wt-body > .wt-title + .wt-meta`.
- Doing task = `.wt-now` coral circle in place of tick; no pill/chip border.
- Past = `.week-task.past` → struck title.
- Drag: `draggable="true"` on non-past items; drag-drop uses vertical `_dragAfterEl(container, clientY)`.
- Drop placeholder = `.week-drop-line` (2px amber line).

## Tasks board redesign (same session)
- Cards: small `.task-orb` bullet (8px circle, `background: var(--band-color)`) before title in `.card-top-main`.
- `.task-orb.done` → sage. `.card.is-first .task-orb` → amber + ring glow.
- No zone washes, no `::after` watermarks.
- Column separators: `.col-wrap + .col-wrap { border-left: 1px solid var(--line) }` + zero gap; padding 0 20px per column.
- `.card-meta` hover-reveal; `.card-hover-actions` (start → / ← later) unchanged.
- `.focus-drop-zone`: unchanged — hidden strip shown when `.columns.dragging-active`.

## Navigation redesign
- **Removed**: wordmark, topbar divider, import/export icon buttons, inline "Review Inbox" board button, `#tab-calendar` tab.
- **Primary tabs, left** (`.tab-group.tab-group-primary`): **Tasks · Projects only** — large, bold (`.tab-primary`, `font-display`, 16px/700), the "see" side of the nav.
- **Secondary icon row, right** (session 2026-07-01 nav restructure): Review, Week, and **Archive** (moved off the primary tab row) now live together in a label-less `.nav-icons` group inside `.topbar-right`, visually set apart by a `border-right` divider before the logout button — de-emphasized (small 26px icon buttons, muted color) until hovered/active. Tabler icon webfont (`ti ti-list-check` / `ti ti-calendar-week` / `ti ti-archive`), `title=` attr carries the accessible label since there's no visible text.
  - `#act-review` — unchanged id/handler (`openInboxReview`), classes now `nav-action nav-icon`.
  - `#act-week` — unchanged id/handler (`switchView('calendar')`), classes now `nav-action nav-icon`.
  - `#tab-archive` — unchanged id/handler (`switchView('archive')`), classes now `tab nav-icon` (kept the `tab` class so the existing `querySelectorAll('.tab')` active-clearing logic in `switchView`/`toggleArchive` still works even though it's no longer visually a "tab").
- `#act-week.active` when `view==='calendar' && !archiveOpen` — set by `_syncNavActions()` called from `switchView`, `toggleArchive`, `renderBoard`. Active state on the icon row (`#act-week`/`#tab-archive`) now renders as an amber icon + tinted background rather than an underline.
- `.nav-action` (and thus the whole `.nav-icons` row, since `#act-review`/`#act-week` keep the `nav-action` class) hidden at ≤640px via media query — `#tab-archive` does **not** carry `.nav-action`, so it stays visible on mobile exactly as before (mobile untouched by this pass).

## Daily rollover (`_dailyRollover`, `MAX_NEXT_CAP = 5`)
Called from `init()` after data loads, **and** from `_scheduleMidnightArchive()`'s live midnight timer (session 2026-07-01 — a tab left open overnight now re-runs the rollover live, not just on the next reload; see [tasks-board rule](./tasks-board.md)). Two steps:
1. **Advance overdue tasks**: `this-week` tasks where `scheduledDate < today` → set `scheduledDate = today`.
2. **Auto-promote to Next (capped at 5)**: count current `next` tasks; take first N `this-week` tasks where `scheduledDate === today`, sorted by `dayOrder` asc → `scheduledTime` → `dateAdded`; promote to `next`. Overflow tasks stay `this-week` and trigger `.col-waiting-note` in the This Week column header.
Next column sorted: `dayOrder` asc (nulls last) → `dueDate` → `dateAdded`.

## CSS
`style.css` block: `.week-view/.week-head/.wk-*/.week-thread/.day-station(.today/.past/.future)/.station-node/.station-num/.station-name/.today-eyebrow/.week-columns/.day-col(.today-col/.past-col)/.day-content(.drag-over)/.shift-wash(.sw-full/.sw-top/.sw-bottom/.sw-day/.sw-night/.sw-morning/.sw-evening)/.week-task(.past/.is-now)/.wt-tick/.wt-now/.wt-body/.wt-title/.wt-meta/.wt-time/.wt-spent/.wt-due/.wt-check/.wt-tally/.week-drop-line/.commit-band(.cb-shift-day/.cb-shift-night/.cb-shift-morning/.cb-shift-evening)/.week-rail/.wr-*/.rail-chip/.wc-title/.wc-due/.wc-later/.commit-modal/.modal-timespent`. Mobile: `.board-section[data-view="calendar"]` hidden in ≤640px media query.

## Not built / gaps
- Real Google/Apple calendar sync (manual commitments only).
- Hour-grid timed layout (chose priority stack).
- Duration **prediction** from `time_spent`.
- Mobile week view.
