# Grind & Flow — Redesign Brief

Read CLAUDE.md and DESIGN.md before doing anything. This brief describes a phased visual and structural redesign. Do not touch any data model, Supabase schema, or module boundaries unless explicitly instructed in a phase. UI changes only unless noted.

**Mobile: do not touch mobile in this first pass. Focus exclusively on desktop. Mobile will be revisited once the desktop design feels right.**

The attached images are the design inspiration. Key themes: soft radial gradient orbs as ambient state indicators, spatial organization over rigid lists, breathing room and negative space, warm/cool color as emotional signal (warm = grind/work, cool = flow/rest/break).

---

## North Star: Four Modes

The app has four distinct modes, each with its own visual personality:

1. **Planning** — task columns (This Week, Next, Inbox)
2. **Focus** — immersive breathing orb with timer
3. **Projects** — spatial floating canvas
4. **Calendar** — week view as planning surface

---

## Phase 1 — Focus Mode Orb (start here)

This is the highest-impact, most self-contained change. The current doing/timer strip gets replaced with an immersive focus experience.

**When a task enters the Doing state** (via drag or tap-to-start on a card), the UI morphs into Focus Mode:
- The page animates — current board content fades/recedes, a large soft radial gradient orb expands from the center of the screen
- The orb fills most of the viewport. It is not a circle with a hard edge — it is a soft glowing ambient shape, like the diptych prints in the reference images
- **Work state**: warm amber/orange tones (close to `--amber` in the design system)
- **Break state**: cool blue tones (a new color, approximately `#6b8cba` or similar — pick what looks right against `--paper`)
- The orb **breathes** — a slow, subtle CSS animation that gently pulses scale and opacity (inhale ~4s, exhale ~4s). Not distracting, just alive
- Task title appears above or centered in the orb in the existing display font (Bricolage Grotesque), large
- Timer display lives inside the orb — minimal, just the time remaining
- Controls (pause, skip segment, back to board) are minimal and appear at the bottom, low contrast, so they don't compete with the orb
- Color transitions smoothly when switching between work and break segments

**Exiting Focus Mode**: a subtle back gesture or button returns to the board with a reverse morph animation. Exiting returns the task to the Next column.

**Picture-in-Picture stretch goal** (do after the orb itself works): Implement the Document Picture-in-Picture API so the orb can float above other windows while the user works elsewhere. This is supported in Chrome-based PWAs. The PiP window should show just the orb with the breathing animation, and when the timer segment ends it should notify the user and let them advance to the next segment. Wire it to an optional "float" button in the focus UI.

---

## Phase 2 — Task Column Restructure

Refine the planning surface. The internal data model (`backlog`, `this-week`, `next`, `done` status strings) does not change — only labels, layout, and column behavior.

**Column changes:**
- **This Week** — stays as-is, primary weekly plan column
- **Next** — stays as-is, front-of-mind queue (shorter, curated). Do not rename to "Today" — the name "Next" is intentional so incomplete tasks don't feel like failures
- **Inbox** — becomes a *separate triage space* rather than a peer column. It should feel like a room you enter, not a column you scroll past. Consider a visual treatment that separates it from This Week and Next — perhaps a subtle divider, different background tone, or collapsed-by-default behavior with an "Open Inbox" trigger
- **Done** — keep as-is, feel-good column, no changes needed

**Inbox triage UX:**
- Each inbox item should have fast triage actions without opening a full modal: "This Week" and "Later" (Later = stays in inbox/backlog until next review), plus delete
- These could be swipe actions on mobile or hover-revealed buttons on desktop
- The goal: inbox can be emptied in a focused 5-minute session

---

## Phase 3 — Projects Spatial Canvas

Replace the current projects Kanban columns with a spatial floating canvas.

**Visual logic:**
- Each project is a soft rounded orb/blob shape floating on a canvas with a subtle grid (see reference image — colored circles on grid)
- **Size** maps to project state: Active = largest, Up Next = medium, Someday = smaller, On Hold = smallest and most faded
- **Color** maps to the project's tag. Projects with no tag get a neutral color
- Orbs float loosely — not rigidly snapped to a grid, but with the grid visible as a subtle reference
- Clicking/tapping an orb opens a new project space
- A legend or filter remains accessible for tag/state filtering

---

## Phase 4 — Calendar Week View

Add a fourth mode: a week view that serves as the primary planning surface for a weekly review ritual (e.g. Tuesday morning: drag tasks from inbox onto days across the next 7 days).

**Layout:**
- 7 columns, one per day, current week visible by default with prev/next week navigation
- Tasks with a `scheduledDate` appear on their day as small cards
- An inbox/unscheduled sidebar (right or bottom) shows tasks without a scheduled date — if a task has a due date, that should be visible somehow in the sidebar
- Dragging a task onto a day sets its `scheduledDate` and moves it to `this-week` status if that date falls within the current week and the task was in backlog
- No auto-promotion to Next column based on date — that remains a manual action for now (automate later if the Tuesday habit sticks)
- Keep the visual language consistent with Planning mode — paper ground, ink type, minimal chrome

---

## Phasing Notes

Build in order: Phase 1 → 2 → 3 → 4. Each phase should be shippable independently.

Before starting Phase 1, propose the orb animation approach and color values for approval. The breathing animation and the warm/cool palette are the emotional core of this redesign — get that right before building around it.

Do not refactor unrelated code during any phase. Targeted edits only per CLAUDE.md conventions.
