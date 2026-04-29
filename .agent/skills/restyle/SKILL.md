---
name: restyle
description: Use when changing visual style of an EXISTING design (keep content+structure). 换风格/改成/整成/做成X那种; restyle/redesign/make it Y. Inspect→edit, don't rebuild.
---

## RESTYLE — Change Visual Tokens, Not Content

The design already exists on the canvas. The user names a new aesthetic, mood, theme, or vibe. Content (text strings, icon names, hierarchy) and structure (nesting, layout direction, sections) stay the same. **Do not rebuild with `jsx` — read the existing tree and edit visual properties in place.**

### Anti-pattern (what NOT to do)

Rebuilding the whole design with a fresh `jsx` call wastes 60%+ tokens re-emitting unchanged content (text strings, icon names, structure), and detaches from the user's mental model of "the same design, new look."

### Phase 1 — Read the existing tree (1 call)

```
inspect({node: "<root_id>", facets: ["all"], depth: -1})
```

Use `depth: -1` for the full subtree. `facets: ["all"]` returns layout + paint + text + effects + structure in one read. If the root id isn't in idMap, `find_nodes` first.

### Phase 2 — Classify each node by layer

Walk the inspected tree and label every node along three axes:

| Layer | Properties | Action |
|---|---|---|
| **Visual** | `fill`, `stroke`, `effects` (shadow/blur/bgblur), `cornerRadius`, font `size`/`weight`/`fill` | **Change** to match new aesthetic |
| **Content** | text `characters`, icon names, image refs | **Preserve** |
| **Structure** | parent/child nesting, `layoutMode`, sibling order | **Preserve** |

If the new aesthetic genuinely needs new structure (e.g. moving a sidebar to top), do that in a separate phase — but most restyles are visual-only.

### Phase 3 — Batch edit visual props

One or two `edit({nodes: [...]})` calls cover the whole page. Group nodes by visual role (background / surface / text / accent / divider) and apply the new token to each group.

```
edit({nodes: [
  {node: "1:1",  props: {bg: "<new_bg>", effects: [bgblur(20), shadow(0,8,32,0,'#0006')]}},
  {node: "1:5",  props: {fill: "<new_card_fill>", rounded: 16, stroke: "1 <new_border>"}},
  {node: "1:12", props: {fill: "<new_text_color>"}},
  ...
]})
```

For values, use jsx attribute shorthand syntax (the same syntax `jsx` accepts):
- Color: `'#RRGGBB'`, `'#RRGGBBAA'`, or `'linear-gradient(135deg, #A 0%, #B 100%)'`
- Shadow: `shadow(offsetX, offsetY, blur, spread, color)` or string `'0,8,32,0,#0006'`
- Blur: `bgblur(radius)` for frosted-glass / glassmorphism background blur; `blur(radius)` for layer blur
- Border: `'1 #E5E7EB'` (width + color)
- Corner: number (px) or `'full'`

### Phase 4 — Add decoration only if the new aesthetic needs it

Some aesthetics demand extra layers (gradient backgrounds, orbs, blobs, dotted overlays, geometric shapes, etc.).

**Two correct patterns**:

1. **Full-frame gradient/solid background**: set the existing root frame's `bg` directly (one `edit` call). Do **not** create a separate `<rect>` background layer.

2. **Floating decorative shapes inside auto-layout**: add as siblings under the root with `layoutPositioning: 'ABSOLUTE'` so they don't get captured by the parent's `column`/`row` flow.

```
jsx({parent: "<root_id>", markup: "<ellipse name='Orb' layoutPositioning='absolute' x={150} y={-50} w={300} h={300} fill='#8B5CF6' opacity={0.15} />"})
```

Decorative siblings in an auto-layout container without `layoutPositioning='ABSOLUTE'` will be stacked into the main axis — typical symptom: orbs end up at `y=844` (below the visible area) instead of overlapping the content.

### Phase 5 — Verification (1 call)

```
get_screenshot({node: "<root_id>"})
```

Before sending the final text response, walk through the user's stated style keywords (every adjective, every named effect, every named color family) and reconcile against what the canvas now shows. Name any gap explicitly — don't claim a feature exists if you didn't add it.

### KNOWN PITFALLS

| Wrong | Right | Why |
|---|---|---|
| Rebuild full design with new `jsx` | `inspect` existing → batch `edit` | 60% of the markup is content/structure that didn't change |
| `node.opacity = 0.08` for translucent surface | `fill: '#FFFFFFXX'` (alpha in fill hex) | Node-level opacity also fades all children; alpha-in-fill keeps children opaque |
| `<rect bg='gradient'>` as full-frame backdrop | Set parent frame's `bg` directly | Two-layer backdrop is fragile; one frame.bg is the canonical Figma pattern |
| Decorative orbs/blobs as plain children | `layoutPositioning: 'ABSOLUTE'` siblings | Auto-layout captures all children into main-axis flow by default |
| Glassmorphism without blur | `effects: [bgblur(15-25)]` on every glass surface | Translucency alone is not "frosted glass" — blur is the defining feature |
| Use `js` to read/write properties one at a time | `inspect` (read) + `edit` (write batch) | `js` bypasses idMap, shorthand, batched validation |

### Call budget

A typical full-page restyle: 1 inspect + 1–2 edit + (0–1 jsx for decoration) + 1 get_screenshot = **3–5 tool calls total**. If you exceed 8, stop and reconsider whether you're actually rebuilding instead of restyling.
