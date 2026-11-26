> **RETIRED 2026-11-25 (One List).** Projects canvas + project-space modal deleted in Prompt 9; projects became the four areas. The `projects` and `tags` tables remain, unused. Kept for history only.

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
<div class="proj-canvas" style="height:Xpx">
  <div class="proj-grid-row" style="top:Ypx;height:Hpx">     <!-- one per row of ≤4 tag columns -->
    <div class="proj-grid-divider" style="top:34px"></div>  <!-- below: column titles; above: nothing -->
    <div class="proj-row-label" style="top:...">Active</div>  <!-- once per non-empty status band -->
    <div class="proj-band-area" style="left:92px">            <!-- titles + orbs share this % frame -->
      …proj-group-label column titles…
      …proj-orb elements…
    </div>
  </div>
  <!-- more .proj-grid-row siblings if >4 tag groups -->
</div>
```

### Grouping & sort
- Projects grouped by **first tag** (`(item.tags||[])[0] || ''`). Untagged goes last.
- Within each group, sorted by `PROJ_STATUS_ORDER` (active → up-next → someday → on-hold).
- Groups sorted by `_projSortedTagKeys(items)` (session 2026-07-01): tags with a stored `sortOrder` come first, ordered by that number; tags without one fall back alphabetically after them. Untagged (`''`) is always last regardless. See Column reordering below.

### Column grid
- Max **4 columns per row**. More than 4 tag groups wrap into a second `.proj-grid-row` below (`MAX_COLS = 4`) — each grid-row is its own independent header + shared-band unit (see Shared status grid below); a second grid-row of tags does **not** share bands with the first.
- Column center x: `(colIdx + 0.5) / n * 100%`, where `n` = columns in that grid-row, **relative to `.proj-band-area`'s width** (the grid-row minus the left row-label gutter — see below), not the full canvas width.
- Tag label: `.proj-group-label`, centered at column x, `top:8px` inside `.proj-band-area` (i.e. in the header zone, above the divider). No label for the untagged group. **Bigger + higher-contrast** (session 2026-07-01): `font-display`, 15px, weight 700, `var(--ink)` — was 9px mono `var(--muted)`. Also the **column drag handle** — see below.

### Column reordering (session 2026-07-01)
User-draggable via the `.proj-group-label` itself (`draggable="true"`, cursor `grab`). Persisted as `tags.sortOrder` (`sort_order` int column, migration `add_sort_order_to_tags`) — reuses the existing per-user `tags` table (already scoped `(user_id, name)` for color overrides) rather than a new table, since the canvas grouping key *is* the tag name.
- `_loadProjColOrder()` — `{tagName: sortOrder}` map built from `Data.get().tags`.
- `_projSortedTagKeys(items)` — shared by both the render and the drop handler so "current column order" is computed identically in both places.
- Drag flow: `_projColDragStart/Over/Leave/Drop/End`, module state `_projColDragKey`. On drop, `_projColDrop` recomputes the current key order, splices the dragged key to the target's position, then persists `Data.upsertTag(key, existingColorSlot, index)` for **every** key (not just the two swapped) so the whole sequence gets a clean 0..N sortOrder — `upsertTag`'s 3rd param is optional specifically so *other* callers (color reassignment, new custom tag) don't need to know about or touch sortOrder; see `data.js` `upsertTag`.
- `Data.upsertTag(name, colorSlot, sortOrder)` — `sortOrder` omitted → preserves the tag's existing stored order; passed explicitly → sets it. Works for built-in tags too (creates a `tags` row on first reorder, same precedent as color-override reassignment).

### Shared status grid (session 2026-07-01 — replaces independent per-column stacking)
User feedback on the legibility pass: independent per-column stacking meant the same status (e.g. "Active") landed at a different Y in every column, so nothing read as a row — and a column missing a status just had its other orbs float up to fill the gap. Reworked into a real grid: **every column in a grid-row shares the same status bands**, aligned at identical Y; a column with nothing in a given status simply leaves that band empty.
- **Header above a divider**: each `.proj-grid-row` reserves `HEADER_H = 34px` for column titles, then a full-width `.proj-grid-divider` (1px line) at that offset. Bands start `CONTENT_TOP = HEADER_H + 20px` below the divider.
- **Row labels, not per-column repeats**: status names ("Active"/"Up next"/"Ideation"/"On hold") render once per grid-row as `.proj-row-label`, in a fixed `ROW_LABEL_W = 92px` left gutter, vertically centered on their band (`CONTENT_TOP + band.top + band.height/2`). A status with **zero** projects anywhere in that grid-row gets no band and no label at all (not an empty reserved row) — only statuses actually present take up space.
- **Band height** = `max` over that grid-row's columns of `_rawBandStack(tagKey, status, stepFactor)` = `size * (1 + (n-1) * stepFactor)` for that status's `n` orbs in the tallest column. Bands stack top-to-bottom with `BAND_GAP = 28px` between non-empty ones.
- **Within a band**, a column's own orbs (if it has any for that status) still stack with the same-status overlap `stepFactor` (default `BASE_STEP = 0.88`, ~12% overlap) — unchanged in concept from before, just lighter (see Click-target fix below). A column with none just contributes nothing to that band.
- **`.proj-band-area`** (`position:absolute; left:{ROW_LABEL_W}px; right:0`) is the coordinate frame both column titles and orbs use for their `left:%` — it's narrower than the full canvas (excludes the row-label gutter), so percentage centering lines up correctly under the gutter's row labels.
- x jitter: `colCenterPct + altShift + (_hashStr(id) - 0.5) * 6` — keeps a loose feel without rigid alignment; see Click-target fix below for `altShift`.
- **Adaptive compression**: if a grid-row's raw content height (`_rawBandStack` summed across its non-empty bands, at `BASE_STEP`, plus `BAND_GAP`s) exceeds `TARGET_H = 760px`, a single global `stepFactor = max(MIN_STEP, BASE_STEP * TARGET_H / contentH)` is computed and applied everywhere. Compression only ever scales the same-status overlap — `BAND_GAP` (the separation between different statuses) is never compressed, so bands stay visually distinct even when heavily compressed.

### Click-target fix (session 2026-07-01, same day as the shared-grid rework)
User feedback on the first version of the shared grid: heavy same-status overlap (28% at `BASE_STEP`, up to 60% under old compression) made individual orbs hard to click — a mostly-covered orb's `.proj-orb-hit` circle was almost entirely occluded by the sibling drawn after it. Fixed with three changes, all in `_renderProjCanvas`:
- `BASE_STEP` raised `0.72 → 0.88` (28% → 12% overlap) and the compression floor raised via a new `MIN_STEP = 0.65` constant (was an inline `0.4` — i.e. compression could shrink to 60% overlap before; now caps at 35%).
- `TARGET_H` raised `620 → 760px` so compression (which is what drives overlap back up) kicks in less often — the canvas just scrolls a bit taller instead of squeezing orbs together.
- **Alternating left/right shift** for same-status siblings: `altShift = (i % 2 === 0 ? -1 : 1) * 7` (only applied when a band has >1 orb), on top of a smaller hash jitter (`±6%`, down from `±8%`). Pure random jitter could still unluckily place two consecutive same-status orbs at nearly the same x; alternating sides guarantees visual separation regardless of hash outcome, so a clickable sliver of each orb stays clear of its neighbors even when they vertically overlap.

### Canvas height
Each grid-row's height = `CONTENT_TOP + (sum of non-empty band heights + BAND_GAPs between them)`. Grid-rows stack with `ROW_GAP = 56px` between them; `canvasH = last grid-row's bottom + 40px`.

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

