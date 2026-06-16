# Projects Spatial Canvas + first-class task model

Redesign Phase 3 (session 2026-06-16). Replaced the Projects Kanban columns with a spatial **drifting-orb canvas**, and collapsed the subtask/task distinction: **a project's tasks are now first-class `tasks` rows linked by `parentProject`** (no more embedded `subtasks` array as the source of truth).

> **Desktop-first.** Like the other redesign overlays, this pass did not touch the ≤640px mobile layer. The canvas renders into `#board`; mobile still hides the projects board via `.board-section[data-view="projects"]`.

---

## The unified model

- A project's tasks = `Data.get().tasks.filter(t => t.parentProject === projId)` (helper `_projectTasks(projId)`; progress via `_projectProgress`).
- `status` is the single source of truth (`backlog`/`this-week`/`next`/`doing`/`done`). The Inbox holds **all** `backlog` tasks — standalone *and* project-linked. A project-linked `backlog` task shows in both the global Inbox and its project space.
- **Retired:** the embedded subtask machinery — `_renderSubtaskRow`, `_buildModalSubtaskRow`, `_addSubtask`, `_removeSubtask`, `_editSubtask`, `_promoteSubtask`, `_recallSubtask`, `_toggleSubtask`, `_syncSubtaskFromTask`, `_toggleProjOpen`, `_inlineAddSubtask`, and all `_st*` drag fns. The `promoted/loc/promotedTaskId` fields and the two-way sync are gone.
- The `projects.subtasks` jsonb **column is kept** (archive-row compat + migration backup) but is no longer read or written. New projects save `subtasks:[]`.
- Project done-guard (`_onProjStatusChange`, `_saveDetail`) now blocks only on **non-done** child tasks (`t.status !== 'done'`).

## Canvas (`renderBoard` projects branch → `_renderProjCanvas`)

- `view === 'projects'` → `board.innerHTML = _renderProjCanvas(items)` (the columns builder is the `else`). Done projects still excluded.
- `_renderProjOrb(item, pos)`: **size** by status (`PROJ_ORB_SIZE`: active 200 → up-next 160 → someday 132 → on-hold 112); **colour** by first tag via `_projOrbColor` → vivid `REVIEW_COLORS` (untagged → steel `#8A8378`), set as `--orb-color`; **position** from `_hashStr(item.id)` (deterministic — no `Math.random`, so orbs don't jump per render) scattered horizontally, flowed vertically (no overlap). Orb keeps `data-id` and `onclick="App.openDetail(id)"`.
- Structure: `.proj-orb > .proj-orb-glow + .proj-orb-body + .proj-orb-label(.orb-title/.orb-meta) + .proj-orb-hover(tags)`. Label shows a neutral **"N open"** count (`_projectOpenCount` — non-done tasks) + due; tags reveal on hover. **No completion ratio/progress bar anywhere** — projects accrue tasks over time, so a percentage would be false info; this UI is for *organizing*, not progress-tracking (explicit user call).
- **Drift, not breathe:** keyframe `proj-drift` (16s, subtle translate+scale) with per-orb negative `animation-delay` to desync. The Focus `orb-breathe` is **reserved for Focus** — keep these visually distinct. Gated by `prefers-reduced-motion`.
- Corner `_renderCanvasLegend()` maps status→dot size.

## Project space (enlarged modal — reuses `openDetail` project branch)

- Not a full-screen overlay (deliberate — fast in/out). A `<div class="proj-space"></div>` marker widens the modal via `.modal:has(.proj-space){width:680px}`.
- Body replaces the old subtask list with the **child-task list** `id="pspace-tasklist-{projId}"` (`_renderProjTaskList` → groups Inbox/This Week/Next/Doing/Done via `_PSPACE_GROUPS`) and an inline quick-add. **No progress bar.**
- Row checkbox → `_projTaskToggleDone` (done ↔ this-week); title → `openDetail(taskId)` (full task editor); `_projTaskDelete`. After any change, `_refreshProjModal(projId)` re-renders the list and calls `renderBoard()` (canvas orb "N open" count updates live).
- **Inline quick-add** `_addProjectTask`: title + destination toggle `_projSetAddDest` (`#pspace-dest`, module var `_projAddDest`, reset to `'inbox'` on open) — **Inbox** default, **Start now** → this-week. `⋯` (`_addProjectTaskDetailed`) opens the full New-Task modal for notes/dates/tags.

## Unified add (`openNewModal(opts)` / `_saveNew`)

- `openNewModal(opts)` accepts `{ parentProject?, defaultStatus? }`; a legacy **string** arg (column "+ add") is normalized to `defaultStatus`. `presetParent` forces a **task** modal (even in projects view) with the parent shown locked (`.new-parent-lock`) and status defaulting to `backlog` ("Destination"). Module flag `_newParentProject` is set here.
- `_saveNew` branches on `_newType === 'project'`. New-project modal captures **pending task titles** (`_pendingSubtasks` as `{id,title}`, `_addPendingTask`/`_removePendingTask`/`_renderPendingTaskList`); on save it creates the project then a `backlog` child task per pending title. When `_newParentProject` was set, after save it **re-opens the project space** (`openDetail(reopenProj)`) so capture can continue.

## One-time data migration — DONE (2026-06-16)

Ran via Supabase MCP `execute_sql`. Expanded every non-promoted embedded subtask into a first-class `tasks` row, idempotent (deterministic id `'t'||substr(md5(proj.id||subtask.id),1,12)` + `ON CONFLICT (id) DO NOTHING`), keeping the `subtasks` column untouched as backup.

- 41 rows inserted: **26 open → `backlog` (Inbox)**, **15 done → `done`** (user chose to keep finished work as done child tasks).
- `promoted` subtasks skipped (their task rows already existed).
- Verified: expected 41 = present 41; `subtasks` backup intact on all 17 projects.

To re-run safely (e.g. if more legacy subtasks surface), the same INSERT is idempotent. **Re-running on a project after the user has *manually* re-added a same-id subtask is not a concern** — ids are md5-derived per (project, subtask).

**Follow-up — phase 3.6 (recommended next):** the 26 migrated open tasks now sit in the global Inbox alongside standalone backlog tasks. Build **Inbox-Review grouping by `parentProject`** (group headers in the wheel + a "Later — whole project" bulk-bump) to make triaging that volume painless. See CLAUDE.md "Not yet built".
