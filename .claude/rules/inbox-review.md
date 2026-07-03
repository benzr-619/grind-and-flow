# Inbox Review — constellation canvas

Phase 2 (session 2026-06-16, redesigned 2026-06-16). The Inbox (`backlog`) is **no longer a board column** — it's a deliberate **review activity** opened from a "Review Inbox" button. The board renders **This Week / Next / Done** only.

## Board change
- `renderBoard()` derives board columns as `TASK_COLS.filter(c => c.id !== 'backlog')` and stamps `.columns[data-cols="N"]` (CSS sets 3-col grid for `data-cols="3"`). **`TASK_COLS` itself is unchanged** — "Inbox" stays a selectable status and is the default for "+ New Task".
- This Week cards get a hover-revealed **`← later`** button (`.later-btn`) → `App._sendToLater(id)`: demote to `backlog` + increment `laterCount`.

## The constellation (`#inbox-review`, full-screen overlay, desktop only)
- Reuses the overlay-fade pattern (`.inbox-review` / `.active`, shown via `el.style.display='flex'` + rAF). Hidden ≤640px via `#inbox-review { display:none !important }`; `.btn-review-inbox` also hidden on mobile. Container has `overflow:hidden`.
- A full-bleed **graph-paper SVG canvas** (`svg.ir-canvas`, `preserveAspectRatio="none"` so SVG coords map exactly to container percentages) fills the overlay.
- All tasks appear as **dots on a grid**, connected in triage order by thin right-angle (Manhattan) polylines:
  - **Decided** = solid dot on solid polyline.
  - **Active** = large pulsing dot at the leading edge; triage callout tethered by short elbow connector.
  - **Upcoming ghost** = next 3 pending tasks as faded dashed dots on a dashed path ahead.
  - **Dot color is purely decorative** (session 2026-07-01) — see Color scheme below. It used to encode the triage outcome; it no longer does.
- **Triage callout** = HTML overlay (`.ir-callout`) absolutely positioned at the active dot's coords (converted SVG→%). Edge-aware: flips left when active dot is in the right ~58% of the canvas. Renders as one of two card types (session 2026-07-01):
  - **Single-task card** (standalone tasks, or any already-decided task re-centered for undo): title, meta (due/age/bumped), triage buttons. Unchanged from the original design.
  - **Project-group card** (`.ir-callout-group`, wider at 400px): when the active task's `parentProject` is set (and it isn't already decided), the callout instead lists **every still-pending backlog task of that project together** — one row per task with its own This Week / Later / Never buttons, plus a single "Defer whole project to Later" bulk action. **Grouping is a callout-level concept only** — the constellation tree above still renders one dot per individual task regardless of grouping; the SVG layer (`_computeConstellation`, dots, tree edges) is completely unaware of project clusters.

## Color scheme (session 2026-07-01)
Dot fill no longer means anything — decided/active/ghost dots all draw from the same fun, stable-per-task palette (`_IR_FUN_COLORS`, 8 vivid hex values), picked via `_irFunColor(id) = _IR_FUN_COLORS[hash(id) % 8]` so a given task's dot stays the same color across re-renders but carries no triage meaning. Ghost dots use the same palette at reduced opacity + dashed stroke (that's what still reads as "not yet reached", not the hue). The old outcome→color legend (`.ir-legend`, bottom-left) was removed since it would now be false. `_outcomeColor()` is gone; `_irPreviewOutcome(outcome|null)` (hover on the triage buttons) no longer recolors anything — it just toggles a `.ir-hint` scale-pulse class on `#ir-active-dot`.

## Layout — `_computeConstellation(ids)`
- **8 × 6 grid** = 48 cells over 1200×800 viewBox (supports up to 48 tasks without overflow).
- **Serpentine/boustrophedon**: row 0 left→right, row 1 right→left, etc. — guarantees adjacent-cell hops, no overlap.
- **Jitter**: each dot offset ±(cell × 0.26) per axis from `_hashStr(id)` for organic hand-placed feel.
- Returns `Map<id, {x,y}>` in SVG units; same map drives dots, lines, and callout position.
- Constants: `_IR_COLS=8`, `_IR_ROWS=6`, `_IR_VBW=1200`, `_IR_VBH=800`, `_IR_MX=88`, `_IR_MY=112`.

