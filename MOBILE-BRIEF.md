# MOBILE-BRIEF.md — Mobile rebuild (2026-08-11)

Companion to `REDESIGN-BRIEF.md`. The desktop four-mode redesign is feature-complete; mobile
was never redesigned, only bolted on (phases 1–4, session 2026-06-07). This brief replaces
that layer entirely.

**Standing rule inverted for this pass:** every prior redesign brief said "do not touch
mobile." This pass is *mobile only* — **desktop must be pixel-identical when it ends.**

---

## 0. North Star

Mobile is not a shrunken desktop. It is a **companion surface** for four jobs:

1. **See what's on my plate** — today / this week, at a glance.
2. **Capture** — a thought becomes a task in under three seconds.
3. **Complete** — check things off, including recurring cadences.
4. **Reference projects** — what am I working on, and add a task to one.

Everything else lives on desktop. The measure of success is **friction**, not coverage:
fewer taps, bigger targets, no drag-and-drop, no modals stacked on modals.

### Explicitly out of scope
Focus timer / breathing orb / PiP · Week (Calendar) view · Commitments · Projects spatial
canvas (orbs, drift, tag columns, drag-reorder) · Inbox Review constellation · Filters ·
Archive browsing · Export/Import · Creating projects · Editing recurrence rules.

Recurring tasks are *completed* on mobile, never *configured* there.

---

## 1. Architecture

**Separate render path, not CSS-hidden desktop DOM.** The current approach — render the
desktop board and hide pieces at ≤640px — is why mobile feels vestigial. Replace with:

- New root container `#mobile-app` in `index.html`, `display:none` at base, `display:flex`
  inside `@media (max-width: 640px)` (the existing show/hide convention from
  `.claude/rules/mobile.md` — keep it).
- Inside that media query, `.board-section` and `.topbar` are hidden outright. `#focus-zone`
  and `#inbox-review` keep their existing `display:none !important` rules — **do not touch
  the `!important`**, it is load-bearing (JS sets inline `display:flex`).
- `renderBoard()` gets an early branch: if the viewport is mobile, call `_renderMobileApp()`
  and return. Desktop render path untouched below it.
- All persistence still goes through `Data.*`. No new tables, **no schema changes** — every
  field this design needs already exists.

**Module state (app.js, module-scoped):**
```
let _mTab       = 'now';        // 'now' | 'projects' | 'inbox'
let _mProjOpen  = null;         // project id when the project detail screen is pushed
let _mUndo      = null;         // { label, revert:fn, timer }
```
Not persisted — defaults to `now` on every load. Do not add localStorage keys.

**Delete when done:** `#mobile-capture-bar`, `#mobile-seg-bar`, `#mobile-inbox`,
`_renderMobileInbox`, `_renderMobileInboxContent`, `_renderMobileToday`, `switchMobileTab`,
and the `mobileTab` closure variable. `_openInboxSheet` and its `_inbox*` action helpers are
the basis for the new detail sheet — refactor, don't rewrite from zero.

---

## 2. Shell — bottom tab bar

```
┌─────────────────────────┐
│  Now              ⌄     │  ← slim header: current tab name (display font), sign-out in ⌄
│  ─────────────────────  │
│                         │
│   (scrolling content)   │
│                         │
│                   ( ＋ )│  ← capture FAB, floats above tab bar
├─────────────────────────┤
│  ◉ Now   ◇ Projects  ✉ 3│  ← fixed tab bar, safe-area padded
└─────────────────────────┘
```

- `.m-tabbar` — `position:fixed; bottom:0`, `padding-bottom: env(safe-area-inset-bottom)`.
  Three tabs, each ≥48px tall, icon + label. Active = amber icon + ink label; inactive muted.
- Inbox tab carries a count badge (backlog task count). Badge hidden at zero.
- `.m-fab` — 56px circle, `bottom: calc(76px + env(safe-area-inset-bottom))`, right 20px.
- Header is *not* sticky-stacked like the old three-layer arrangement. One slim header only.

---

## 3. Tab: Now

One scroll, sections in this order. Section headers are small mono eyebrows; a section with
zero items renders nothing at all (no empty placeholders).

