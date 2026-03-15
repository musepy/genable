---
id: component-set
name: Component Set Creation
description: Efficiently create Figma ComponentSets with variant matrices using clone cascading
category: figma
priority: 3
injectionType: dynamic
tools:
  - design
  - replace
triggerPatterns:
  - component set
  - variant
  - design system
  - button component
  - icon button
  - 组件集
  - 变体
  - 设计系统
enabledByDefault: true
---

## COMPONENT SET — Variant Matrix Creation

When creating a ComponentSet (multiple variants of one component), follow this workflow. It minimizes tool calls and avoids known pitfalls.

### Phase 1: Inspect Target (2 calls max)

Do NOT inspect every variant individually. Instead:

1. **Structure**: `outline(nodeId)` — get variant names, dimensions, child structure
2. **Colors**: `replace(mode:'search', rootId, properties:['fillColor','strokeColor'])` — get ALL unique colors in one call
3. **Detail**: inspect only **1 representative per Variant dimension** (e.g., Primary+Default+Medium) — infer other states from the color palette

### Phase 2: Identify Variant Dimensions

ComponentSets are Cartesian products. Decompose variant names into dimensions:

```
"Variant=Primary, State=Default, Size=Medium"
→ Dimensions: Variant(Primary|Neutral|Subtle) × State(Default|Hover|Disabled) × Size(Medium|Small)
→ Total: 3 × 3 × 2 = 18 variants
```

Find **identical style groups** to minimize clone overrides:
- All Disabled variants often share the same fill/stroke/text colors
- Hover variants often only change 1 prop from Default

### Phase 3: Create with Clone Cascading

**Step 1 — Base component** (1 frame + 1 child):
```
base = frame(root, {name:'Variant=Primary, State=Default, Size=Medium', reusable:true, layout:'row', gap:8, corner:8, sizingH:'hug', sizingV:'hug', alignMain:'center', alignCross:'center', overflow:'hidden', p:12, fill:'#2C2C2C', stroke:'#2C2C2C', strokeW:1})
lbl = text(base, {name:'Button', size:16, font:'Inter', leading:16, fill:'#F5F5F5'}, 'Button')
```

**Step 2 — Clone cascade** (group by similarity):
```
// Hover only changes fill → clone from Default
hover = clone(base, root, {name:'Variant=Primary, State=Hover, Size=Medium', fill:'#1E1E1E'})

// Disabled has unique style → clone from base with 3 overrides
disabled = clone(base, root, {name:'...Disabled...', fill:'#D9D9D9', stroke:'#B3B3B3', Button.fill:'#B3B3B3'})

// All Disabled look identical → cascade clone from first Disabled (0 overrides)
neutralDisabled = clone(disabled, root, {name:'...Neutral...Disabled...'})

// Size only changes padding → clone from corresponding style variant
small = clone(base, root, {name:'...Small', p:8})
```

**Step 3 — Combine into ComponentSet**:
```
btnSet = variantSet(root, {name:'Button', from:'id1,id2,...,id18'})
update(btnSet, {layoutWrap:'WRAP', counterAxisSpacing:40, p:20, sizingV:'hug'})
```

Use **real Figma IDs** (from idMap) in `from:`, not symbols — cross-batch symbol resolution is unreliable.

### Phase 4: Verify (1 call)

Take a screenshot of the ComponentSet and compare dimensions with target.

### Batching Strategy

- All variants of one ComponentSet CAN fit in 1 batch if ≤20 ops
- Within same batch, symbol references work (e.g., clone from `base` symbol)
- Across batches, use real IDs from previous batch's `idMap`
- Button (18 variants): 1 frame + 1 text + 17 clones = 19 ops → fits in 1 batch

### KNOWN PITFALLS

#### Text nodes

| Wrong | Right | Why |
|-------|-------|-----|
| `leading:100` | `leading:16` | `leading` is pixels, not %. 100 = 100px line height |
| `text(p, {sizingH:'hug', sizingV:'hug'})` | `text(p, {})` (omit sizing) | Setting sizing on text blocks `textAutoResize` auto-fill |
| `text(p, {leading:'100%'})` | `leading:16` (for 16px font) | String percentages not supported |

#### Icon nodes

The `icon()` type creates `frame(name) > vector('Vector')`. Clone overrides on icon frames **auto-propagate fills/strokes to vector children** (same as icon creation). Use the icon node's name directly — no need to target the internal `Vector` node.

```
// Create icon with a name
myIcon = icon(base, {name:'MyIcon', icon:'lucide:star', w:20, h:20, stroke:'#F5F5F5'})

// Clone override — use the icon's name
variant = clone(base, root, {name:'...', MyIcon.stroke:'#1E1E1E'})
```

| Icon library | Color prop | Example |
|-------------|-----------|---------|
| Lucide / Tabler (outline) | `stroke` | `MyIcon.stroke:'#1E1E1E'` |
| MDI / Phosphor (filled) | `fill` | `MyIcon.fill:'#1E1E1E'` |

#### variantSet

| Wrong | Right | Why |
|-------|-------|-----|
| Rely on `wrap:true` in variantSet props | Add `update(set, {layoutWrap:'WRAP', ...})` after | variantSet doesn't pass wrap/gap/padding to ComponentSet |
| Use symbols in `from:` across batches | Use real IDs from `idMap` | Cross-batch symbol resolution is unreliable |
| Call `setProperty` on Component ID | Call on **ComponentSet** ID | `addComponentProperty()` must target the set, not individual variants |

#### Clone overrides

| Wrong | Right | Why |
|-------|-------|-----|
| `fills:[]` to clear fills | `fill:'none'` | `[]` syntax not supported in flat ops; `'none'` → `parseXml('none')` → `[]` |
| `alignMain:'flex-end'` | `primaryAxisAlignItems:'MAX'` | Figma uses MIN/CENTER/MAX, not CSS flex values |
| `ChildName.prop` for grandchild | `GrandchildName.prop` | Clone overrides search by **exact node name** at any depth |

### Reference: Common Button Specs

```
Button frame:     layout:row, gap:8, corner:8, sizingH:hug, sizingV:hug,
                  alignMain:center, alignCross:center, overflow:hidden, strokeW:1
Button text:      size:16, font:'Inter', leading:16
Icon Button:      same as Button but corner:32, child is icon() not text()
Medium padding:   p:12
Small padding:    p:8
```
