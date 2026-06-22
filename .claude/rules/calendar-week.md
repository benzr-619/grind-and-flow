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
- Chips: `_onWeekChipDragStart/End`. Day drop: `_onWeekDrop(e,date)` sets `scheduledDate`, computes fractional `dayOrder` via `_dragAfterElH(container, clientX)` for **mid-stack insertion** (not append-only), and promotes `backlog → this-week` **only when not a future week**. Future placement keeps `this-week` status — see filter below.
- `_dragAfterElH(container, cx)`: horizontal variant of `_dragAfterEl` — finds the chip after which to insert based on cursor X position. Returns null if dropping after all chips. Fractional dayOrder = midpoint between neighbors (or ±0.5 from nearest boundary).
- Visual drop placeholder: `_onWeekDragOver` inserts a `.week-chip.week-drop-placeholder` div at the insertion point; removed on `_onWeekDragLeave`/`_onWeekDrop`.
- Rail drop (`_onWeekRailDrop`) clears `scheduledDate`+`dayOrder` (stays `this-week`).
- `→ Later` on rail chips reuses existing `_sendToLater(id)` (→ backlog, `laterCount++`).
- `_weekDaySort`: `dayOrder` asc (nulls last) → `scheduledTime` → `dateAdded`.

## Future-week filter (touches the Planning board)
In `renderBoard()` the **This Week column** excludes `this-week` tasks where `_isFutureWeek(scheduledDate)` — so placing onto a future week moves them out of the live column (and the rail, which only lists `!scheduledDate`). They reappear when their week becomes current. Status is unchanged → fully reversible.

## Commitments (lightweight non-task busy context)
- `commitments` Supabase table (`id,user_id,title,date,start_time,end_time,end_date,type,color_slot,notes`), RLS `auth.uid()=user_id`. data.js: `_commitFromDb/_commitToDb`, loaded into `_state.commitments`, `Data.upsertCommitment/deleteCommitment` (optimistic). id = `'c'+Date.now()`.
- `end_date` (date, nullable): cross-midnight commitments rendered on both start and end date. End-date rendering shows "(contd.)" badge; start date shows "→" appended to time string.
- `type` (text, nullable): `'work'` | `'exercise'` | null (generic "busy"). Controls left-border color in `.commit-band` (`.cb-type-work` / `.cb-type-exercise`) and shows a `.cb-type-badge` label.
- Editor: `_openCommitEditor(date[,id])` → type segmented toggle (Busy/Work/Exercise) + optional end-date field + delete button when editing. `_commitTypeSelect(btn,val)` toggles `.active` among the buttons.
- Rendered inline as `.commit-band` in `.day-content` (hatched, muted — visually distinct from task chips). `＋ busy` per day (hidden until row hover) opens editor.

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

## Navigation redesign (same session)
- **Removed**: wordmark, topbar divider, import/export icon buttons, inline "Review Inbox" board button, `#tab-calendar` tab.
- **Left tabs** (`.tab-group`): Tasks · Projects · Archive only.
- **Right** (`.topbar-right`): `.nav-action#act-review` (→ `openInboxReview`) + `.nav-action#act-week` (→ `switchView('calendar')`), then logout.
- `#act-week.active` when `view==='calendar' && !archiveOpen` — set by `_syncNavActions()` called from `switchView`, `toggleArchive`, `renderBoard`.
- `.nav-action` hidden at ≤640px via media query.

## Daily rollover (`_dailyRollover`, `MAX_NEXT_CAP = 5`)
Called from `init()` after data loads. Two steps:
1. **Advance overdue tasks**: `this-week` tasks where `scheduledDate < today` → set `scheduledDate = today`.
2. **Auto-promote to Next (capped at 5)**: count current `next` tasks; take first N `this-week` tasks where `scheduledDate === today`, sorted by `dayOrder` asc → `scheduledTime` → `dateAdded`; promote to `next`. Overflow tasks stay `this-week` and trigger `.col-waiting-note` in the This Week column header.
Next column sorted: `dayOrder` asc (nulls last) → `dueDate` → `dateAdded`.

## CSS
`style.css` block: `.week-view/.week-head/.wk-*/.week-thread/.day-station(.today/.past/.future)/.station-node/.station-num/.station-name/.today-eyebrow/.week-columns/.day-col(.today-col/.past-col)/.week-task(.past/.is-now)/.wt-tick/.wt-now/.wt-body/.wt-title/.wt-meta/.wt-time/.wt-spent/.wt-due/.wt-check/.wt-tally/.week-drop-line/.commit-band(.cb-type-work/.cb-type-exercise)/.week-rail/.wr-*/.rail-chip/.wc-title/.wc-due/.wc-later/.commit-modal/.modal-timespent`. Mobile: `.board-section[data-view="calendar"]` hidden in ≤640px media query.

## Not built / gaps
- Real Google/Apple calendar sync (manual commitments only).
- Hour-grid timed layout (chose priority stack).
- Duration **prediction** from `time_spent`.
- Mobile week view.
