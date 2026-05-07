---
name: component-set
description: 'Use when creating a Figma ComponentSet with a variant matrix (multiple variants of one component) — clone cascade + combine_components + add_component_prop. NOT for: a single component with no variant axis — use jsx with `<component>` directly.'
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
  layout="row" gap={8} rounded={8} w="hug" h="hug"
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

**ALWAYS call `add_component_prop` on the SET ID returned by `combine_components`. NEVER on individual variant frame IDs** — Figma rejects with: `"Can only set component property definitions on a product component"`.

If `add_component_prop` fails with `"Component set has existing errors"`, the **set itself is invalid** (variant naming mismatch, missing dimension, or duplicate variant name). Fix variant names and rebuild — do NOT retry on each variant, do NOT fall back to `js({code})` to script around it.

Optional: `list_component_props({node: setId})` first to see the current variant structure and any existing properties.

```
// After combining, add text props ON THE SET (not on variants!)
add_component_prop({node: setId, name: "Label", type: "TEXT", default: "Button", bind: labelTextId})
```

The `bind` target must be a TEXT node descendant of the set (any single variant's text node works — Figma mirrors the binding across variants by node name).

### Phase 4: Verify (1 call)

```
get_screenshot({node: setId})
```

### Call Count

Button (18 variants): 1 jsx + 17 clone_node + 17 edit + 1 combine_components + props ≈ 38 calls
Button (6 variants): 1 jsx + 5 clone_node + 5 edit + 1 combine_components + props ≈ 14 calls

### KNOWN PITFALLS

| Wrong | Right | Why |
|-------|-------|-----|
| `add_component_prop({node: variantId, ...})` after combine | `add_component_prop({node: setId, ...})` | Property defs attach to the SET; variants are children, Figma rejects directly |
| Retry `add_component_prop` on each variant after first error | Fix variant naming and rebuild the set | "Component set has existing errors" = the SET is invalid; per-variant calls cascade more errors |
| `js({code: "...findOne(...)..."})` fallback | Use `findOneAsync` + `await`, or stick with tools | Sync `.findOne/.findAll/.findChildren` forbidden in dynamic-page mode |
| `create_component` inside another component | Create at top level, then `combine_components` | Figma blocks component-inside-component |
| Use old ID after `create_component` | Use the NEW ID from response | Old ID is invalidated |
| `js({code: "node.remove()"})` | `delete_node({node: id})` | JS sandbox blocks .remove() |
| `fill: "transparent"` to clear | `fill: "none"` | `none` clears the fills array |
| Name frames without variant format | `"Variant=X, State=Y"` before combine | Variant axes come from frame names |

### JS fallback safety (when tools fail)

If you must call `js({code})`, these sync APIs are **forbidden** by the plugin's `dynamic-page` mode:
- `.findOne()` → `.findOneAsync()` + `await`
- `.findAll()` → `.findAllAsync()` + `await`
- `.findChildren()` → `.findChildrenAsync()` + `await`
- `.findAllWithCriteria()` → `.findAllWithCriteriaAsync()` + `await`

These methods only work on `figma.currentPage` and the document root, not on individual frames. To search inside a component's children, walk `.children` manually with a filter.

**Better than fallback**: if `add_component_prop` or `combine_components` fails, the upstream issue is the set itself (variant naming, missing dimension, duplicate name). Fix and rebuild — don't script around it.

### Icon Nodes

The `icon` type in jsx creates a frame with vector child. Use the `<icon>` element:

```jsx
<icon name="Star" icon="lucide:star" w={20} h={20} stroke="#F5F5F5"/>
```

| Icon library | Color prop | Example |
|-------------|-----------|---------|
| Lucide / Tabler (outline) | `stroke` | `stroke="#1E1E1E"` |
| MDI / Phosphor (filled) | `fill` | `fill="#1E1E1E"` |
