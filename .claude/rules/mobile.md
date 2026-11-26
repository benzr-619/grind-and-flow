# Phone — One List stopgap (2026-11-25)

Replaces the 2026-08-11 bottom-tab-bar companion (Now / Projects / Inbox), which depended on
the retired `backlog` / `this-week` / `next` statuses. **This is deliberately bare.** The fuller
phone design (Today without Offered, Everything, Log — likely as a native SwiftUI app; see
`ONE-LIST-BRIEF.md` "Later: native rebuild") is future work.

Breakpoint unchanged: `max-width: 640px`. No schema changes.

## Architecture
- `index.html`: `<div id="mobile-app" class="ph-app">` (empty; JS fills it).
- `renderBoard()` → `if (_isMobile()) { _renderPhone(); return; }`. `_isMobile()` = `matchMedia('(max-width: 640px)')`; the existing debounced `resize` listener re-renders when the breakpoint is crossed.
- At ≤640px: `.ol-app`, `#focus-zone` and the old `.m-app` are hidden (`!important`); `.ph-app` is a `position:fixed; inset:0; height:100dvh` flex column: header → scrolling list → capture bar.
- `_renderPhone()` builds the shell once (so the capture input keeps its text/focus across re-renders) and re-renders only the date + list + chips.

## What's on it
- **Today** — `Data.todayList()`, numbered 1…n (same order as desktop; no reordering on the phone).
- **Due recurring** — `_recurDueList()` (due-soon/overdue) not already on Today, below a hairline, marked ↻ in `--ol-hot`.
- **Complete**: tap the circle (`_phDone`) or swipe right ≥35% of the row (`_phTouchStart/Move/End`; vertical movement bails out to scrolling; `touch-action: pan-y`). Plain tasks → `Data.completeTask` with a 4s **Undo** toast (undo = `deleteFromArchive` + re-upsert the snapshot; the `done` event stays logged). Recurring → `_completeRecurring` (anchored opens the existing mobile bottom-sheet confirm in `_openRecurConfirm`); no undo for recurring.
- **Capture** pinned at the bottom: 18px input (≥16px avoids iOS zoom), **save** button / Enter, tap chips `asap · date… · no rush · idea | Research AMD EDBA Home` (toggle; the four `when` chips are mutually exclusive; `date…` opens the native picker via a hidden `<input type=date>` + `showPicker()`). The title also goes through `GFParse.parseTitle`, so `#amd`, `by fri`, `idea:` and `every 2w` work too; chips win over inline text. Saved with `source: 'phone'` → lands in Offered on desktop (toast says so). **Ideas** (the `idea` chip or an `idea:` prefix) win over urgency/date/recurrence and land in Everything instead; toast: "Idea saved — it's in Everything on your computer". Never goes straight onto Today from the phone. Check: `dev/scenarios/idea-entry.cjs --mobile`.

## Not on the phone (desktop only)
Offered, pulling onto Today, reordering, Everything, Log, Focus, editing details/recurrence.

## Dead code
The old companion's `_renderMobileApp` / `_m*` functions and `.m-*` CSS are unreachable after this prompt and are deleted in Prompt 9. The shared `.bs-*` bottom-sheet primitives stay (the anchored-recurrence confirm uses them).

## Not verified
Real-device iOS Safari / installed PWA (keyboard + safe areas) — only checked in headless Chromium at 390×844 with simulated touch.
