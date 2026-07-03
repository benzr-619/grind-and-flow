# Recurring tasks

Session 2026-07-01, reworked same day after user feedback on the first design (see
"What was removed" below). Recurring tasks are now a **permanent, dedicated column** on
the Tasks board, edited through their own modal — not folded into This Week/Next via a
held-back status.

## Two kinds, not three
Collapsed from the original weekly/monthly/interval trio to two:
- **`rolling`** (was `interval`) — a fixed interval measured from the completion date
  (days/weeks/months). Fully automatic: completing it silently spawns the next occurrence.
- **`anchored`** (was `weekly`/`monthly`) — has a real due date (reuses the existing
  `due_date` column as its live next-occurrence date — no new date column). Completing it
  does **not** auto-advance the date; the user confirms the next due date via a small
  prompt (see Completion flow below). `recurrence_weekdays`/`recurrence_month_day` are kept
  on the schema, but demoted to an **optional default rule** that only pre-fills that
  prompt's suggestion — never a hard auto-schedule.

Daily recurrence is still out of scope (that's "habits," a separate feature).

## Schema — columns on `tasks`
Migration `rework_recurrence_rolling_anchored` collapsed the `recurrence` value set and
carried `recurrence_weekdays`/`recurrence_month_day` forward unchanged (they're just
reinterpreted as the optional default rule instead of the live schedule); the same
migration added one new column.

| JS camelCase | DB snake_case | Notes |
|---|---|---|
| recurrence | recurrence | `null` \| `'rolling'` \| `'anchored'` |
| recurrenceSeriesId | recurrence_series_id | unchanged — stable id shared by every occurrence in a series |
| recurrenceWeekdays | recurrence_weekdays | jsonb int[], `0=Mon…6=Sun` — anchored-only, optional default rule |
| recurrenceMonthDay | recurrence_month_day | int 1–31 — anchored-only, optional default rule |
| recurrenceIntervalN | recurrence_interval_n | int — rolling-only |
| recurrenceIntervalUnit | recurrence_interval_unit | `'days'` \| `'weeks'` \| `'months'` — rolling-only |
| recurrenceLeadDays | recurrence_lead_days | int, nullable — **new**, anchored-only. "Start showing as due-soon N days before due_date." |

`archive`'s lean subset is unchanged (`recurrence` + `recurrence_series_id` only — no
weekday/month-day/lead-days granularity there; a historical row doesn't need the live rule).

## The Recurring column — permanent home, not a holding pen
`TASK_COLS` gained `{ id: 'recurring', label: 'Recurring' }` as its **first** entry, so
after the board's existing `TASK_COLS.filter(c => c.id !== 'backlog')` it renders
**leftmost**, before This Week (`app.js` `renderBoard()`). The Tasks board is now 4 columns
(`data-cols="4"` — the default `.columns` grid was already 4-wide, so no new CSS rule was
needed beyond updating the stale comment on the old `data-cols="3"` override).

This replaces the original design's `'recurring'` status, which was a **holding status**
auto-promoted to `this-week` by `_dailyRollover` once its date arrived (anti-clutter via
hiding). That promotion step is now **deleted** — a recurring task never leaves the
Recurring column on its own. Instead, its card styling communicates urgency:
- **muted** (default / far out)
- **due-soon** (amber) — anchored only, once `daysUntilDue <= recurrenceLeadDays`
- **overdue** (red) — anchored only, past due date

Rolling cards show `"every N unit"` + the next occurrence date (if spawned yet). Anchored
cards show `"due <date> · in Nd / due today / Nd overdue"`. Card rendering is
`_renderRecurringCard(item)` (app.js), separate from `_renderTaskCard` — it isn't
draggable and its `.col-body` isn't a generic drop target (dropping an arbitrary task
into Recurring would set `status:'recurring'` with no recurrence config, so `_onDrop`'s
drag/drop attributes are omitted for that column specifically).

### Starting a recurring task into Focus
Each card gets a small `.recur-start-btn` (top-right, hover-revealed) that both **clicks**
(`onclick` → `App.startTask(item.id)`, same direct-call convention as every other card's
"start →" button) and accepts a **drag-swap drop** (`_onFocusDragOver/Leave/Drop`, the
same handlers the Next column's `.next-start-orb` uses — dropping any dragged card here
starts *that* dragged card, not necessarily this one, matching the established
convention). `startTask` has no status guard, so `recurring → doing` works unchanged.

