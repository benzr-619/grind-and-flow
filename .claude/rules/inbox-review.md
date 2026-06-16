# Inbox Review — vertical 3D task wheel

Phase 2 (session 2026-06-16). The Inbox (`backlog`) is **no longer a board column** — it's a deliberate **review activity** opened from a "Review Inbox" button (no count nudge). The board now renders **This Week / Next / Done** only.

## Board change
- `renderBoard()` derives board columns as `TASK_COLS.filter(c => c.id !== 'backlog')` and stamps `.columns[data-cols="N"]` (CSS sets 3-col grid for `data-cols="3"`). **`TASK_COLS` itself is unchanged** — it still feeds the New Task status `<select>`, so "Inbox" stays a selectable status and is the default for "+ New Task" (desktop capture path).
- This Week cards get a hover-revealed **`← later`** button (`.later-btn`, mirrors `.focus-btn`) → `App._sendToLater(id)` (no `fromReview` arg → board path): demote to `backlog` + increment `laterCount`.

## The wheel (`#inbox-review`, full-screen overlay, desktop only)
- Reuses the overlay-fade pattern (`.inbox-review` / `.active`, shown via `el.style.display='flex'` + rAF). Hidden ≤640px via `#inbox-review { display:none !important }`; `.btn-review-inbox` also hidden on mobile.
- A connected vertical **spine** of tag-colored **dots**; each task's info sits to the right. The **centered** task is enlarged + ringed and shows its triage actions; off-center tasks shrink/fade/tilt (CSS `perspective` + per-item `rotateX`/`scale`/`opacity`, sine-spaced `yPx = 330 + 270*sin(off*0.34)`, `|off|>4` omitted).

## Session model (module-scoped in app.js)
- `_reviewSeq` — task ids in review order, **snapshot at open** (stable positions).
- `_reviewOutcome` — `Map id → { action:'this-week'|'later'|'delete', snap:{status,backlogEnteredAt,laterCount} }` for items processed this pass.
- `_reviewCenterId` — currently centered task.
- `_reviewOrder(items)`: **due date asc first, then undated; ties/undated oldest-first** by `backlogEnteredAt||dateAdded`.
- `_reviewColor(item)`: first tag → `_tagClasses` → vivid hex via `REVIEW_COLORS` (work→coral, school→green, personal→blue, slots→violet/pink/coral/yellow/green); untagged → charcoal `#2A2A28`. Display-only — does not touch the global muted palette.

## Actions
- `_reviewThisWeek(id)` — snapshot, `_moveItem(id,'this-week')`, `_reviewAdvance()`.
- `_sendToLater(id, fromReview)` — increment `laterCount`, stay `backlog`; if `fromReview` record outcome + `_reviewAdvance()`, else `renderBoard()`.
- `_reviewDelete(id)` — **staged only** (records outcome `delete`, no data change), `_reviewAdvance()`. Actual `Data.deleteItem` runs in **`closeInboxReview()`** (flush) — so delete is undoable for the whole pass.
- `_reviewUndo(id)` — restore `snap` via `Data.upsertTask` (this-week/later) or just unstage (delete); remove from outcome; recenter.
- `_reviewAdvance()` — center the first `_reviewSeq` id not in `_reviewOutcome`; none left → **inbox-zero** state.
- Nav: `_reviewCenter(id)` (click a dot/row), `_reviewScroll(dir)` (bound **once** to the overlay's `wheel` event — gate on `el._wheelBound`, NOT the per-render `#ir-wheel`, or listeners stack).
- Processed items stay on the wheel above center as faded **history** with an outcome label (`→ This week` / `Deferred` / `Will delete`) + **Undo**.

## Persistence
`later_count` column on `tasks` (migration `add_later_count_to_tasks`, default 0). Mapped in data.js `_taskToDb` (`later_count`) / `_taskFromDb` (`laterCount`). Not on the archive table.