| Section | Contents |
|---|---|
| **Due** | Recurring tasks needing attention: `recurrence==='rolling'` with `_recurOverdueDays(item) > 0`, or `recurrence==='anchored'` with `daysUntilDue <= recurrenceLeadDays` (incl. overdue). Reuses the existing helpers verbatim. |
| **Today** | `status === 'next'`, plus `status==='this-week' && scheduledDate === today`. Sorted `dayOrder` asc (nulls last) → `scheduledTime` → `dateAdded`. |
| **This week** | Remaining `this-week` tasks, **excluding** `_isFutureWeek(scheduledDate)` — same rule the desktop board uses, so the two surfaces agree. Sorted `boardOrder` → scheduled date/time. |
| **Done today** | Collapsed one-line tally ("4 done today"), tap to expand. Exists for the satisfaction and for undo. |

**Row anatomy** (`.m-row`, min-height 56px):

```
●  Clean the pump                          ⟳
   Fountain · +3d over
```
- Tag-colored dot (reuse the `.task-orb` bullet colour logic).
- Title, serif, 16px, single line with ellipsis.
- Meta line only when it has something to say: parent project name · due/overdue · `+Nd over`
  for slipped rolling cadences (reuse the two-tier `.recur-overdue-badge` colour escalation).
- A small `⟳` glyph marks a recurring occurrence. No age counters on this tab.

---

## 4. Tab: Inbox

Backlog tasks, **due date asc then oldest-first** — identical order to `_reviewOrder`, so
mobile triage and desktop Inbox Review present the same sequence.

Row shows title, tag dot, `_ageLabel()` age (stale ≥7d amber, old ≥14d red, existing rules),
and `bumped N×` when `laterCount > 0`.

Empty state: a real inbox-zero moment, not a blank screen.

---

## 5. Gestures

The core interaction. One shared implementation (`_mSwipe`) used by every row on every tab.

| Gesture | On **Now** | On **Inbox** |
|---|---|---|
| Swipe **right** | Complete → `_moveItem(id,'done')`, and `_maybeSpawnRecurrence` fires exactly as it does on desktop | → This Week (`_reviewThisWeek` semantics, minus review-session bookkeeping) |
| Swipe **left** | Not today → `scheduledDate = tomorrow`, status forced to `this-week` | Later → `_sendToLater(id)` (`laterCount++`, stays backlog) |
| **Tap** | Open detail sheet | Open detail sheet |
| **Long-press** | — | Never (delete) |

Rules:
- Reveal a colored action pane under the row as it translates (sage right / amber left / red
  for delete), commit past ~35% of row width, spring back below that.
- The row animates out on commit — instant optimistic feedback, no spinner, no re-render flash.
- **Every destructive or ambiguous action shows an undo toast** (`.m-toast`, 4s, bottom above
  the tab bar, single "Undo" action). Snapshot the mutated fields before the change and
  restore via `Data.upsertTask` on undo — same pattern as `_reviewUndo`'s `snap`.
- Anchored recurring completion still needs its next-due confirm. On mobile, show it as a
  bottom sheet rather than the desktop `.rc-modal` overlay. Dismissing still accepts the
  suggestion — a series is never silently dropped.
- Respect `prefers-reduced-motion`: skip the translate animation, apply instantly.

---

## 6. Detail sheet

Evolution of the existing `_openInboxSheet` bottom sheet. Renders into `#modal-root`, cleared
with `.innerHTML = ''`, backdrop tap closes.

