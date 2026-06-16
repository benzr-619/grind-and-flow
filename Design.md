# DESIGN SYSTEM SPECIFICATION: GRIND & FLOW

This design system document functions as an explicit instruction guide to implement the UI/UX architecture of **Grind & Flow**. It is derived directly from the extracted design token matrices and element metrics across the application's artboards.

> **Token source of truth:** the *live* palette/spacing/radius values are the CSS custom properties in `style.css :root` (e.g. `--paper: #F8F5F0`). Where the archetype hexes in §1 below differ, the `:root` values win — §1 is conceptual reference, not the authority.

---

## 0. REDESIGN DIRECTION — NORTH STAR (current, 2026)

The app is being rebuilt (see `REDESIGN-BRIEF.md`) around **four distinct modes, each with its own visual personality.** Build order: Focus → Planning → Projects → Calendar.

1. **Planning** — the task board. Columns are **This Week / Next / Done**. **Inbox is no longer a column** — it's a deliberate *review activity* (see Inbox Review). Capture into Inbox still happens via "+ New Task".
2. **Focus** — an immersive full-screen **breathing orb** + timer (shipped).
3. **Projects** — a spatial floating canvas (planned; not built).
4. **Calendar** — a week-view planning surface for the weekly review ritual (planned; not built).

### 0.1 The core aesthetic axis — **Flow vs Grind**

The two halves of the product name are two distinct visual languages. **Do not mix them.**

* **FLOW = calm / soft.** This is the **Focus** experience *only*. Soft radial-gradient **orbs** with blurred, imperfect (organically morphing) edges; a slow ~8s breathing animation; warm-amber (work) ↔ cool-blue (break) with a slow 1.6s colour crossfade. Dreamy, ambient, low-contrast chrome.
  * **Soft orbs/auras/blur are reserved exclusively for Focus Mode.** Do not reuse the orb language anywhere else — it dilutes the one calm moment in the app.
* **GRIND = firm / structured.** Everything about *processing, triage, planning, organizing*. **Firm flat shapes** — solid circles, connected spines/nodes on a subtle grid — in a **vivid flat palette** (coral, green, blue, pink, yellow, charcoal). No blur, no soft glow. Deliberate, tactile, structured. The **Inbox Review wheel** is the canonical Grind surface.

### 0.2 Immersive activity overlays

Deliberate, single-purpose activities **take over the full screen** as fixed overlays (`position: fixed; inset: 0; z-index: 200`) rather than living inline on the board: you *enter* the activity, do it, and *leave*. Both shipped overlays use the **paper ground + ink type + minimal chrome** language and fade in via an `.active` class. Desktop-only — hidden at ≤640px (mobile keeps its own simpler flows).
* `#focus-zone` — Focus Mode orb. See `.claude/rules/focus-mode.md`.
* `#inbox-review` — Inbox Review wheel. See `.claude/rules/inbox-review.md`.

### 0.3 New palettes introduced by the redesign

* **Focus orb (Flow):** `--focus-amber-core/mid/edge` (work, anchored to the `--amber` family) and `--focus-blue-core/mid/edge` (break, a cool blue not otherwise in the palette), plus `--focus-break-paper` (overlay tint on break). Radial gradients fading to transparent; never hard-edged.
* **Inbox Review (Grind):** a **vivid, display-only** palette mapped from each task's tag — work→coral `#E85D3A`, school→green `#6FB08C`, personal→blue `#5E9BD4`, custom slots→violet/pink/coral/yellow/green; untagged→charcoal `#2A2A28`. These are **brighter than the muted card tag colours on purpose** and live only in the review (`REVIEW_COLORS` in `app.js`) — they do **not** replace the muted board palette.

### 0.4 What's superseded

§4.4 (Timer Bar & Control Strip) and parts of §4.5 below describe the **pre-redesign inline timer strip**, which has been **replaced by the Focus orb** (`_renderTimerTrack()` is now a no-op). They're retained for historical context only. The Calm/Pushy boundary framework (§4.5) survives conceptually — it now renders inside the orb meta, not a banner.

---

## 1. COLOR PALETTE (TOKEN SYSTEM)

The interface follows a tactile, minimalist "analog paper meets dark steel" aesthetic with structured accent highlights for focus states, time-blocks, and contextual flags.