## Helpers
- `_elbowPath(pts)` — Manhattan polyline: alternates horizontal-first / vertical-first L-bends between adjacent points (matches the reference mockup's `buildElbowPath`).
- `_irFunColor(id)` — stable-per-id pick from the decorative palette (see Color scheme above). Replaced `_outcomeColor`.
- `_irPreviewOutcome(outcome|null)` — toggles `.ir-hint` on `#ir-active-dot` for a scale-pulse hover hint; no longer recolors anything. Called from `onmouseenter`/`onmouseleave` on the triage buttons.
- `_renderReviewGroupCard(projId, groupIds)` — builds the project-group callout HTML (header, per-task rows with This Week/Later/Never, bulk defer button).
- `_reviewDeferProject(projId)` — bulk action: calls `_sendToLater(id, true)` for every still-pending task of that project.

## Session model (module-scoped in app.js)
- `_reviewSeq` — snapshot of task ids at open time (order stable for the whole pass).
- `_reviewOutcome` — `Map id → { action:'this-week'|'later'|'delete', snap:{status,backlogEnteredAt,laterCount} }`.
- `_reviewCenterId` — active/selected task (the pulsing dot + callout).
- `_reviewOrder(items)`: **due date asc first, then undated; ties/undated oldest-first** by `backlogEnteredAt||dateAdded`.

## Actions
- `_reviewThisWeek(id)` — snapshot, `_moveItem(id,'this-week')`, `_reviewAdvance()`.
- `_sendToLater(id, fromReview)` — increment `laterCount`, stay `backlog`; if `fromReview` record outcome + `_reviewAdvance()`, else `renderBoard()`.
- `_reviewDelete(id)` — **staged only** (`action:'delete'`), `_reviewAdvance()`. Actual `Data.deleteItem` runs in **`closeInboxReview()`** on close, so **"Never" is undoable for the whole pass**.
- `_reviewUndo(id)` — restore `snap` via `Data.upsertTask`; remove from outcome; recenter.
- `_reviewAdvance()` — center the first `_reviewSeq` id not in `_reviewOutcome`; none left → inbox-zero.
- Nav: `_reviewCenter(id)` (click a decided dot), `_reviewScroll(dir)` (wheel event — gated on `el._wheelBound` to prevent stacking on re-render).

## Action labels (time language)
`_REVIEW_OUTCOME_LABEL = { 'this-week': '→ This week', 'later': 'Deferred', 'delete': 'Never' }`. The third action button reads **"Never"** — the `action` key is still `'delete'` internally, behavior unchanged.

## CSS tokens added
`--ir-grid` (graph paper line colour), `--ir-pink`/`--ir-coral`/`--ir-ghost` (legacy outcome tokens — still referenced by the "This Week"/"Deferred"/"Never" **text label** colors in `.ir-outcome.o-*`, which are unaffected by the dot-color change; not used for dot fill anymore). Retired: `.ir-fade`, `.ir-spine`, `.ir-wheel`, `.ir-dot`, `.ir-row`, `.ir-title.sm`, `.ir-act.del` → replaced by `.ir-act.never`. Also retired (2026-07-01): `.ir-legend`/`.ir-legend-item`/`.ir-legend-dot` (the color→meaning key, now false). New: `.ir-callout-group`, `.ir-title-group`, `.ir-grp-list`, `.ir-grp-row`, `.ir-grp-title`, `.ir-grp-due`, `.ir-grp-actions`, `.ir-grp-act(.tw/.never)`, `.ir-grp-defer`, `#ir-active-dot.ir-hint`.

## Persistence
`later_count` column on `tasks` (migration `add_later_count_to_tasks`, default 0). Mapped in data.js `_taskToDb` (`later_count`) / `_taskFromDb` (`laterCount`). Not on the archive table.

## Exit flow (session 2026-07-01)
`closeInboxReview()` now calls `switchView('calendar')` instead of `renderBoard()` after flushing staged deletes — landing the user on the Week view so tasks just sent to This Week can be placed onto specific days right away.
