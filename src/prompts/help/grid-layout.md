---
id: help:grid-layout
name: Grid Layout (layout="grid")
description: Use when laying out children in a fixed rows×columns matrix — galleries, dashboards, card decks, pricing tables, icon grids.
category: help
tags: [grid, layout, gallery, dashboard, cards, pricing, matrix]
---

## WHEN TO USE GRID

Use `layout="grid"` when children fit a fixed **rows × columns** matrix where every cell has the same structural role.

- **Galleries** (photo 3×3, product cards 4×N)
- **Dashboards** (KPI card grid, metric tiles)
- **Pricing tables** (3–4 tiers side by side with equal cells)
- **Icon grids** (emoji picker, app launcher)

Use flex (`layout="row"` / `layout="column"`) when:
- Children have **different widths** (label + control, icon + text + action)
- Space-between / start / end alignment matters
- One dimension, not two

## REQUIRED PROPS

A grid container MUST declare:

```jsx
<frame layout="grid" cols={3} rows={2} gap={16}>
  ... 6 children, filling cells left-to-right, top-to-bottom ...
</frame>
```

- `cols` → `gridColumnCount` (integer ≥ 1)
- `rows` → `gridRowCount` (integer ≥ 1)
- `gap` → both `gridRowGap` + `gridColumnGap` (or use `rowGap` + `colGap` separately)

`cols × rows` must equal (or exceed) the number of children. Empty cells are allowed; overflow throws.

## CONTAINER SIZING

Grid containers default to FIXED (400×300). **Do not use `w="hug"` or `h="hug"`** on a grid — FLEX tracks + HUG container conflict and Figma rejects the combination.

- Use explicit pixels: `w={600} h={400}`
- Or FILL when nested in a flex parent: `w="fill"`

## CHILD PLACEMENT

Children are auto-placed in **insertion order** — first child → row 0, col 0; second → row 0, col 1; etc., wrapping when a row fills.

### Child overrides (optional)

- `rowSpan={2}` → `gridRowSpan` (node occupies 2 rows)
- `colSpan={2}` → `gridColumnSpan` (node occupies 2 columns)
- `alignX="center"` → `gridChildHorizontalAlign` (MIN | CENTER | MAX | AUTO)
- `alignY="center"` → `gridChildVerticalAlign` (MIN | CENTER | MAX | AUTO)

```jsx
<frame layout="grid" cols={3} rows={3} gap={12} w={600} h={600}>
  <frame name="Hero" colSpan={2} rowSpan={2} bg="#F0F0F0"/>
  <frame name="Card1" bg="#FFF"/>
  <frame name="Card2" bg="#FFF"/>
  <frame name="Card3" bg="#FFF" alignX="center" alignY="center"/>
</frame>
```

## COMMON PITFALLS

1. **Grid container HUG** — invalid with default FLEX tracks. Always give grid a FIXED or FILL size.
2. **cols × rows < children** — Figma throws. Count before generating.
3. **Flex alignment on grid** — `justify` / `align` on a grid container have no effect. Use per-child `alignX` / `alignY` instead.
4. **Grid inside a small HUG parent** — the grid's fixed size forces parent overflow. Either set the parent to a known size or wrap the grid in a fill container.
5. **1-column "grid"** — don't. Use `layout="column"` for vertical stacks; grid overhead isn't justified.