### 1.1 Core Palette Archetypes
* **Paper (Background)**: `#ece2cd` (or `rgb(236, 226, 205)`)
    * *Usage*: Global application background, viewport containers, and workspace artboards.
* **Card Background**: `#fbf7ec` (or `rgb(251, 247, 236)`)
    * *Usage*: Project cards, active workspace panels, modal surfaces, and interactive containers.
* **Ink (Primary Typography/Icons)**: `#2a2c30` (or `rgb(42, 44, 48)`)
    * *Usage*: High-contrast text, major headings, explicit labels, and main structural iconography.
* **Steel (Muted Elements/Borders)**: `#3a3d42` (or `rgb(58, 61, 66)`) / `#5a5e64`
    * *Usage*: Grid division lines, borders, helper indicators, subtext, and placeholder text.
* **Muted Label**: `#8a8d92` (or `rgb(138, 141, 146)`)
    * *Usage*: Secondary UI labels throughout the focus bar — ELAPSED, NEXT, FOCUS, REMAINING, LOOPS, + COMMIT, the `:00` colon on the clock, and the "commit to fewer things" quip. This is the canonical muted-text color; the CSS approximates it via `rgba(42,44,48,0.46)` which resolves close but is not identical.
* **Interval Inactive**: `#b8bac0` (or `rgb(184, 186, 192)`)
    * *Usage*: Inactive/upcoming interval bar segments on the timer track. Distinct from Muted Label — lighter and used only for the unfilled progress track fill.
* **Sage (Focus & Accent)**: `#7fa888` (or `rgb(127, 168, 136)`)
    * *Usage*: "Flow" status indicators, active timer progress tracks, success markers, and positive progress accents.
* **Amber (Warning / Blocked State)**: `#b76f2e` (or `rgb(183, 111, 46)`)
    * *Usage*: "Grind" focus boundaries, blocked tags, action interrupts, countdown warnings, and attention flags.
* **Red (Work tag / Tag slot 2)**: `#a83232` (pale: `#f0d4d4`)
    * *Usage*: The `work` default tag color. Also occupies slot 2 in the custom tag rotation.
* **Violet (Tag slot 0)**: `#7a5298` (pale: `#e8daf5`)
    * *Usage*: First slot in the custom tag color rotation. Not used elsewhere in the UI.
* **Dusty Rose (Tag slot 1)**: `#9c5570` (pale: `#f5dce8`)
    * *Usage*: Second slot in the custom tag color rotation. Not used elsewhere in the UI.

### Tag Color System
Tags use a five-slot color rotation: **violet → dusty rose → red → sage → teal** (slots 0–4, cycling). The three built-in tags have fixed default colors (`work` = red, `personal` = sage, `school` = teal). Any tag — including built-ins — can be manually reassigned to any slot via right-click on the pill in a modal. Manual overrides are stored in `localStorage` under `gf-tag-colors`.

### 1.2 State & Interactive Variations
* **Subtle Accent Fill**: `rgba(42, 44, 48, 0.05)` — used for inactive tag buttons, secondary list fields, and table borders.
* **Shadow System**: `rgba(0, 0, 0, 0.18)` — sharp, low-spread architectural drop shadows simulating overlapping physical card decks.

---

## 2. TYPOGRAPHY SYSTEM

Typography utilizes a distinct juxtaposition of geometric display fonts, hyper-legible terminal monospaces, and premium editorial serifs to denote visual hierarchy.

### 2.1 Font Families
* **Display Font**: `'Bricolage Grotesque'`
    * *Usage*: Major section layouts, brand headers, numeric highlights, and primary interface commands.
* **Body Font**: `'Source Serif 4'`
    * *Usage*: Main content sentences, task descriptions, continuous thought blocks, and philosophy references.
* **Label/Meta Font**: `'JetBrains Mono'` / `'IBM Plex Mono'`
    * *Usage*: System states, tags, key combination hints (e.g., `⌘K`), counter variables, and precise metadata.
* **Stylized Secondary**: `'Instrument Serif'`, `'Caveat'`, `'DM Serif Text'`
    * *Usage*: Abstract callouts, hand-drawn utility nuances, and system state transitions.

