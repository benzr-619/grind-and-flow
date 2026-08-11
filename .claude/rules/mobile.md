# Mobile — companion surface (rebuilt 2026-08-11)

Full rebuild per `MOBILE-BRIEF.md`, replacing the phase 1–4 bolted-on layer (session
2026-06-07: a capture bar + Inbox/Today segmented toggle stacked *above* the desktop
board, which still rendered underneath in single-column form). Mobile is now a
**separate render path**, not CSS-hidden desktop DOM: a bottom-tab-bar companion app
covering four jobs — see, capture, complete, reference projects — with everything else
(Focus orb, Week view, Projects canvas, Inbox Review, Filters, Archive, Export/Import,
project creation, recurrence editing) explicitly out of scope and desktop-only.

Breakpoint unchanged: `max-width: 640px`. **No schema changes** — every field this
surface needs already existed.

---

## Architecture

`renderBoard()` (app.js) branches immediately: `if (_isMobile()) { _renderMobileApp(); return; }` —
`_isMobile()` is `matchMedia('(max-width: 640px)')`. Everything below that line (desktop
board/columns/canvas/week view) never runs on mobile. Inside the media query,
`.topbar`, `.board-section`, and `.save-banner` are hidden outright (`display: none
!important`), alongside the existing `#focus-zone`/`#inbox-review` mobile hides.
`#mobile-app` (`.m-app`) is a `position:fixed; inset:0` overlay, shown only inside the
media query — completely independent markup from `#board`.

A `resize` listener (`_mOnResize`, debounced 150ms, registered in `init()`) calls
`renderBoard()` so crossing the breakpoint without a reload (e.g. rotating a
foldable, or a desktop window resize during dev) re-renders the correct surface.

**Module state** (app.js, not persisted — defaults on every load):
```
let _mTab = 'now';        // 'now' | 'projects' | 'inbox'
let _mProjOpen = null;    // project id when the project detail screen is pushed
let _mUndo = null;        // { toastEl, timer } — the currently-showing undo toast
let _mSwipeState = null;  // in-flight touch gesture on a .m-row
let _mDoneExpanded = false;      // Now tab "N done today" collapse
let _mProjDoneExpanded = false;  // project detail "Done" group collapse
```

**Deleted**: `mobileTab`, `_renderMobileInbox`, `_renderMobileInboxContent`,
`_renderMobileToday`, `switchMobileTab`, `addMobileCapture`, `_openInboxSheet` and its
`_inbox*` action helpers, `#mobile-capture-bar`/`#mobile-seg-bar`/`#mobile-inbox` from
index.html, and all their CSS (`.mobile-capture-bar`, `.mobile-seg-bar`,
`.mobile-inbox*`, `.bs-quick-actions`/`.bs-quick-btn`/`.bs-complete`/`.bs-this-week`/
`.bs-next-up`). The `.bs-overlay`/`.bottom-sheet`/`.bs-handle*`/`.bs-title`/
`.bs-section`/`.bs-label`/`.bs-date-input`/`.bs-tags`/`.bs-textarea`/`.bs-footer`/
`.bs-delete-btn`/`.bs-delete-confirm*` primitives survive — every mobile sheet
(detail, capture, delete-confirm, the mobile anchored-recurrence confirm) is built on
top of them, now paired with `.m-sheet-quick`/`.m-sheet-qbtn` instead of the retired
quick-action grid.

---

## Shell — bottom tab bar

```
#mobile-app (.m-app)
  .m-header            ← title (current tab / open project name) + sign-out
  #m-content (.m-content)  ← scrolling area, rendered by _renderMobileApp()
  #m-fab (.m-fab)       ← capture, opens App._mOpenCapture()
  .m-tabbar             ← Now / Projects / Inbox, safe-area padded
```

`_renderMobileApp()` is the single entry point: syncs the active tab pill, the Inbox
badge count (backlog task count, hidden at zero), the header title, and dispatches to
whichever renderer the state calls for — `_mProjOpen` (project detail push screen)
takes priority over the tab content.

