# Grind & Flow — Tasks Board Visual Redesign

## Before touching anything

Read `CLAUDE.md`, `DESIGN.md`, `style.css`, `app.js`, and `index.html` in full before making any changes. Understand the current CSS variable names, render function structure, and DOM patterns. Do not assume — verify.

---

## What this prompt covers

- `style.css` — color token updates, card styles, tag styles, doing zone, timer track, topbar, hover states
- `app.js` — render function changes: doing zone markup, timer track markup, column headers, card anatomy, blocked card treatment
- `index.html` — any static structural changes needed

## What this prompt does NOT cover

Do not touch any of the following:

- All JavaScript logic: drag-and-drop, timer sequence, auto-archive, data operations, filter logic
- `data.js` and `auth.js` — untouched entirely
- Modal / detail view content or layout
- Auth overlay
- Mobile capture bar (`#mobile-capture-bar`), segmented toggle (`#mobile-seg-bar`), bottom sheet layout — the CSS token changes will carry through automatically; verify they render correctly but do not restructure them
- Project card render functions (separate pass)
- PWA manifest
- Supabase queries

---

## Design intent

The app currently feels like craft paper — warm beige everywhere, heavy card borders, lots of text labels explaining things the user already knows. The redesign moves to **fine paper**: the warmth stays but becomes lighter and more refined. White cards float on a warm off-white ground. Color is reserved for tags and the active timer state only — it is not used for decoration, nav chrome, or state indicators that don't need it. The app should recede and surface signal.

---

## 1. Color tokens (style.css)

Identify the existing CSS custom property names for each of the following roles and update their values. If a variable doesn't exist for a role listed below, create it.

| Role | New value |
|---|---|
| Page / board background | `#F8F5F0` |
| Card background | `#FFFFFF` |
| Card / panel border | `#E3DDD4` |
| Primary text (headings, card titles) | `#1C1917` |
| Secondary / muted text (column counts, dates, hints) | `#C4BEB4` |
| Faint text (empty states, `+ add`) | `#D5CFC6` |
| Timer active segment + pause button background | `#2B6E4E` |
| Pause button icon color | `#CDEEDD` |
| Topbar background | `#F8F5F0` |
| Age counter — normal | `#D5CFC6` |
| Age counter — stale (≥7 days) | `#C98B2A` |
| Age counter — old (≥14 days) | `#A03028` |

### Tag pill colors

Update tag color values for each built-in tag:

| Tag | Background | Text |
|---|---|---|
| school | `#E6F3EC` | `#2B6E4E` |
| work | `#FCEBE8` | `#8B3A34` |
| personal | `#EEE9E0` | `#7A7368` |
| research | `#EEF0F5` | `#7A7E8A` |
| blocked pill | `#FDF0E0` | `#9B6E1F` |

---

## 2. Global card styles (style.css)

Apply these to the shared `.card` / `.proj-card` base class (or equivalent):

- `background: #FFFFFF`
- `border: 0.5px solid #E3DDD4`
- `border-radius: 7px`
- `padding: 9px 11px`
- `margin-bottom: 5px`

**Remove** any colored left-border rules currently applied to cards based on tag color. No card should have a colored left border in the new design — not regular cards, not blocked cards.

### Tag pills

- `font-size: 9px`
- `padding: 2px 7px`
- `border-radius: 3px`
- `letter-spacing: 0.2px`
- No border — background fill only

### Card title

- `font-size: 11.5px`
- `color: #1C1917`
- `line-height: 1.3`

### Card meta row (tags + age counter)

- `display: flex`
- `align-items: center`
- `gap: 5px`
- `margin-top: 5px`
- Age counter: `margin-left: auto` so it always sits right-aligned

---

## 3. Blocked card treatment (app.js + style.css)

**Remove all special blocked card styling.** Blocked cards must be visually identical in size and layout to any other card. Do not apply a border-left, background tint, or any extra wrapper.

The only blocked indicator is the `blocked` tag pill rendered in the card's meta row alongside other tags — same size, same position, just the amber pill color from the token table above.

Remove any render logic that adds the reason text line to blocked cards in the board view. The reason remains accessible in the detail modal — do not remove it there.

---

## 4. Topbar (index.html + style.css)

```
[Logo]  [Tasks] [Projects] [Archive]        [↓] [↑] [|] [+ New Task]
```

- Height: `42px`
- Background: `#F8F5F0`
- Border-bottom: `0.5px solid #E3DDD4`
- Logo: `13px`, `font-weight: 500`, `#1C1917`, `letter-spacing: -0.3px`
- Nav items: `11px`
  - Inactive: `#C4BEB4`
  - Active: `#1C1917`, with `border-bottom: 1.5px solid #1C1917` and `padding-bottom: 3px`
  - **No color accent on the active underline — it matches the text color exactly**
- Export / import icons: `15px`, color `#C4BEB4`
- Thin vertical divider between icons and button: `1px` wide, `14px` tall, `#E3DDD4`
- `+ New Task` button: `10px`, `padding: 4px 12px`, `border-radius: 4px`, `background: #1C1917`, `color: #F8F5F0`, `letter-spacing: 0.2px`

