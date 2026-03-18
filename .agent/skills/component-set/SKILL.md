---
id: component-set
name: Component Set Creation
description: Efficiently create Figma ComponentSets with variant matrices using clone cascading
category: figma
priority: 3
enabledByDefault: true
---

## COMPONENT SET — Variant Matrix Creation

When creating a ComponentSet (multiple variants of one component), follow this workflow. It minimizes tool calls and avoids known pitfalls.

### Phase 1: Inspect Target (2 calls max)

Do NOT inspect every variant individually. Instead:

1. **Structure**: `tree /Component/ -d 2` — get variant names, dimensions, child structure
2. **Colors**: `grep /Component/ fill,stroke` — get ALL unique colors in one call
3. **Detail**: `cat /Component/PrimaryDefault/ -s` — inspect only **1 representative per Variant dimension** — infer other states from the color palette

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

**Step 1 — Base component** (frame + children):
```
mk /Base/ frame layout:row gap:8 corner:8 w:hug h:hug alignMain:center alignCross:center overflow:hidden p:12 bg:#2C2C2C stroke:'1 #2C2C2C'
mk /Base/Label text size:16 font:Inter leading:16 fill:#F5F5F5 -- Button
```

**Step 2 — Clone cascade** (group by similarity):
```
# Hover only changes bg → clone from Default
cp /Base/ /Hover/ bg:#1E1E1E

# Disabled has unique style → clone from base with overrides
cp /Base/ /Disabled/ bg:#D9D9D9 stroke:'1 #B3B3B3'

# Neutral has different colors
cp /Base/ /Neutral/ bg:#E3E3E3 stroke:'1 #767676'

# Size only changes padding → clone from corresponding style variant
cp /Base/ /Small/ p:8
```

**Step 3 — Combine into ComponentSet**:
```
comp combine /Base/ /Hover/ /Disabled/ /Neutral/ /Small/ --name Button
```

### Phase 4: Verify (1 call)

Take a screenshot of the ComponentSet and compare dimensions with target:
```
cat /Button/ -s
```

### Batching Strategy

- Use sequential `mk` + `cp` calls for all variants
- `cp` inherits everything from source, override only what changes
- Button (18 variants): 1 frame + 1 text + 17 cp + 1 comp combine = ~20 calls
- Use paths for all references — no ID tracking needed

### KNOWN PITFALLS

#### Text nodes

| Wrong | Right | Why |
|-------|-------|-----|
| `leading:100` | `leading:16` | `leading` is pixels, not %. 100 = 100px line height |
| `mk /X text w:hug h:hug` | `mk /X text` (omit sizing) | Setting sizing on text blocks `textAutoResize` auto-fill |
| `leading:'100%'` | `leading:16` (for 16px font) | String percentages not supported |

#### Icon nodes

The `icon` type creates `frame(name) > vector('Vector')`. Clone overrides on icon frames **auto-propagate fills/strokes to vector children** (same as icon creation). Use the icon node's name directly — no need to target the internal `Vector` node.

```
mk /Base/MyIcon icon icon:lucide:star w:20 h:20 stroke:#F5F5F5
```

| Icon library | Color prop | Example |
|-------------|-----------|---------|
| Lucide / Tabler (outline) | `stroke` | `stroke:#1E1E1E` |
| MDI / Phosphor (filled) | `fill` | `fill:#1E1E1E` |

#### comp combine

| Wrong | Right | Why |
|-------|-------|-----|
| Expect wrap/gap to work automatically | Update the set after combining | comp combine doesn't pass wrap/gap/padding to ComponentSet |
| Forget to name variants | Name frames `Variant=X, State=Y` before combine | Variant axes come from frame names |

#### Clone overrides (cp)

| Wrong | Right | Why |
|-------|-------|-----|
| `fill:transparent` to clear fills | `fill:none` | `none` clears the fills array |

### Reference: Common Button Specs

```
Button frame:     layout:row, gap:8, corner:8, w:hug, h:hug,
                  alignMain:center, alignCross:center, overflow:hidden, strokeW:1
Button text:      size:16, font:Inter, leading:16
Icon Button:      same as Button but corner:32, child is icon not text
Medium padding:   p:12
Small padding:    p:8
```
