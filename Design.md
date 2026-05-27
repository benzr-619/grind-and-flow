# DESIGN SYSTEM SPECIFICATION: GRIND & FLOW

This design system document functions as an explicit instruction guide to implement the UI/UX architecture of **Grind & Flow**. It is derived directly from the extracted design token matrices and element metrics across the application's artboards.

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
* **Steel (Muted Elements/Borders)**: `#3a3d42` (or `rgb(58, 61, 66)`) / `#5a5e64` / `#8a8d92`
    * *Usage*: Grid division lines, borders, helper indicators, subtext, meta-labels, and placeholder text.
* **Sage (Focus & Accent)**: `#7fa888` (or `rgb(127, 168, 136)`)
    * *Usage*: "Flow" status indicators, active timer progress tracks, success markers, and positive progress accents.
* **Amber (Warning / Blocked State)**: `#b76f2e` (or `rgb(183, 111, 46)`)
    * *Usage*: "Grind" focus boundaries, blocked tags, action interrupts, countdown warnings, and attention flags.

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
* **Artboard Title / Large Numerical Timer**: `42px` / `36px` / `32px` — Bold (`700`) or Semi-Bold (`600`) using `'Bricolage Grotesque'` or `'Source Serif 4'`.
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
* **Time Labels**: Rendered in `'Source Serif 4 Italic'` or `'JetBrains Mono'`.
* **Interactive Markers**: Incremental loop triggers (`5m`, `↳5`, `10m`) mapped to a progress engine using Sage or Amber indicator dots.

### 4.5 Blocked / Interrupt State Flags
* **Behavior (Calm vs Pushy Framework)**:
    * *Calm State*: Prompts smooth text blocks with rounded confirmations (`✓ Focus block done. Take five — you earned it.`).
    * *Pushy State*: Amplifies interface boundaries with solid warning structures colored in Amber (`#b76f2e`) to immediately highlight action alerts, attention freezes, or overdue task limits.