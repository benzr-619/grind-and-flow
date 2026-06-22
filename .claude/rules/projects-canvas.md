# Projects Spatial Canvas + first-class task model

Redesign Phase 3 (session 2026-06-16). Canvas layout and orb system iterated in session 2026-06-19.

> **Desktop-first.** Like the other redesign overlays, this pass did not touch the ≤640px mobile layer. The canvas renders into `#board`; mobile still hides the projects board via `.board-section[data-view="projects"]`.

---

## The unified model

- A project's tasks = `Data.get().tasks.filter(t => t.parentProject === projId)` (helper `_projectTasks(projId)`).
- `status` is the single source of truth (`backlog`/`this-week`/`next`/`doing`/`done`).
- **Retired:** embedded subtask machinery and `.proj-orb-hover` tag-pill reveal. Orbs show title only.
- The `projects.subtasks` jsonb **column is kept** (archive-row compat) but is no longer read or written.
- Project done-guard (`_onProjStatusChange`, `_saveDetail`) blocks only on **non-done** child tasks (`t.status !== 'done'`). The `.legend-hint` text-flash on blocked drop was removed (element no longer exists).

---

## Canvas layout — column-per-tag (`_renderProjCanvas`)

`view === 'projects'` → `board.innerHTML = _renderProjCanvas(items)`.

`_renderProjCanvas` returns **two sibling elements** into `board.innerHTML`:

```html
<div class="proj-legend-bar">…</div>   <!-- always-visible status legend above canvas -->
<div class="proj-canvas" style="height:Xpx">…orbs…labels…</div>
```

### Grouping & sort
- Projects grouped by **first tag** (`(item.tags||[])[0] || ''`). Untagged goes last.
- Within each group, sorted by `PROJ_STATUS_ORDER` (active → up-next → someday → on-hold).
- Groups sorted alphabetically; untagged last.

### Column grid
- Max **4 columns per row**. More than 4 tag groups wrap into a second row below (`MAX_COLS = 4`).
- Column center x: `(colIdx + 0.5) / n * 100%` where `n` = columns in that row.
- Tag label: `.proj-group-label` centered at column x, `top = rowStartY + 14px`. No label for untagged group.

### Vertical stacking
- Orbs stack top-to-bottom by status with `stepFactor = 0.72` (~28% overlap).
- x jitter: `colCenterPct + (_hashStr(id) - 0.5) * 8` — keeps a loose feel without rigid alignment.
- **Adaptive compression**: if any column's raw height exceeds `TARGET_H = 620px`, a uniform `stepFactor = max(0.4, 0.72 * TARGET_H / tallestRawH)` is applied across all columns so they align.

### Canvas height
`canvasH = rowStartY (after last row) + 60px`.

---

## Orb visual system

### Size & color (both encode status)

```js
const PROJ_ORB_SIZE = { 'active': 200, 'up-next': 160, 'someday': 132, 'on-hold': 112 };
const PROJ_STATUS_COLORS = {
  'active':  '#C98B2A',   // amber
  'up-next': '#F2C94C',   // yellow
  'someday': '#8CAFD3',   // soft blue (labeled "Ideation" in legend UI; DB value unchanged)
  'on-hold': '#E5ADB8',   // dusty pink
};
```

Color is set as `--orb-color` inline style. `_projOrbColor(item)` just returns `PROJ_STATUS_COLORS[item.status]`.

### Orb HTML structure

```
.proj-orb[data-id, draggable, ondragstart/end, style="--orb-color;left;top;width;height;animation-delay"]
  .proj-orb-glow        ← blurred radial gradient; contributes interior brightness
  .proj-orb-body        ← main sphere gradient
  .proj-orb-label
    .orb-title          ← title only; no count, no due date
  .proj-orb-hit         ← invisible circular hit target; handles onclick
```

**`onclick` lives on `.proj-orb-hit`, not `.proj-orb`.** Drag handlers stay on `.proj-orb`.

### Orb CSS — key rules

