# Grind & Flow — Projects Board + Modal Visual Redesign

## Before touching anything

Read `CLAUDE.md`, `DESIGN.md`, `style.css`, and `app.js` in full before making any changes. The Tasks board redesign (`REDESIGN_PROMPT.md`) should already be complete — this prompt builds on that established palette and pattern. Verify the CSS tokens from that prompt are already in place before proceeding.

---

## What this prompt covers

- Project card render function — remove completion indicators, add state pills
- Doing zone — hide when empty across both Tasks and Projects views
- Project detail modal — state control, subtask rows, Capacities section
- Two-way subtask sync — task done ↔ subtask checked
- Column headers on Projects board

## What this prompt does NOT cover

- Tasks board (already completed)
- Archive view
- `data.js` or `auth.js` — untouched
- Any auth or PWA logic
- Mobile layout restructuring (token changes carry through — verify but don't restructure)

---

## Design philosophy for Projects

Projects are **organizing containers**, not milestone trackers. They group related work. Do not treat them as things with a measurable completion state — no progress bar, no task count, no percentage. A project card communicates: what is this, what tags does it carry, how old is it, and is anything blocking it. That is all.

---

## 1. Doing zone — hide when empty (both pages)

Currently the doing zone renders regardless of whether a task is active. Change this:

- When `doingTask` is `null`: **do not render the doing zone or timer track at all** on either Tasks or Projects view. The board fills the full available height.
- When `doingTask` is set: render the doing zone exactly as designed in the Tasks redesign — same markup, same styles, same hover-reveal flanks.

This applies consistently across both views. No special casing — same logic, same result.

---

## 2. Project card redesign

### Remove entirely from project cards

- Progress bar element
- Percentage label (e.g. "29%")
- Task count (e.g. "2/7 tasks" or "no tasks yet")

Do not replace these with anything. The card has no completion indicator of any kind.

### Project card anatomy (collapsed state)

```
[Title]                                              [›]
[tag pill]  [waiting or blocked pill if set]   [age]
```

- Title: `11.5px`, `font-weight: 500`, `color: #1C1917`, `line-height: 1.3`
- Expand arrow `›`: `11px`, `color: #C4BEB4`, right-aligned, flex-shrink: 0
- Meta row: `display: flex`, `align-items: center`, `gap: 5px`, `margin-top: 5px`
- Age: `10px`, `margin-left: auto`, right-aligned. Same stale/old color logic as tasks:
  - Normal: `#D5CFC6`
  - Stale (≥7 days): `#C98B2A`
  - Old (≥14 days): `#A03028`

### State pills (waiting / blocked)

Render in the meta row alongside tags. Same size and padding as tag pills. Only render if the project's state is waiting or blocked — clear state shows nothing.

| State | Background | Text color |
|---|---|---|
| waiting | `#FDF5E0` | `#8A6B1A` |
| blocked | `#FDF0E0` | `#9B6E1F` |

**No other visual treatment** — no left border rule, no card background tint, no reason text in the card view. Same card height as any other project card regardless of state.

### Capacities bookmark icon

If `capacitiesUrl` is set on a project, retain the existing bookmark icon in the card title row. Restyle to `color: #C4BEB4`, `font-size: 13px`. This is one of the few functional persistent actions on a card — keep it.

### Expand / collapse

Retain the existing expand/collapse behavior. When expanded, the inline subtask list appears below the meta row. Subtask list styles in expanded state:

- Each row: `display: flex`, `align-items: center`, `gap: 8px`, `padding: 4px 0`, `border-top: 0.5px solid #F5F2EE`
- Drag handle `⠿`: `font-size: 10px`, `color: #D5CFC6`, `cursor: grab`
- Checkbox: `13×13px`, `border: 0.5px solid #D5CFC6`, `border-radius: 2px`. Done state: `background: #E6F3EC`, `border-color: #2B6E4E`, checkmark icon in `#2B6E4E`
- Subtask title: `11px`, `color: #1C1917`. Done state: `color: #C4BEB4`, `text-decoration: line-through`
- `+ add` subtask input at the bottom of the list, same style as modal

---

## 3. Column headers — Projects board

Same pattern as Tasks board:

- Label + count on one line, no hint text below
- Label: `9px`, `letter-spacing: 1.8px`, `text-transform: uppercase`, `color: #1C1917`, `font-weight: 500`
- Count: `9px`, `color: #C4BEB4`
- `margin-bottom: 10px`

Column labels: `Active`, `Up Next`, `On Hold`, `Someday`

Remove any subtitle / hint text currently rendered under column headers on the Projects board.

---

## 4. Project detail modal

### Title

Large editable input at the top. `font-size: 18px`, `font-weight: 500`, `color: #1C1917`, `letter-spacing: -0.4px`. Underline-style border (bottom border only: `0.5px solid #E3DDD4`) rather than a full box input. Remove the border on focus, show a subtle glow ring instead.

### Tags

Render as toggleable pills below the title — same as current but restyled:
- Active tag: pill with tag color (same palette as card tag pills)
- Inactive tag (available to add): `background: #F8F5F0`, `color: #C4BEB4`, `border: 0.5px solid #E3DDD4`
- New tag input: borderless, `font-size: 9px`, `color: #C4BEB4`, placeholder "new tag..."

### Status + dates

Three-column grid:

| Column | Field |
|---|---|
| 1 | Status dropdown (Active / Up Next / On Hold / Someday) |
| 2 | Scheduled date |
| 3 | Due date |

Scheduled time field: render below the scheduled date within the same column, or as a secondary input. Keep the existing date/time picker behavior.

Input styles: `border: 0.5px solid #E3DDD4`, `border-radius: 5px`, `padding: 6px 10px`, `font-size: 11px`, `color: #1C1917`, `background: #FDFCFA`.

### Notes

Textarea, same input style. `height: 52px minimum`, `resize: vertical`, `font-size: 11px`, `line-height: 1.5`.

### Subtasks section

Section label: `TASKS` in the established label style. Hint text "drag to reorder" right-aligned in `9px`, `color: #D5CFC6`, `font-style: italic`.

**Subtask rows:**

```
[⠿]  [☐]  [Subtask title]                    [↑ promote]
[⠿]  [☑]  [Completed title struck through]   [↑ promote]
[⠿]  [☐]  [Title] [on board ↩ recall]        [recall]
```

- Drag handle: `⠿`, `10px`, `color: #D5CFC6`, `cursor: grab`
- Checkbox: as described in card expand section above
- Title: `11px`, `color: #1C1917`
- Done title: `color: #C4BEB4`, `text-decoration: line-through`
- `↑ promote` button: `9px`, `color: #C4BEB4`, **opacity 0 by default, opacity 1 on row hover**, `cursor: pointer`. Only show on subtasks that have not been promoted and are not done.
- Promoted subtask: show `on board ↩` badge (`font-size: 9px`, `background: #EEF0F5`, `color: #7A7E8A`, `padding: 1px 5px`, `border-radius: 3px`) inline after the title. Show `recall` text right-aligned in `9px`, `color: #C4BEB4`. **Only show recall if the promoted task has not yet been marked done** — once the task is done, the recall action no longer makes sense.
- Row border-top: `0.5px solid #F5F2EE`

**Add subtask row** (bottom of list):

```
[Add task... input]  [+ add button]
```

Same input style as other fields. `+ add` button: `font-size: 10px`, `padding: 5px 10px`, `border: 0.5px solid #E3DDD4`, `border-radius: 4px`, `color: #7A7368`, `background: #FDFCFA`.

### Project state — segmented control

Replace the existing blocked/waiting toggle rows with a single three-way segmented control:

```
[  Clear  ]  [  Waiting  ]  [  Blocked  ]
```

- Container: `display: flex`, `border: 0.5px solid #E3DDD4`, `border-radius: 5px`, `overflow: hidden`
- Each segment: equal width, `font-size: 10px`, `padding: 5px 0`, centered text
- Inactive: `background: #FDFCFA`, `color: #C4BEB4`
- Active: `background: #1C1917`, `color: #F8F5F0`

When **Waiting** or **Blocked** is selected, render a reason textarea below the control:
- `margin-top: 8px`
- Same input style as other fields
- `height: 36px`, `resize: none`
- Placeholder: "Reason..."
- Pre-populate with existing `blockedReason` or `waitingReason` value

**State mapping to existing data fields:**
- Clear → `blocked: false`, `waiting: false`, `waitingAuto: false`, clear both reason fields
- Waiting (manual) → `waiting: true`, `waitingAuto: false`, save reason to `waitingReason`
- Blocked → `blocked: true`, save reason to `blockedReason`

If `waitingAuto` is `true` (waiting was auto-set by a blocked child task), show the "Waiting" segment as active but render a small note below in `10px`, `color: #C4BEB4`: "Auto-set — a linked task is blocked." The user can still switch to a different state to override manually.

### Capacities section

**Unlinked state:**

```
[Create Capacities page ↗]   or paste link   [_______ input _______]
```

- Button: `font-size: 10px`, `padding: 5px 12px`, `border: 0.5px solid #E3DDD4`, `border-radius: 4px`, `color: #7A7368`, `background: #FDFCFA`
- "or paste link" text: `10px`, `color: #D5CFC6`
- Input: flex-fill, same input style, placeholder `capacities://...`

**Linked state** (when `capacitiesUrl` is set):

```
[↗ Open in Capacities]                       [remove link]
```

- Open link: `10px`, `color: #2B6E4E`, shows the capacities URL domain as label
- Remove link: `10px`, `color: #D5CFC6`, right-aligned, cursor pointer

### Modal footer

```
[Delete project]                    [Cancel]  [Save]
```

- Delete: `10px`, `color: #D5CFC6`, left-aligned. On first click shows inline confirmation ("sure? yes / no") before executing.
- Cancel: `11px`, `padding: 6px 14px`, `border: 0.5px solid #E3DDD4`, `border-radius: 4px`, `color: #7A7368`
- Save: `11px`, `padding: 6px 14px`, `border-radius: 4px`, `background: #1C1917`, `color: #F8F5F0`
- Footer background: `#FDFCFA`, `border-top: 0.5px solid #F0EBE3`

---

## 5. Two-way subtask sync (app.js logic)

This is a behavioral change, not purely visual. Implement carefully and test thoroughly.

### Task marked done → check off subtask

When a task's status changes to `done` (via drag, via "done →" flank, or via modal):

1. Check if the task has a `parentProject` set
2. Check if the task's `type` is `'task'` (linked, not standalone)
3. Find the parent project in state
4. Find the subtask in the project's `subtasks` array where `promotedTaskId === task.id`
5. Set that subtask's `done: true`
6. Call `Data.upsertProject(parentProject)` to persist

### Subtask checked in modal → mark promoted task done

When a subtask checkbox is toggled to checked in the project modal:

1. Check if `subtask.promoted === true` and `subtask.promotedTaskId` exists
2. Find the task in state by `subtask.promotedTaskId`
3. If the task exists and is not already done, set its `status` to `'done'`
4. Call `Data.upsertTask(task)` to persist
5. The task will be picked up by the existing midnight auto-archive on next cycle

### Non-promoted subtasks

Subtasks with `promoted === false` (never put on the task board) simply toggle `done` on the subtask object within the project's `subtasks` array. They:

- Stay in the project's subtask list with `done: true` (visually struck through, below undone items if you want to sort — see below)
- Do **not** create entries in the tasks or archive tables
- Are captured in the project's `subtasks` jsonb when the project itself is archived

**Sort order in subtask list:** undone items first, done items below, preserving drag order within each group. This keeps the active work visible at the top without the user having to manage it.

### Recall guard

The `recall` action (removing a promoted task from the board and restoring the subtask to unchecked) should only be available when the promoted task's status is not `done`. If `task.status === 'done'`, do not render the recall button — the work is complete.

---

## 6. Verification checklist

Before marking complete:

- [ ] Doing zone hidden on both Tasks and Projects when no active task
- [ ] Doing zone renders correctly on Projects page when a task is active
- [ ] Project cards show no progress bar, no task count, no percentage
- [ ] Waiting pill: muted gold. Blocked pill: muted amber. Both same height as regular cards.
- [ ] No left border on any project card regardless of state
- [ ] Column hints removed from Projects board header
- [ ] Modal state control is a three-way segmented toggle (Clear / Waiting / Blocked)
- [ ] Reason field appears conditionally for Waiting and Blocked states
- [ ] `↑ promote` on subtask rows is hover-only
- [ ] Recall only appears on promoted subtasks whose task is not yet done
- [ ] Marking a task done on the board checks off its parent subtask
- [ ] Checking a subtask in the modal marks the promoted task done on the board
- [ ] Non-promoted subtask check does not create any task or archive entry
- [ ] Done subtasks sort below undone subtasks in the list
- [ ] Capacities linked/unlinked states both render correctly
- [ ] Delete requires inline confirmation before executing
- [ ] Mobile view has no layout regressions from the doing zone change