- `.proj-space` marker widens the modal via `.modal:has(.proj-space){width:1040px}` (enlarged from 880px, session 2026-07-01, alongside a font-size pass scoped to `.modal:has(.proj-space) .*` — title 18→22px, `.modal-label` →11px, `.modal-input` →14.5px, `.pst-title` 13.5→15px, `.pst-meta`/`.pspace-group-head`/`.pdest-opt` →11px, `.pspace-empty` 12.5→13.5px, notes textarea 120→150px tall. `.proj-modal-cols` left column widened 300→350px to match). Purely a legibility pass — no new fields.
- Child-task list `id="pspace-tasklist-{projId}"` (`_renderProjTaskList` → `_PSPACE_GROUPS`).
- Inline quick-add: `_projAddDest` (`'inbox'` default / `'this-week'`), reset on open.
- After any change: `_refreshProjModal(projId)` + `renderBoard()`.

## Unified add

- `openNewModal(opts)` accepts `{ parentProject?, defaultStatus? }`.
- `_saveNew` creates pending child tasks (`_pendingSubtasks`) alongside the new project. Re-opens project space on save when `_newParentProject` was set.

## One-time data migration — DONE (2026-06-16)

41 rows inserted (26 open → `backlog`, 15 done → `done`). `subtasks` column kept as backup. Re-running is idempotent (deterministic ids, `ON CONFLICT DO NOTHING`).