```css
.proj-orb {
  /* no clip-path — visuals bleed freely */
  filter: drop-shadow(0 0 48px var(--orb-color));   /* ambient glow at rest */
  transition: filter 100ms ease-out, transform 100ms ease-out, opacity 100ms ease-out;
}
/* Hover triggered ONLY when the circular hit child is under cursor */
.proj-orb:has(.proj-orb-hit:hover) {
  opacity: 1 !important;                            /* equalises all status opacities */
  transform: translate(-50%, -8px) scale(1.12);
  filter: brightness(1.12) drop-shadow(0 0 72px var(--orb-color));
}
.proj-orb.status-on-hold { opacity: 0.58; }
.proj-orb.status-someday { opacity: 0.82; }

.proj-orb-hit {
  position: absolute; inset: 0;
  clip-path: circle(50%);   /* circular click/hover area */
  cursor: pointer;
}
.proj-orb-glow {
  position: absolute; inset: -16%;
  /* no transition — animating inset (4-property shorthand) causes jank */
}
```

---

## Legend bar (`_renderCanvasLegend`)

Returns `.proj-legend-bar` (horizontal flex row, placed ABOVE the canvas). Dot colors and sizes reflect status. Still drag-and-drop targets for `_projDropStatus`. Status label: "Someday" → **"Ideation"** (display only; DB `someday` string unchanged).

---

## Gotchas discovered (2026-06-19)

**`z-index` on `:hover` creates overlap dead zones.**  
When orbs overlap and the hovered orb gets `z-index: 20`, it climbs above adjacent orbs and keeps capturing mouse events as the cursor moves into the neighbor's visual area. The user must overshoot the neighbor's center before hover transfers. Fix: **never set `z-index` in `.proj-orb:hover`**. Natural DOM order (later elements on top) handles event routing correctly through overlap zones.

**`clip-path` on a parent clips all children, including those with negative `inset`.**  
The `.proj-orb-glow` child uses `inset: -16%` to bleed beyond the orb boundary. If `clip-path: circle(50%)` is on `.proj-orb`, the glow is clipped to a hard circle and the soft ambient bleed disappears. Keep `clip-path` on a separate child hit-target (`proj-orb-hit`) only.

**`filter: drop-shadow()` renders OUTSIDE `clip-path`.**  
Filters apply after compositing in the CSS rendering pipeline, so `drop-shadow` on an element with `clip-path` bleeds outward beyond the clipped boundary. This is intentional — it provides the external ambient glow on `.proj-orb` even though the glow child is clipped.

**`inset` is a 4-property CSS shorthand — never animate it.**  
`transition: inset 200ms` creates 4 simultaneous property animations and produces jank when sweeping the cursor across adjacent orbs. Only transition `opacity` on `.proj-orb-glow`.

**`status-on-hold` (opacity 0.58) and `status-someday` (opacity 0.82) dim the entire element.**  
Brightness and glow effects work against the dimmed baseline, making hover visually weaker for these statuses. Fix: `opacity: 1 !important` on hover brings all statuses to the same baseline before the visual effect is applied.

---

## Project space modal

- `.proj-space` marker widens the modal via `.modal:has(.proj-space){width:880px}`.
- Child-task list `id="pspace-tasklist-{projId}"` (`_renderProjTaskList` → `_PSPACE_GROUPS`).
- Inline quick-add: `_projAddDest` (`'inbox'` default / `'this-week'`), reset on open.
- After any change: `_refreshProjModal(projId)` + `renderBoard()`.

## Unified add

- `openNewModal(opts)` accepts `{ parentProject?, defaultStatus? }`.
- `_saveNew` creates pending child tasks (`_pendingSubtasks`) alongside the new project. Re-opens project space on save when `_newParentProject` was set.

## One-time data migration — DONE (2026-06-16)

41 rows inserted (26 open → `backlog`, 15 done → `done`). `subtasks` column kept as backup. Re-running is idempotent (deterministic ids, `ON CONFLICT DO NOTHING`).
