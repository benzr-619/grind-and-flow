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

---

## PiP float — orb detached into an always-on-top window

Session 2026-06-16. The deferred "float reach goal" is built. A **Float ↗** button in the focus controls pops the orb into a **Document Picture-in-Picture** window that floats above all other apps and follows the user across screens; **Dock orb** (or the window's native close) returns it.

### Why Document PiP (not a popup)
`window.documentPictureInPicture.requestWindow()` opens an OS-level always-on-top window that **shares this JS realm**. So the live timer (`timerInterval`/`_timerTick`/wall-clock drift) keeps running with **zero cross-window messaging** — we just physically relocate the orb DOM between documents.

### The relocation model
- `let _pipWin = null` (module scope) — the open PiP `Window`, null when docked. `const _pipSupported = 'documentPictureInPicture' in window` (Chromium only; Float button hidden otherwise).
- `_focusDoc()` → `_pipWin ? _pipWin.document : document`. **The orb nodes (`#focus-orb`/`#focus-orb-glow`) are looked up via `_focusDoc()`** in `_renderFocusRow`/`_renderClock`, because they move into the PiP doc. `#focus-meta` + `#focus-orb-controls` stay in the **main** doc (all task text/title/elapsed stays on the main screen — the float is *just the orb*).
- `openFocusPip()` (async, needs the button's user gesture): `requestWindow({width:220,height:220})`, clone all `<link rel=stylesheet>`/`<style>` into the PiP head, `body.className='pip-orb'`, **`pip.App = App`** (so inline `onclick="App.*"` in the PiP hover controls resolve against the PiP global), move `#doing-cards-row` (the `.orb-area` subtree) into a `#pip-stage` + `.pip-hover` overlay, wire `pagehide → closeFocusPip`.
- `closeFocusPip()`: null `_pipWin` first (pagehide re-entrancy guard), reinsert `#doing-cards-row` into `#focus-zone` before `#doing-section`, `pip.close()`, re-render.
- `_renderPipExtras()` rebuilds the hover overlay (`#pip-clock-time` + compact `.oc-btn` controls: Return/Pause-Resume/Skip/Done/Dock) each `_renderFocusRow` so state stays in sync. `_renderClock` writes both `#focus-clock-time` (main) and `#pip-clock-time` (PiP).
- Task end: `removeFromDoing`/`markDoingDone` → `_renderFocusRow` no-task branch calls `closeFocusPip()`.

### Boundary cue (nudge, not alarm)
At a segment boundary `_timerTick` calls `_pipBoundaryNudge()`: one `_pipWin.focus()` raise + `.boundary-nudge` on `#pip-stage` (brief stronger ring pulse for 2.6s), which then settles into `.boundary-settle` (slow soft ring) kept on while `atBoundary`. CSS rings are `#pip-stage::after` box-shadow keyframes `orb-nudge`/`orb-settle` (amber, reduced-motion-gated). Intentionally **not** a sustained alarm — the user may want to finish a thought. Chime + browser Notification remain as backup.

### Styles (`style.css`, `body.pip-orb` scope)
`body.pip-orb` is **dark** (`background:#18191b; color-scheme:dark`) to match the un-stylable title bar (see gotchas) — the window is one seamless dark surface, orb glowing on it. `.pip-stage` (fixed full-window), `.orb-wrap` shrunk to 150px, `.orb-glow` tightened to `inset:28%`. `.pip-hover` is a **light** dark scrim (`rgba(24,25,27,0.45)` + `backdrop-filter:blur(3px)`), opacity 0→1 on `.pip-stage:hover`, so the orb stays visible behind it. `.pip-clock` is paper-coloured; controls are light-on-dark via `body.pip-orb .pip-controls .oc-btn` (faint at rest, brighten on hover). **All overrides are `body.pip-orb`-scoped** because `style.css` is cloned into both docs — never recolour bare `html`/`:root` here. Reuses `--focus-*` tokens + orb gradients/keyframes via the cloned stylesheet.

### Controls (`_renderPipExtras`)
Return · Pause/Resume (+ Skip) / boundary Start · Done. **No `.primary` emphasis** (uniform, hover-only) and **no custom Dock button** — the PiP title bar's native **back-to-tab** button closes the window → `pagehide` → `closeFocusPip()` docks the orb. (The *full-screen* controls keep their `.primary` and the `Dock orb` button.)

### Constraints / gotchas
- **Chromium only** — Safari/Firefox lack Document PiP; Float button is feature-gated.
- **`requestWindow()` requires a user gesture** — so the float is manual (button), never auto-on-blur. Also means it can't be driven in automated preview.
- The OS window has an **unavoidable native title bar** — can't be recoloured, forced to light, or removed (confirmed: no CSS/`color-scheme`/`theme-color` lever works). Its black is `#18191b`; we match the window background to it for a seamless surface rather than fighting it.