### 2.2 Sizing and Weights Scale
* **Focus Clock Timer**: `34px` — Medium (`500`) using `'Source Serif 4'` upright (not italic). Letter-spacing `-0.01em`, line-height `1`.
* **Artboard Title / Large Display Numbers**: `42px` / `36px` / `32px` — Bold (`700`) or Semi-Bold (`600`) using `'Bricolage Grotesque'`.
* **Section Subheaders**: `18px` / `16px` — Regular/Medium weights using `'Bricolage Grotesque'`.
* **Standard Content / Body**: `14px` / `12px` / `12.5px` — Regular (`400`) weight using `'Source Serif 4'`.
* **Micro Labels / Technical Badges**: `11px` / `9.5px` / `9px` / `8px` — Constant width using `'JetBrains Mono'`.

---

## 3. SPACING, LAYOUT & GRID ARCHITECTURE

The canvas adheres to an explicit modular grid system that replicates tactile physical planner columns.

### 3.1 Kanban Column & Viewport Grid Layout
* **Container Width**: Primary layout boundaries scale inside explicit column cards (e.g., standard viewport component sizing runs at a width of `820px` and a block height of `1040px`).
* **Layout Framework**: Grid columns use structured flex rows with a explicit layout width matching strict pixel boundaries to ensure seamless vertical alignment.
* **Column Division**: Standard layout utilizes fine grid dividers with `1px` or `2px` border lines styled in `Steel` or faint transparency values.
* **Column Padding**:
    * External margin bounds: `15mm` to `12mm` equivalent offsets or precise layout paddings (`16px`, `24px`).
    * Component internal padding: Cards use uniform structural paddings (`12px`, `8px`, `6px`) to separate visual labels from outer border boundaries.

---

## 4. COMPONENT STYLING & RULES

### 4.1 Project & Task Cards (`.dc-card`)
* **Background**: Solid `#fbf7ec` with crisp edge borders.
* **Borders**: `1px` solid line using `#3a3d42` or `rgba(0, 0, 0, 0.18)`.
* **Corner Radii**: Angular minimalism using small curves (`2px` border-radius or perfectly square `0px` depending on visual tier).
* **Layout Engine**: Standard stack alignment blocks with automatic content wrapping.

### 4.2 Task Tags & Status Badges
* **Active Status Tags (`● NOW`)**: Rendered in `'JetBrains Mono'` with an explicit bullet point layout. Color matched to the accent systems (`#7fa888` for clear path or `#b76f2e` for intense grinds).
* **Category Badges (`learn`, `sub`, `work`)**: Compact, lower-case labels (`9px`–`11px`) utilizing `rgba(42, 44, 48, 0.05)` or flat paper gray borders, featuring strict horizontal paddings (`6px` left/right).

### 4.3 Interactive Action Buttons (e.g., `START 5-MIN BREAK`, `+ COMMIT`)
* **Structure**: Pill or clean rect elements with high contrast ink lines.
* **Typography**: Uppercase text in `'Bricolage Grotesque'` or `'JetBrains Mono'`, tracking values slightly wider to enhance utility layout characteristics.
* **Sizing**: Medium vertical density (`padding: 8px 16px`).

### 4.4 The Timer Bar & Control Strip
* **Layout**: Displays an asymmetric linear progress timeline split into sequence loops (`WARM-UP → DEEP LOOP`).
* **Clock Display**: Rendered in `'Source Serif 4'` upright at `34px / weight 500`. The colon and seconds digits use the Muted Label color (`#8a8d92`); the hours/minutes digits use Ink (`#2a2c30`).
* **Interval Tick Labels** (`5m`, `10m`, `25m`, `50m`): `'JetBrains Mono'` at `9.5px / weight 500`. Active interval label uses Sage (`#7fa888`); inactive uses Muted Label (`#8a8d92`).
* **Interactive Markers**: Incremental loop triggers (`5m`, `↳5`, `10m`) mapped to a progress engine using Sage or Amber indicator dots.

### 4.5 Blocked / Interrupt State Flags
* **Behavior (Calm vs Pushy Framework)**:
    * *Calm State*: Prompts smooth text blocks with rounded confirmations (`✓ Focus block done. Take five — you earned it.`).
    * *Pushy State*: Amplifies interface boundaries with solid warning structures colored in Amber (`#b76f2e`) to immediately highlight action alerts, attention freezes, or overdue task limits.