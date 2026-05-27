# Grind & Flow — Logo Design Brief

This document captures the requirements a future logomark would need to satisfy before being introduced into the Grind & Flow UI. It is written to the design system defined in `Design.md` and should be treated as a checklist for any designer or design tool working on this mark.

---

## Why the previous logo was removed

The original `GnF Logo No Background.png` was a 3D-rendered, glossy illustration — a chrome gear with a beveled metallic finish and a ribbon-wave element. It was removed because:

- Its rendering style (gradients, depth shadows, highlights) directly contradicted the flat, crisp, minimalist aesthetic of the rest of the UI.
- Its colors (cool metallic silver, off-brand mint) were not drawn from the design token palette.
- Its visual weight competed with the typographic wordmark rather than supporting it.
- At 52×52px inside a 50px topbar, it slightly overflowed its container.

---

## Format requirements

- **File type**: SVG (inline-ready or as a standalone `.svg` file). No rasterized PNGs.
- **Viewbox**: Square, ideally `24×24` or `32×32` units for icon-size usage, with a separate `48×48` or larger artboard variant if needed for marketing contexts.
- **Background**: Transparent. No fill on the root element.
- **Rendering**: Fully flat. No gradients, no drop shadows baked into the mark, no bevels, no 3D perspective. All depth must be implied through shape alone.

---

## Color constraints

All colors used in the mark must be drawn directly from the design token palette defined in `Design.md`. The following tokens are the only acceptable values:

| Token | Hex | Permitted use |
|---|---|---|
| Ink | `#2a2c30` | Primary structural strokes, solid fills |
| Steel | `#3a3d42` | Secondary structural elements, stroke variation |
| Sage | `#7fa888` | Accent element (the "Flow" side of the mark) |
| Amber | `#b76f2e` | Optional high-emphasis accent only — use sparingly |
| Paper | `#ece2cd` | Knockout fills only (e.g. negative space on dark backgrounds) |

Do not introduce any color outside this list. The logo must look correct against both the Paper background (`#ece2cd`) and the Card background (`#fbf7ec`).

---

## Concept direction

The mark should visually encode the duality expressed by the brand name: **Grind** (structured effort, mechanical rhythm) and **Flow** (ease, movement, continuity). Some directions worth exploring:

- A geometric form (grid, tick, block) paired with a fluid or curving counterform — both drawn with the same stroke weight, implying they belong to the same system.
- A typographic ligature or monogram using the letterforms G and F (or the ampersand `&`) in Bricolage Grotesque, simplified to a mark rather than a full wordmark.
- An abstract shape that reads as both a progress indicator and a wave — something that could double as a favicon or app icon without needing the wordmark next to it.

Avoid: literal gears, literal clocks, literal checkmarks. These are overused in productivity software and undercut the app's distinctive character.

---

## Integration rules

When the mark is placed in the UI, it must conform to these constraints:

- **Topbar size**: The mark must fit cleanly within a `28–36px` square at the left edge of the topbar, which is `50px` tall with `24px` horizontal padding. It should not overflow the topbar height.
- **Gap from wordmark text**: `8px` gap between the mark and the "Grind & Flow" wordmark text (matching the existing `.wordmark` gap value).
- **Stroke weight**: If the mark uses strokes rather than fills, use `stroke-width: 1.5`–`2` at the `24px` viewbox scale, consistent with the export/import icon SVGs already in the topbar (`stroke-width: 1.8`).
- **No text inside the mark**: The mark must function independently of the wordmark text so both can be used together or the mark can be used alone (e.g. as a favicon or avatar).

---

## CSS class to reintroduce

When a new mark is ready, reintroduce the following block in `style.css` (adjust sizing as needed):

```css
.logo-img {
  width: 28px; height: 28px;
  flex-shrink: 0;
}
```

And restore the `<img>` or inline `<svg>` tag inside `.wordmark` in `index.html`, before the `.wordmark-text` span.

---

## Checklist before shipping

- [ ] Renders cleanly at 28×28px (topbar) and 512×512px (marketing/icon)
- [ ] All colors are from the token palette
- [ ] No gradients, shadows, or 3D effects
- [ ] Transparent background — tested on `#ece2cd` and `#fbf7ec`
- [ ] SVG file is clean (no Figma/Illustrator metadata bloat, no embedded rasters)
- [ ] Mark works without the wordmark text alongside it
- [ ] Stroke weight is consistent with existing UI iconography
