# Grind & Flow — Archive Page Redesign + Project Done State

## Before touching anything

Read `CLAUDE.md`, `style.css`, and `app.js` in full. The Tasks and Projects redesigns should already be complete. This prompt builds on the established palette. Verify CSS tokens are in place before proceeding.

---

## What this prompt covers

- Archive page render — row anatomy, folder icon differentiator, tag pills, parent project reference
- Project done state — new status value, validation enforcement, Archive display
- `app.js` — archive render function, project status handling, done-project validation
- No schema changes required

## What this prompt does NOT cover

- `data.js`, `auth.js` — untouched
- Tasks board or Projects board visual work (already complete)
- Mobile restructuring (token changes carry through — verify but don't restructure)

---

## 1. Project done state

### Add "Done" to project status dropdown

In the project detail modal, add `done` as an option in the status `<select>`:

```
Active / Up Next / On Hold / Someday / Done
```

Done projects are **not** moved to a separate archive table. They remain in the `projects` table with `status: 'done'`. The Archive view reads them directly from `Data.get().projects` filtered by `status === 'done'`.

### Validation before allowing "Done"

When the user selects "Done" from the status dropdown, immediately check:

```js
const activeTasks = Data.get().tasks.filter(t => t.parentProject === project.id);
```

If `activeTasks.length > 0`, **block the status change** and show an inline validation message directly below the status dropdown:

- Text: `"${activeTasks.length} task${activeTasks.length > 1 ? 's' : ''} still active — complete or delete them first"`
- Style: `font-size: 10px`, `color: #C98B2A`, `margin-top: 5px`
- The dropdown reverts to its previous value
- The Save button remains disabled while this message is visible

Also run this same check on Save if "Done" is somehow selected — treat it as a hard block, not a warning.

### Done projects leave the active board

Projects with `status === 'done'` must not render on the Projects kanban board. They should appear only in the Archive view. Update the project board render function to filter them out:

```js
const boardProjects = Data.get().projects.filter(p => p.status !== 'done');
```

### Restore action for done projects

In Archive, restoring a done project sets its `status` back to `'active'` via `Data.upsertProject()`. It returns to the Active column on the Projects board.

---

## 2. Archive page — visual redesign

### Overall layout

Same structure as current: page header, time-grouped sections (This Week / Last Week / Earlier), rows within each group. Projects and tasks are **interleaved chronologically** within the same time group — no separate sections.

- Group header timestamp logic: for done projects, use the date the status was set to "done" (you can derive this from `dateAdded` or store it — see note below)
- Background: `#F8F5F0`
- Section card background: `#FFFFFF`

**Timestamp for done projects**: the `projects` table does not currently have a `completedAt` field. Add a `completed_at` column (timestamptz, nullable) to the projects table via migration. Set it when `status` is changed to `'done'`. Use it for time-group placement in Archive. Include this migration in this prompt.

### Page header

```
saturday · jun 13   ← 9px, #C4BEB4, letter-spacing 0.8px, uppercase
Archive             ← 26px, font-weight 500, #1C1917, letter-spacing -0.8px

                                              [clear archive]
```

`Clear archive` button: `font-size: 10px`, `color: #D5CFC6`, `border: 0.5px solid #E3DDD4`, `padding: 4px 12px`, `border-radius: 4px`. De-emphasised — it is a destructive action and should not be the most prominent element on the page.

### Group headers

```
THIS WEEK                                                 14 done
```

- Label: `9px`, `letter-spacing: 1.8px`, `text-transform: uppercase`, `color: #B0A99F`, `font-weight: 500`
- Count: `9px`, `color: #C4BEB4`
- `padding: 14px 16px 6px`

---

## 3. Row anatomy

### Left-column alignment rule

All rows share the same left offset so titles align across task and project rows:

- **Project rows**: `ti-folder` (collapsed) or `ti-folder-open` (expanded) icon at `14px`, `color: #C4BEB4` for expanded / `#D5CFC6` for collapsed. Icon sits in a `14px`-wide fixed slot.
- **Task rows**: a `14px`-wide invisible spacer div (`width: 14px; flex-shrink: 0`) in the same slot. No icon, no bullet, no dot.

This keeps all titles left-aligned at the same x position.

### Task row

```
[14px spacer]  [title]  [tag pill?]  [parent project?]  [date]
```

- **Title**: `font-size: 12px`, `color: #1C1917`, `flex: 1`, truncate with ellipsis on overflow
- **Tag pills**: render all tags as proper pills (same style as card tag pills — background fill, no border). If the task has no tags, render nothing. Flex-shrink: 0.
- **Parent project name**: if `task.parentProject` is set, render the project title as `font-size: 10px`, `color: #C4BEB4`, `white-space: nowrap`, `flex-shrink: 0`. Resolve the project title by looking up `project.id === task.parentProject` in `Data.get().projects` — fall back to the projects archive if the project is done. If no parent project, render nothing.
- **Date**: `font-size: 10px`, `color: #C4BEB4`, `min-width: 36px`, `text-align: right`, `flex-shrink: 0`. Recent items (this week / last week): day name (`Mon`, `Tue`). Older: `Jun 4` format. Existing date formatting logic — do not change.
- **Row**: `display: flex`, `align-items: center`, `gap: 10px`, `padding: 9px 16px`, `border-bottom: 0.5px solid #F5F2EE`, `background: #FFFFFF`

**Remove entirely**: the existing bullet dot / circle element on the left of each task row.

### Project row (collapsed)

```
[ti-folder icon #D5CFC6]  [title bold]  [tag pill?]  [date]
```

- Icon: `ti-folder`, `14px`, `color: #D5CFC6`, `flex-shrink: 0`, `cursor: pointer`
- Title: `font-size: 12px`, `font-weight: 500`, `color: #1C1917`, `flex: 1`
- Tags: same pill style as task rows
- Date: same as task rows — uses `completed_at` value
- Clicking anywhere on the row toggles expanded state

### Project row (expanded)

```
[ti-folder-open icon #C4BEB4]  [title bold]  [tag pill?]  [date]
  └ nested task 1                                           Tue Jun 10
  └ nested task 2                                           Tue Jun 10
```

- Icon changes to `ti-folder-open`, `color: #C4BEB4`
- Nested tasks appear below in an indented block

### Nested task rows (inside expanded project)

```
[40px left padding]  [title]  [date]
```

- `padding: 6px 16px 6px 40px`
- `background: #FDFCFA`
- `border-bottom: 0.5px solid #F8F6F2`
- Title: `font-size: 11px`, `color: #B0A99F`
- Date: `font-size: 10px`, `color: #C4BEB4`, right-aligned

**Data source for nested tasks**: query `Data.get().archive` for tasks where `task.parentProject === project.id`. Sort by `archivedAt` descending (most recently completed first). These are already-archived tasks — no additional fetch needed.

The last nested row has `border-bottom: none`. The project row block as a whole has a `border-bottom: 0.5px solid #E3DDD4` to separate it from the next item.

---

## 4. Restore and delete actions

Existing restore and delete behaviour should be preserved and applied to both task rows and project rows. The interaction pattern (hover reveal or click-to-open detail) is unchanged — just ensure done projects are handled alongside archived tasks:

- **Restore project**: sets `project.status` back to `'active'`, clears `completed_at`, calls `Data.upsertProject()`. Project reappears on the Active column of the Projects board.
- **Delete project**: permanently removes the project via `Data.deleteProject()`. Does not affect the linked archived tasks — they remain in the archive table independently.

---

## 5. Schema migration

Add `completed_at` column to the `projects` table:

```sql
alter table projects add column if not exists completed_at timestamptz;
```

Apply via the Supabase MCP `apply_migration` tool. After applying, verify with `list_tables` or `execute_sql`.

In `data.js`:
- Add `completedAt` / `completed_at` to the field mapper (`_projToDb` and `_dbToProj`)
- Set `completedAt: new Date().toISOString()` when status is changed to `'done'`
- Clear it (`completedAt: null`) when a done project is restored

---

## 6. Clear archive behaviour

`Clear archive` removes all entries from the `archive` table AND removes all projects with `status === 'done'` from the `projects` table. Existing confirmation prompt before executing — do not remove it.

---

## 7. Verification checklist

- [ ] No bullet dots appear on any task row in Archive
- [ ] Task rows have a 14px spacer so titles align with project titles
- [ ] Tag pills render on task rows (not a single colored square)
- [ ] Parent project name renders on linked task rows; absent on standalone tasks
- [ ] Project rows show `ti-folder` (closed) or `ti-folder-open` (expanded)
- [ ] Expanding a project row shows linked archived tasks with dates
- [ ] Done projects do not appear on the Projects kanban board
- [ ] Selecting "Done" in the project modal validates active tasks — blocks with message if any exist
- [ ] Done projects appear in Archive grouped by `completed_at` date
- [ ] Restoring a done project from Archive returns it to Active column on the Projects board
- [ ] `completed_at` migration applied and field mapping added to `data.js`
- [ ] Clear archive removes both archived tasks and done projects
- [ ] Mobile view has no layout regressions
