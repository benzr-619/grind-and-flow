# Focus Mode — full-screen breathing orb

Redesign Phase 1 (session 2026-06-15). Replaced the old inline "doing strip + linear timer track" with an immersive full-screen orb overlay. **Timer logic was not changed** — only the rendering layer.

---

## Layout

`#focus-zone` is a **fixed full-screen overlay** (`position:fixed; inset:0; z-index:200`), hidden by default and shown only while a task has `status === 'doing'`.

Structure in `index.html`:
```
#focus-zone .focus-zone
  #focus-meta .focus-meta        ← top-left: label · tags · title · #focus-clock-time · sub  (JS-rendered)
  #doing-cards-row .orb-area     ← drop target (drag-swap); holds the orb layers
    #focus-orb-glow .orb-glow    ← persistent; class swapped work/break/paused
    .orb-wrap > #focus-orb .orb  ← persistent; class swapped work/break/paused
  #doing-section .doing-section  ← bottom controls bar
    #focus-orb-controls .orb-controls   ← buttons (JS-rendered)
```

The orb itself carries **no text**. Work/break is conveyed by orb color + the `work`/`break` word in `.fmeta-sub` under the timer.

---

## Key technique — persistent orb, swapped classes

`_renderFocusRow()` (app.js) must NOT rebuild the orb elements — that would restart the breathing animation and break the 1.6s work→break color crossfade. Instead it:
1. toggles overlay visibility (`fz.style.display='flex'` + rAF → `.active`),
2. swaps `work`/`break`/`paused` classes on the **persistent** `#focus-orb` + `#focus-orb-glow`, and toggles `break` on `#focus-zone` (paper-tint shift),
3. rebuilds only `#focus-meta` and `#focus-orb-controls` innerHTML.

`#focus-clock-time` lives inside `#focus-meta` (rebuilt each render) — `_renderClock()` finds it by id every second; fine.

---

## Stable ids preserved (CLAUDE.md DOM-stability)

- `#focus-zone`, `#doing-section`, `#focus-clock-time` — kept.
- `#doing-cards-row` — moved onto `.orb-area` (still the drop target; keeps drag-swap working via `_onDoingDrop`).

---

## State → orb mapping (in `_renderFocusRow`)

- `kind = TIMER_SEQ[timerSegIdx].kind` → `work` (amber) / `break` (blue).
- **At a boundary** `timerSegIdx` has already advanced, so the orb shows the *next* segment's color and the boundary copy renders in `.fmeta-sub` (`.fmeta-boundary.calm`/`.pushy`).
- `paused` = active && `!timerRunning` && `!timerAtBoundary` → adds `.paused` (settles breathing, dims).

## Controls (bottom)
- Normal: **Pause/Resume** (`timerTogglePlay`) · **Skip** (`skipSegment`) · **Done** (`markDoingDone`) · **Return to Next** (`removeFromDoing`).
- Boundary: primary **Start N-min break/work ›** (`startNextSegment`) · Done · Return to Next.
- `skipSegment()` (new, exposed on `App`): advances one segment and starts it.

**Exit is only via Done or Return to Next.** Pause keeps you on the focus page. There is no "minimize to board" escape.

---

## `_renderTimerTrack()` is now a no-op

The linear segment track is gone. `_renderTimerTrack()` is an empty stub so its ~9 call sites don't need editing. `_updateSegFill()` no-ops (its `.tseg.current .fill` target no longer exists). `_timerJump`/`startNextSegment` now call `_renderFocusRow()` instead of the track.

---

## Tokens (`style.css :root`)
`--focus-amber-core/mid/edge` (work, anchored to the `--amber` family), `--focus-blue-core/mid/edge` (break), `--focus-break-paper` (overlay tint on break). Keyframes: `orb-breathe` (8s scale/opacity), `orb-morph` (19s asymmetric border-radius = imperfect blob), `glow-drift` (13s). `prefers-reduced-motion` disables all three.

---

## Mobile — untouched, must stay hidden

`#focus-zone` is hidden at ≤640px via `#focus-zone { display: none !important; }`. The `!important` is required because JS sets inline `display:flex` to show the overlay on desktop, and inline beats a plain media-query rule. **Do not remove the `!important`.** Mobile orb is a later pass.
