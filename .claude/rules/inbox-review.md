# Inbox Review — constellation canvas

Phase 2 (session 2026-06-16, redesigned 2026-06-16). The Inbox (`backlog`) is **no longer a board column** — it's a deliberate **review activity** opened from a "Review Inbox" button. The board renders **This Week / Next / Done** only.

## Board change
- `renderBoard()` derives board columns as `TASK_COLS.filter(c => c.id !== 'backlog')` and stamps `.columns[data-cols="N"]` (CSS sets 3-col grid for `data-cols="3"`). **`TASK_COLS` itself is unchanged** — "Inbox" stays a selectable status and is the default for "+ New Task".
- This Week cards get a hover-revealed **`← later`** button (`.later-btn`) → `App._sendToLater(id)`: demote to `backlog` + increment `laterCount`.

## The constellation (`#inbox-review`, full-screen overlay, desktop only)
- Reuses the overlay-fade pattern (`.inbox-review` / `.active`, shown via `el.style.display='flex'` + rAF). Hidden ≤640px via `#inbox-review { display:none !important }`; `.btn-review-inbox` also hidden on mobile. Container has `overflow:hidden`.
- A full-bleed **graph-paper SVG canvas** (`svg.ir-canvas`, `preserveAspectRatio="none"` so SVG coords map exactly to container percentages) fills the overlay.
- All tasks appear as **dots on a grid**, connected in triage order by thin right-angle (Manhattan) polylines:
  - **Decided** = solid coloured dot on solid polyline; colour = outcome (sage / pink / ink).
  - **Active** = large coral pulsing dot at the leading edge; triage callout tethered by short elbow connector.
  - **Upcoming ghost** = next 3 pending tasks as pale dashed dots on a dashed path ahead.
- **Triage callout** = HTML overlay (`.ir-callout`) absolutely positioned at the active dot's coords (converted SVG→%), showing parent project (if any), title, meta, and triage buttons. Edge-aware: flips left when active dot is in the right ~58% of the canvas.

## Layout — `_computeConstellation(ids)`
- **8 × 6 grid** = 48 cells over 1200×800 viewBox (supports up to 48 tasks without overflow).
- **Serpentine/boustrophedon**: row 0 left→right, row 1 right→left, etc. — guarantees adjacent-cell hops, no overlap.
- **Jitter**: each dot offset ±(cell × 0.26) per axis from `_hashStr(id)` for organic hand-placed feel.
- Returns `Map<id, {x,y}>` in SVG units; same map drives dots, lines, and callout position.
- Constants: `_IR_COLS=8`, `_IR_ROWS=6`, `_IR_VBW=1200`, `_IR_VBH=800`, `_IR_MX=88`, `_IR_MY=112`.

## Helpers
- `_elbowPath(pts)` — Manhattan polyline: alternates horizontal-first / vertical-first L-bends between adjacent points (matches the reference mockup's `buildElbowPath`).
- `_outcomeColor(outcome)` — `this-week → var(--sage)`, `later → var(--ir-pink)`, `delete/never → var(--ink)`, null → `var(--ir-coral)`.
- `_irPreviewOutcome(outcome|null)` — hover-tints the live active dot (`#ir-active-dot`), pulse ring (`#ir-active-pulse`), and elbow connector (`#ir-active-elbow`) to the hovered outcome's color; restores coral on `null`. Called from `onmouseenter`/`onmouseleave` on the triage buttons.

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
`--ir-grid` (graph paper line colour), `--ir-pink` (Later dot), `--ir-coral` (active dot), `--ir-ghost` (upcoming dot fill). Retired: `.ir-fade`, `.ir-spine`, `.ir-wheel`, `.ir-dot`, `.ir-row`, `.ir-title.sm`, `.ir-act.del` → replaced by `.ir-act.never`.

## Persistence
`later_count` column on `tasks` (migration `add_later_count_to_tasks`, default 0). Mapped in data.js `_taskToDb` (`later_count`) / `_taskFromDb` (`laterCount`). Not on the archive table.
