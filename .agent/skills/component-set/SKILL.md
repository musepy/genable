---
id: component-set
name: Component Set Creation
description: Use when creating a Figma ComponentSet with a variant matrix — clone cascading for diffs and combine_components to assemble the final set, avoiding known pitfalls.
---

## COMPONENT SET — Variant Matrix Creation

When creating a ComponentSet (multiple variants of one component), follow this workflow. It minimizes tool calls and avoids known pitfalls.

### Phase 1: Identify Variant Dimensions

ComponentSets are Cartesian products. Decompose into dimensions:

```
"Variant=Primary, State=Default, Size=Medium"
→ Dimensions: Variant(Primary|Neutral|Subtle) × State(Default|Hover|Disabled) × Size(Medium|Small)
→ Total: 3 × 3 × 2 = 18 variants
```

Find **identical style groups** to minimize clone overrides:
- All Disabled variants often share the same fill/stroke/text colors
- Hover variants often only change 1 prop from Default

### Phase 2: Create Base + Clone Cascade

**Step 1 — Create base variant** (1 jsx call):
```
jsx({markup: `
<component name="Variant=Primary, State=Default, Size=Medium"
  layout="row" gap={8} corner={8} w="hug" h="hug"
  align="center" p={12} bg="#2C2C2C" stroke="#2C2C2C">
  <text name="Label" size={16} weight="Medium" fill="#F5F5F5">Button</text>
</component>
`})
```

**Step 2 — Clone cascade** (clone_node + edit, group by similarity):
```
// Hover only changes bg → clone from Default, edit one prop
clone_node({node: baseId})  → hoverId
edit({node: hoverId, name: "Variant=Primary, State=Hover, Size=Medium", bg: "#1E1E1E"})

// Disabled has unique style → clone + more overrides
clone_node({node: baseId})  → disabledId
edit({node: disabledId, name: "Variant=Primary, State=Disabled, Size=Medium",
      bg: "#D9D9D9", stroke: "#B3B3B3"})

// Size variant only changes padding
clone_node({node: baseId})  → smallId
edit({node: smallId, name: "Variant=Primary, State=Default, Size=Small", padding: 8})
```

**Step 3 — Combine into ComponentSet** (1 combine_components call):
```
combine_components({nodes: [baseId, hoverId, disabledId, smallId], name: "Button"})
```

### Phase 3: Add Component Properties

```
// After combining, add text props
add_component_prop({node: setId, name: "Label", type: "TEXT", default: "Button", bind: labelId})
```

### Phase 4: Verify (1 call)

```
inspect({node: setId, screenshot: true})
```

### Call Count

Button (18 variants): 1 jsx + 17 clone_node + 17 edit + 1 combine_components + props ≈ 38 calls
Button (6 variants): 1 jsx + 5 clone_node + 5 edit + 1 combine_components + props ≈ 14 calls

### KNOWN PITFALLS

| Wrong | Right | Why |
|-------|-------|-----|
| `create_component` inside another component | Create at top level, then `combine_components` | Figma blocks component-inside-component |
| Use old ID after `create_component` | Use the NEW ID from response | Old ID is invalidated |
| `js({code: "node.remove()"})` | `delete_node({node: id})` | JS sandbox blocks .remove() |
| `fill: "transparent"` to clear | `fill: "none"` | `none` clears the fills array |
| Name frames without variant format | `"Variant=X, State=Y"` before combine | Variant axes come from frame names |

### Icon Nodes

The `icon` type in jsx creates a frame with vector child. Use the `<icon>` element:

```jsx
<icon name="Star" icon="lucide:star" w={20} h={20} stroke="#F5F5F5"/>
```

| Icon library | Color prop | Example |
|-------------|-----------|---------|
| Lucide / Tabler (outline) | `stroke` | `stroke="#1E1E1E"` |
| MDI / Phosphor (filled) | `fill` | `fill="#1E1E1E"` |