Contents, top to bottom: title (tap to edit inline) · quick actions row (Complete · Today ·
This Week · Later) · date picker · tag pills (`.modal-tag-pill`, reused) · notes textarea ·
parent project line (tap → jumps to that project's detail screen) · delete with inline confirm.

Recurring occurrence opened here shows its cadence as **read-only** text ("every 7 days") with
a note that it's editable on desktop. No recurrence editor on mobile.

Keep the existing intentional non-closes: scheduling doesn't close the sheet; saving notes
doesn't call `renderBoard()` (avoids stealing textarea focus).

---

## 7. Tab: Projects

**List screen** — projects grouped by tag using `_projSortedTagKeys` (so column order set on
the desktop canvas carries over). Untagged last. Each row: a status-colored dot
(`PROJ_STATUS_COLORS`, sized uniformly — no orbs, no drift, no canvas), title, and "N open"
using the same neutral open-count the canvas shows. On-hold/someday projects render dimmed,
matching the desktop opacity intent.

**Detail screen** — a full-screen push (slide in from right, back chevron in the header), not
a modal. Reuses `_projectTasks(projId)` and the `_PSPACE_GROUPS` grouping:

- Header: project title, status label, due date if set.
- Notes, collapsed to two lines with a tap-to-expand.
- Child tasks grouped by status (Inbox / This Week / Next / Doing / Done), Done collapsed by
  default. Rows are the same `.m-row` component with the same swipe actions.
- Pinned bottom quick-add: text field + an Inbox/Today destination toggle (mirrors
  `_projAddDest`). Reuses `openNewModal({parentProject, defaultStatus})`'s creation path.
- Capacities link, when `capacitiesUrl` is set, as a single "Open in Capacities" row.

No status changes, no project creation, no orb canvas.

---

## 8. Capture

FAB tap → compose sheet, keyboard up immediately.

- Single autofocused text field, 16px minimum font size (**anything smaller triggers iOS
  zoom-on-focus** — a silent, ugly friction bug).
- Tag chips below the field, tap to toggle.
- Optional "add to project" — a collapsed row that expands to a searchable project list.
- Two save affordances: **Inbox** (default, the Enter key) and **Today**.
- On save via Enter the sheet **stays open with the field cleared**, so several thoughts can
  be dumped in a row. A brief "Added" flash confirms. Swipe down or Done closes.

New tasks keep the existing creation semantics: `'t' + Date.now()` id, `status:'backlog'`,
`backlogEnteredAt` set.

---

## 9. Feel — non-negotiables

- **Tap targets ≥48px.** Nothing smaller is interactive, ever.
- **No drag-and-drop anywhere on mobile.** All reordering stays on desktop.
- **All inputs ≥16px font-size** (iOS zoom).
- **Safe-area insets** on the tab bar and FAB.
- **Optimistic + instant.** Never block a UI change on a network round-trip; `Data.*` is
  already optimistic — don't add awaits in front of it.
- **Separation by whitespace, not rules.** Very few borders; the analog-planner aesthetic
  reads as calm space on a small screen, not as boxes.
- Tokens only — `var(--paper)`, `var(--ink)`, `var(--amber)`, `var(--sage)`. **No hardcoded
  hex** (`PROJ_STATUS_COLORS` is the existing sanctioned exception).
- 300ms is the ceiling for any transition. Most should be 120–160ms.

---

## 10. Phasing

Each phase ends in a working, shippable state. Verify desktop is unchanged after every one.

1. **Shell** — `#mobile-app`, tab bar, header, render-path branch. Now tab, read-only rows.
   Old mobile layer deleted.
2. **Gestures** — `_mSwipe`, action panes, undo toast. Complete/defer working on Now.
3. **Inbox tab** — list, swipe triage, long-press Never, badge count, inbox-zero state.
4. **Detail sheet** — refactor of `_openInboxSheet`; anchored-recurrence confirm sheet.
5. **Projects** — list screen, detail push screen, quick-add.
6. **Capture** — FAB compose sheet, rapid multi-capture, project picker.
7. **Polish** — safe areas, reduced-motion, real-device pass on iOS Safari + installed PWA.

**Verification each phase:** load at ≥1024px and confirm the board, Projects canvas, Week
view, Focus orb, and Inbox Review are byte-for-byte unchanged; then 390×844 for the mobile
pass. The PWA service worker is network-first (`gf-shell-v3`), so deploys appear on the next
online refresh — no cache-busting dance needed.

---

## 11. Open questions

- Should the Now tab surface **blocked** tasks differently, or hide them? (Desktop shows a
  badge; on mobile they may just be noise.)
- Is a **search** field worth exposing on mobile? `searchQuery` is already scaffolded in
  `app.js` with no UI anywhere — mobile might be where it earns its place.
- Pull-to-refresh: needed, or does optimistic state make it pointless on a single-user app?