## Dedicated Recurring modal — not the Detail/New Item modals
`openRecurringModal(id?)` (app.js) is a standalone modal for **both** create and edit:
- **Create**: the Recurring column header's `+ new recurring` button (replaces the
  generic `+ add`/`openNewModal` for this column only) calls `openRecurringModal()` with
  no id.
- **Edit**: `openDetail(id)` now redirects to `openRecurringModal(id)` at the top whenever
  `item.status === 'recurring'`, before any of the standard Detail-modal setup runs.

Fields: title, tags (reuses the exact same tags-row convention as the other two modals —
`modal-tags-row`/`_toggleItemTag`/`_addCustomTag` when editing an existing task so tag
edits persist immediately; `new-modal-tags-row`/`_addNewTag` when creating, collected at
save time), Rolling/Date-anchored type toggle, the type-specific fields, and notes. The
anchored branch has a collapsible "Default repeat rule" sub-section (`.rm-rule-toggle`)
reusing the `_RECUR_DOW` weekday-chip UI or a day-of-month input — explicitly labeled
"suggestion only, not enforced." Saving a new one creates the task directly with
`status:'recurring'` and `type:'standalone'` (no project-link field on this form — a
recurring task's `parentProject` can still carry over from an *older* linked task, just
not settable here). The Detail modal's "Move to" button row and the New Item modal's
status dropdown both exclude `'recurring'` now (`cols = TASK_COLS.filter(c => c.id !==
'recurring')`) — recurring tasks are exclusively made and edited through this modal.

`_recurEditorHtml`/`_onRecurTypeChange`/`_readRecurFields` (the old inline recurrence
editor embedded in the Detail/New Item modals) were deleted — recurrence is no longer
settable on a plain task from either modal. `_RECUR_DOW` and `_recurHistoryHtml` (past
occurrences list) survive, now used by the dedicated modal instead.

## Completion flow — the manual-confirm difference
Still wired through the same 4 completion call sites as before (`markDoingDone`,
`_moveItem(id,'done')`, board drop-to-done in `_onDrop`, `_projTaskToggleDone`), each
guarded on the *old* status not already being `'done'`, calling
`_maybeSpawnRecurrence(item, completionDateStr)` unchanged in signature.

- **Rolling**: unchanged from the original design — fully silent.
  `_nextRollingDate(item, fromDateStr)` = completion date + interval (`months` uses real
  calendar months via `Date.setMonth`, not ×30 days). The next occurrence is created
  immediately as `status:'recurring'`.
- **Anchored**: `_nextAnchoredSuggestedDate(item, fromDateStr)` computes a *suggestion*
  (next matching weekday/month-day if the optional default rule is set, else just the
  just-completed task's own due date as a starting nudge) and `_openRecurConfirm` pops a
  small non-blocking overlay (`.rc-overlay`/`.rc-modal`, module state `_recurConfirmState`)
  asking "Next due date?" + "Lead time?", both pre-filled and editable. **Dismissing it
  (backdrop click or "Use suggestion") still creates the next occurrence using the
  pre-filled defaults** — a recurring series is never silently dropped; dismissal just
  means "accept the suggestion," not "cancel." `_recurConfirmSave`/`_recurConfirmDismiss`
  both end by clearing `modal-root` and re-rendering.

## What was removed from the original 2026-07-01 design
- The `'recurring'` **holding-status semantics** — a recurring task no longer changes
  status on its own; `_dailyRollover`'s Step 1b (`recurring → this-week` promotion) is
  deleted entirely.
- Recurrence editing from the **Detail modal** and **New Item modal** (see above).
- The three-way `weekly`/`monthly`/`interval` type — collapsed to `rolling`/`anchored`.

## Not built
- Habits (daily recurrence) — explicitly separate, out of scope.
- Editing/cancelling only *future* occurrences of an already-spawned series (turning
  recurrence off, or deleting, the live occurrence just stops that one task; archived rows
  are untouched history).
- Mobile UI for the Recurring column/modal — desktop-first, per the standing rule; the
  column still renders on mobile (the responsive `.columns` grid just stacks it to
  single-column like the other three, unchanged mechanism), but the dedicated modal and
  its interactions haven't been mobile-tested.
- Project-link field on the dedicated Recurring modal (a recurring task's `parentProject`
  can only be set on data carried over from a pre-existing linked task, not from the
  create form).
