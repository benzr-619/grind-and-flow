# Mobile Responsive Layer

Added in phases 1–4 (session 2026-06-07). Breakpoint: `max-width: 640px`.

---

## Sticky header stack

Three elements stack at the top of the mobile viewport, each sticky at a precise `top:` offset:

| Element | Selector | `top` | z-index | Notes |
|---|---|---|---|---|
| Topbar | `.topbar` | `0` | `100` | Always present |
| Capture bar | `#mobile-capture-bar` | `50px` | `99` | Sticky below topbar |
| Segmented toggle | `#mobile-seg-bar` | `107px` | `98` | `50 + 57px` (capture bar height) |

If capture bar height ever changes (padding/font), update `top: 107px` on `.mobile-seg-bar` to match.

---

## Show/hide pattern

All mobile-only elements are **hidden by default** in the base stylesheet (outside any media query), then revealed inside `@media (max-width: 640px)`:

```css
/* base — desktop sees nothing */
.mobile-capture-bar { display: none; }
.mobile-seg-bar     { display: none; }
.mobile-inbox       { display: none; }

@media (max-width: 640px) {
  .mobile-capture-bar { display: flex; ... }
  .mobile-seg-bar     { display: flex; ... }
  .mobile-inbox       { display: block; ... }
}
```

Do not put these in the media query only — they must be `display: none` at base so desktop is truly unaffected.

---

## Hiding the Projects board on mobile

`renderBoard()` stamps a `data-view` attribute on `.board-section` every render:

```js
document.querySelector('.board-section')?.setAttribute('data-view', archiveOpen ? 'archive' : view);
```

CSS inside `@media (max-width: 640px)` then hides it when projects are active:

```css
.board-section[data-view="projects"] { display: none; }
```

This is purely presentational — the board still renders in the DOM.

---

## Mobile panel (`#mobile-inbox`) and `mobileTab`

`#mobile-inbox` is a single container div reused for both the Inbox and Today views. The active view is controlled by the closure variable `mobileTab` (`'inbox'` | `'today'`; not persisted, defaults to `'inbox'` on load).

Call chain on every `renderBoard()`:
```
renderBoard() → _renderMobileInbox() → _renderMobileInboxContent(panel)
                                      → _renderMobileToday(panel)
```

`switchMobileTab(tab)` flips `mobileTab`, toggles `.active` on `#seg-inbox` / `#seg-today`, then calls `_renderMobileInbox()` directly (does not call `renderBoard()` — no board redraw needed for a tab switch).

---

## Bottom sheet

Tapping any row in either mobile view calls `App._openInboxSheet(id)`, which renders into `#modal-root` — the same root used by the desktop modals. Clear with `modal-root.innerHTML = ''`.

Structure:
```
.bs-overlay          ← full-screen backdrop; onclick → _closeInboxSheet()
  .bottom-sheet      ← stopPropagation; slides up via @keyframes sheet-up
    .bs-handle-row
    .bs-title
    .bs-quick-actions  ← Complete / This Week / Next Up
    .bs-section        ← Schedule (date picker)
    .bs-section        ← Tags (reuses .modal-tag-pill)
    .bs-section        ← Notes
    .bs-footer         ← Delete (inline confirm via _inboxConfirmDelete / _inboxResetDelete)
```

**Intentional non-closes:**
- `_inboxSchedule` does NOT close the sheet — user may want to chain actions (e.g. schedule then tag).
- `_inboxSaveNotes` does NOT call `renderBoard()` — avoids stealing focus from the textarea mid-type.

**Re-render after actions:** `_inboxComplete`, `_inboxMove`, `_inboxDelete` all close the sheet then call `renderBoard()`, which re-renders the active panel. Today view re-filters on render, so completing or rescheduling a task removes it from the Today list automatically.

---

## Inbox / backlog relabeling (phase 4)

The internal status enum **`backlog` is never shown to users** — it is surfaced everywhere as **"Inbox"**. Mapping points:

| Location | Internal value | Display value |
|---|---|---|
| `TASK_COLS[0].label` | `id: 'backlog'` | `label: 'Inbox'` |
| Column hint | — | `'move or leave'` |
| Age counter text | `_daysDiff(backlogEnteredAt)` | `_ageLabel(backlogEnteredAt)` e.g. "3d ago", "1w ago" |
| Subtask `loc` badge | `st.loc === 'backlog'` | `'INBOX'` |
| Mobile panel head | — | `'Inbox'` |

**Do not change:** `col.id`, `data-col` attribute, `status === 'backlog'` comparisons, `backlogEnteredAt` field name, archive/migration logic. Those all use the raw `'backlog'` string and must stay as-is.

---

## Today view filtering

`_renderMobileToday` filters: `t.scheduledDate === _today() && t.status !== 'done'`. Archive rows are in a separate table (`Data.get().tasks` never contains archived items), so no extra exclusion needed. Sorted by `scheduledTime` ascending; items with no time sort to the bottom (key `'99:99'`).