`_mSwitchTab(tab)` resets `_mProjOpen` and re-renders. `_mOpenProjectDetail`/
`_mCloseProject` push/pop the project detail screen without touching `_mTab` (so
"back" always returns to the Projects list, matching a real push navigation even
though there's no history stack — just the one `_mProjOpen` slot).

---

## Row component — shared by Now / Inbox / project-detail lists

`_mRowHtml(item, context)` (`context`: `'now'` | `'inbox'` | `'proj'`) renders one
`.m-row-wrap` — a tag-colored dot (`_mTagDotClass`, reuses `_tagClasses`), title, and a
context-aware meta line (`_mRowMeta`): project name, then either due/overdue countdown
(recurring items on the Now tab), inbox age + bump count (`context:'inbox'`, reuses
`_ageLabel`), or scheduled/due date (everything else).

Recurring items on the **Now** tab (`context==='now' && item.status==='recurring'`)
render **tap-only** — no swipe actions, no reveal panes — since "complete" for a
recurring occurrence needs the archive+respawn path (`completeRecurringToday`), and
"not today" doesn't map cleanly onto a cadence. Tapping opens the detail sheet, whose
quick actions include a dedicated recurring-aware Complete button. Every other row
(Now-tab tasks, Inbox rows, project-detail task rows) is swipeable.

---

## Swipe gesture (`_mSwipeStart`/`_mSwipeMove`/`_mSwipeEnd`/`_mSwipeCancel`)

One shared touch-only implementation, wired via inline `ontouchstart`/`ontouchmove`/
`ontouchend` (not `addEventListener`, so the listeners are non-passive by default and
`preventDefault()` works without an explicit `{passive:false}` option).

- **Vertical bail-out**: the first move past a 6px deadzone decides horizontal-swipe
  vs vertical-scroll by comparing `|dx|` vs `|dy|`; if vertical wins, `_mSwipeCancel()`
  resets `_mSwipeState` to `null` and every subsequent `touchmove` in that gesture
  no-ops (top-of-function `if (!_mSwipeState) return`), letting the page's native
  scroll take over uninterrupted.
- **Commit threshold**: `_M_SWIPE_COMMIT = 0.35` (35% of the row's own width).
  Below it, the row springs back (`transform: ''`, no state change). Above it, the
  row animates fully off-screen then `_mCommitSwipe(id, context, dir)` dispatches:
  `context==='inbox'` → right = `_mInboxThisWeek`, left = `_mInboxLater`; otherwise
  (`'now'`/`'proj'`, same semantics) → right = `_mNowComplete`, left = `_mNowNotToday`.
- **Tap**: `|dx| < 8px` at touchend is treated as a tap → opens the detail sheet
  (`_mOpenDetail`), not a swipe action.
- **Long-press** (Inbox rows only, `context==='inbox'`): a 550ms timer armed in
  `_mSwipeStart`, cleared on any real movement or on touchend; firing without
  movement calls `_mConfirmNever(id)` (a delete-confirm bottom sheet — "Never" is
  intentionally not undoable, unlike every other swipe action).
- `prefers-reduced-motion`: gated via `_mPrefersReducedMotion()` — the spring-back
  and off-screen animations become instant (`transition:'none'`) rather than skipped
  outright, since the row still needs to physically leave before the list re-renders.

## Undo toast

`_mShowUndo(label, id, snap)` appends a `.m-toast` directly to `document.body` (not
`#mobile-app` — it needs to float above everything, including any open sheet) with a
4s auto-dismiss and an Undo button that restores the snapshotted fields via
`Data.upsertTask` (`_mSnapshot`/`_mRestore` — same shallow-snapshot pattern as the
Inbox Review's `_reviewUndo`). Only one toast at a time — a new one clears the
previous via the `_mUndo` module ref. **Not covered by undo**: `_mNowComplete` on a
recurring occurrence (it archives + spawns the next occurrence immediately —
reverting would mean un-archiving and un-spawning, not just flipping `status` back;
backdating via the card's "⋯ Log date" is the intended correction path instead) and
the Inbox long-press delete (explicitly permanent, confirmed via sheet instead).

---

## Tab: Now

`_renderMobileNow()` — sections render only when non-empty (no empty placeholders):
**Due** (recurring tasks in a due-soon/overdue state, via the existing
`_recurDueList()`/`_recurDueState()` — unified with the desktop due banner, no
duplicate logic) → **Today** (`status==='next'` or `status==='this-week'` scheduled
for today, `dayOrder`→`scheduledTime`→`dateAdded` sorted) → **This week** (remaining
`this-week` tasks, excluding `_isFutureWeek()` ones and anything already listed under
Today, `boardOrder`→scheduled date/time sorted — same exclusion rule the desktop board
uses, so the two surfaces never disagree) → **Done today** (collapsed tally,
`_mToggleDone()` expands; reuses `_loadCompletionDates()` to scope to today's
completions, not just any `status==='done'` row).

## Tab: Inbox

`_renderMobileInboxTab()` — backlog tasks ordered via the existing `_reviewOrder()`
(due date asc, then oldest-first), identical sequence to desktop Inbox Review.

## Tab: Projects

`_renderMobileProjectsList()` groups by `_projSortedTagKeys()` (so desktop canvas
column drag-order carries over), sorted within a group by `PROJ_STATUS_ORDER`;
on-hold/someday rows get `.m-proj-dim`. `_renderMobileProjectDetail(projId)` is the
pushed detail screen: `_projectTasks()`/`_PSPACE_GROUPS` grouped task rows (Done
group collapsed by default, `_mToggleProjDone()`), a pinned quick-add
(`_mAddProjectTask`/`_mProjSetDest`, Inbox/Today destination — mirrors the desktop
project-space `_projAddDest` convention and **shares its module variable**, so
switching destination on mobile also affects a desktop project-space quick-add left
open in another tab of the same session), and a Capacities link row when
`capacitiesUrl` is set. No status changes, no project creation — desktop only.

## Detail sheet (`_mOpenDetail`)

Inline-editable title (`onchange`, not live — matches the brief's "tap to edit
inline"), a parent-project line that closes the sheet and pushes straight into that
project's detail screen, tag pills, a notes textarea, and a delete-with-inline-
confirm footer (`_mConfirmDeleteInSheet`/`_mResetDeleteInSheet`/`_mDeleteFromSheet` —
same two-step pattern the old `_inboxConfirmDelete` used). **Intentional non-closes**
carried over from the old sheet: saving notes/date/tags doesn't close the sheet or
force a background re-render (the mobile content behind a sheet isn't visible anyway,
so there's nothing to keep in sync until close).

Recurring occurrences render **read-only**: cadence text ("every 7 days" /
"due <date>") plus "— editable on desktop", a Complete button wired to
`completeRecurringToday` instead of the plain-task complete path, and a "Log date"
shortcut into the existing `openRecurLogDate` backdating flow. No recurrence editor.

### Anchored-recurrence completion confirm — mobile variant

`_openRecurConfirm` (used by `_maybeSpawnRecurrence`'s anchored branch) now branches
on `_isMobile()` first: a `.bottom-sheet` built on the same `.bs-*`/`.m-sheet-quick`
primitives as the detail sheet, same two field ids (`rc-date`/`rc-lead`) so
`_recurConfirmSave`/`_recurConfirmDismiss` work unchanged across both branches.
Dismissing (backdrop tap or "Use suggestion") still creates the next occurrence with
the pre-filled defaults — a series is never silently dropped, same guarantee as
desktop.

## Capture FAB (`_mOpenCapture`)

Autofocused 16px+ input (iOS zoom-on-focus guard — anything smaller triggers it),
tag chips, a collapsed "+ add to project" row that reveals a project `<select>`, and
two save paths: **Inbox** (submit / Enter — the sheet stays open, field clears, a
brief "Added" flash confirms, so several thoughts can be captured in a row) and
**Today** (`_mCaptureSubmit(null,'now')` — sets `status:'this-week'` +
`scheduledDate:_today()` and closes the sheet). New tasks keep the standard creation
shape (`'t'+Date.now()` id, `backlogEnteredAt` set only when landing in `backlog`).

---

## Feel — non-negotiables carried from the brief

Tap targets ≥48px (`.m-row` min-height 56px, `.m-tab` min-height 48px), no
drag-and-drop anywhere on mobile, every text input ≥16px, safe-area insets on the tab
bar/FAB/toast (`env(safe-area-inset-bottom, 0px)`), optimistic + instant (no awaits in
front of `Data.*`, which is already optimistic), tokens only (no hardcoded hex — the
tag-dot colors reuse the existing `--work-tag`/`--personal-tag`/`--teal`/`--wc-slot-*`
variables rather than duplicating `PROJ_STATUS_COLORS`' sanctioned-exception hexes).

---

## Not built / open questions (carried from `MOBILE-BRIEF.md` §11)

- Blocked-task treatment on the Now tab (currently no special-casing — a blocked task
  just shows like any other).
- Search — `searchQuery` is still unwired to any UI, mobile or desktop.
- Pull-to-refresh — skipped; optimistic state makes it low-value on a single-user app.
- Real-device iOS Safari + installed-PWA pass (verified so far only via static
  code/markup review and a local dev server — no test account was available in-session
  to exercise the logged-in flows end-to-end).