---

## 5. Doing zone (app.js + style.css)

### Remove entirely

- The `FOCUS` label
- The `REMAINING` label
- The `ELAPSED` label
- The `LOOPS` text
- The loop / refresh icon

### Timer display

Show only the countdown number and a minimal elapsed indicator below it:

```
04:53        ← countdown, 28px, font-weight 500, #1C1917, letter-spacing -1.5px, tabular-nums
0m in        ← elapsed, 10px, #C4BEB4, centered below the number, no label
```

### Navigation flanks (← Next / Done →)

Both flanks must be **invisible by default** (`opacity: 0`) and appear on hover of the doing zone container (`opacity: 1`, transition `opacity 0.15s ease`).

Each flank contains:
- A directional arrow icon
- A tiny label below it (`next` / `done`, 8px, `#B0A99F`, letter-spacing 0.6px, uppercase)

Separate each flank from the task area with a `0.5px solid #F0EBE3` vertical divider.

### Doing zone layout (left → right)

```
[← flank] | [pause btn] [tag(s) + task title] [timer + elapsed] | [→ flank]
```

- Pause button: `32×32px`, `background: #2B6E4E`, `border-radius: 6px`
- Pause icon: `13px`, `color: #CDEEDD`
- Zone background: `#FFFFFF`
- Zone border-bottom: `0.5px solid #E3DDD4`
- Zone padding: `10px 20px`

---

## 6. Timer track (app.js + style.css)

### Structure

Replace any dot / bullet separators between segments with **CSS gap** on a flex container. The segments themselves provide the visual rhythm — nothing else is needed between them.

```
[▬ active] [   gap   ] [▬▬▬▬▬▬] [   gap   ] [▬▬▬▬▬▬▬▬▬▬▬] [   gap   ] [▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬]
```

- Container: `display: flex`, `align-items: center`, `gap: 6px`, `height: 26px`, `padding: 0 20px`, `background: #F8F5F0`, `border-bottom: 0.5px solid #E3DDD4`
- Each segment: `height: 3px`, `border-radius: 2px`, `cursor: pointer`
- Active segment: `background: #2B6E4E`
- Inactive segments: `background: #E3DDD4`
- **Nothing at the end of the track** — no icon, no text, no element

Segment widths should remain proportional to their duration as they are today. Do not change the segment click / jump logic.

---

## 7. Board header (app.js + style.css)

```
friday · jun 12        ← 9px, #C4BEB4, letter-spacing 0.8px, uppercase, margin-bottom 4px

Tasks                  [Filters]
```

- Date: rendered as currently is, just restyled
- `Tasks` heading: `26px`, `font-weight: 500`, `#1C1917`, `letter-spacing: -0.8px`
- `Filters` button: `10px`, `#C4BEB4`, `border: 0.5px solid #E3DDD4`, `padding: 3px 10px`, `border-radius: 4px`
- Board background: `#F8F5F0`

---

## 8. Column headers (app.js)

**Remove the hint text lines entirely** (`move or leave`, `committed`, `lined up`, `today`, and any equivalent strings rendered below column headers).

Each column header is one line only:

```
INBOX                                     07
```

- Label: `9px`, `letter-spacing: 1.8px`, `text-transform: uppercase`, `color: #1C1917`, `font-weight: 500`
- Count: `9px`, `color: #C4BEB4`
- Label left, count right (`display: flex; justify-content: space-between`)
- `margin-bottom: 10px`

---

## 9. "start →" on Next column cards (app.js + style.css)

Render `start →` as a right-aligned line at the bottom of each card in the Next column. It must be **invisible by default** (`opacity: 0`) and appear on card hover (`opacity: 1`, transition `0.15s ease`).

- `font-size: 10px`
- `color: #C4BEB4`
- `text-align: right`
- `margin-top: 5px`
- Do not render it on cards in any other column

---

## 10. `+ add` rows

- `font-size: 10px`
- `color: #D5CFC6`
- `padding: 6px 2px`
- Hover: `color: #B0A99F`

---

## 11. Mobile verification

After completing all changes, open the app at `≤640px` viewport width and verify:

- The capture bar and segmented toggle still sit at their correct sticky offsets (`top: 50px` and `top: 107px`)
- Inbox and Today rows pick up the new card styles (white bg, warm border, updated tag colors)
- The bottom sheet renders correctly against the new palette
- No new layout regressions

Do not restructure any mobile-specific components — just confirm the token cascade looks correct.

---

## 12. Verification checklist

Before marking complete:

- [ ] No card anywhere has a colored left border
- [ ] Blocked cards are visually identical in size to non-blocked cards
- [ ] No label text appears in the doing zone except `Xm in` below the timer
- [ ] No text or icon appears after the last timer segment
- [ ] Column hint lines are gone from all four task columns
- [ ] Nav active underline is `#1C1917`, not a color accent
- [ ] Hover states work: flanks appear on doing zone hover, `start →` appears on Next card hover
- [ ] Age counter color shifts at 7 days (amber) and 14 days (red) still function
- [ ] Mobile view has no layout regressions
