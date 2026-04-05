# Landing Page E2E Session — Learnings & Figma Realities

> Session: LP-v3/v4 build, 51 variables, 3 mode switching (Light/Dark × Desktop/Mobile × EN/CN)
> Outcome: 6 bugs fixed, 4 regressions introduced-and-fixed, multiple blind spots exposed

## Mistakes I Made

### 1. Over-trusted `describe` tool as audit
`describe` reports **layout summary** but NOT:
- Color variable coverage / unbound colors
- Actual property values vs intent mismatches
- Space utilization (container size vs content)

**Fix**: lint ≠ audit. Build dedicated audits per concern.

### 2. Visual screenshot inspection missed 1px bugs
26 `#000000` strokes were invisible in screenshots because 1px black borders look identical to 1px `#E2E8F0` border at thumbnail scale.

**Fix**: systematic programmatic scans, not visual inspection.

### 3. Over-cleared strokes (introduced regression)
My "clear #000000 strokes" script removed defaults on 8 cards — but those cards had **instance overrides** that cleared the source component's bound border. Setting strokes=[] on instance created a NEW empty-override that hid the source's border.

**Fix**: before bulk clearing, check if parent/source component has valid binding. Prefer resetting instance overrides over clearing.

### 4. Assumed instance inherits from source — traps
After clearing instance `strokes = []`, later setting `node.strokes = [paint]` on SOURCE component did NOT propagate to instances. The empty override sticks.

**Fix**: To "reset" instance to source, need `instance.resetOverrides()` or set explicitly on instance.

### 5. Global `#FFFFFF → bg` binding too aggressive
Icon frames originally had NO fill. My global scan bound `#FFFFFF → bg` globally, which accidentally applied to icon frames (which were transparent containers). Result: icons appeared as white squares hiding the vectors inside.

**Fix**: scope color binding to known-intentional fills. Skip frames with `overflow: hidden` + no prior fill.

## Figma Realities Discovered

### Silent default #000000 stroke
```
node.strokeWeight = 1    // user intent: stroke width
node.strokes = []        // user intent: no stroke
// Figma RENDERS as 1px #000000 stroke anyway (silent default)
```
**Rule**: `strokeWeight > 0` always needs `strokes = [paint]`, or Figma paints black.

### `layoutMode` resets auto-layout defaults
```
node.layoutMode = 'HORIZONTAL'
// Figma auto-resets primaryAxisAlignItems='MIN', counterAxisAlignItems='MIN'
```
**Rule**: set alignment AFTER layoutMode. Property order matters (PROP_ORDER handles this via topological sort, but external JS scripts must respect it).

### Variable lookup: `v.name` is just name, not path
```js
figma.variables.getLocalVariablesAsync()
// returns [{name: "xl", variableCollectionId: "VariableCollectionId:X", ...}]
// name is "xl" NOT "LP-Spacing/xl"
```
**Fix**: cache by `collection.name + "/" + v.name` for unambiguous lookup.

### Instance children's stroke/fill state is independent
```
sourceIconFrame.strokes = [purplePaint]  // set on component source
// But existing instances that had `strokes = []` override STAY empty
// Must set strokes on each instance's children directly
```

### `<instance ref>` in jsx doesn't apply props
```jsx
<instance ref="Button" Label="Email"/>  // Label override NOT applied
```
**Fix**: after `<instance ref>`, use `edit({props: {Label: "Email"}})` on the resulting instance node.

### `combine_components` + `add_component_prop` only binds one variant
```js
// combine_components([primary, secondary, ghost])  
// add_component_prop({node: set, name: "Label", bind: primary.Label})
// → Primary variant's Label is bound, Secondary/Ghost are NOT
```
**Fix**: manually bind via js on each variant's Label text nodes:
```js
text.componentPropertyReferences = {characters: propKey}
```

### Icon component: stroke goes on FRAME, not VECTOR
```jsx
<icon name="Icon" icon="lucide:zap" stroke="$LP-Theme/primary"/>
// → creates Frame(with stroke) > Vector(no stroke)
// Vector is invisible because the vector SVG path uses stroke not fill
```
**Fix**: set stroke on Vector child, not Frame. Or use filled icon variants.

### INSTANCE_SWAP default must be component ID, not name
```js
add_component_prop({
  node: comp, name: "Icon", type: "INSTANCE_SWAP",
  default: "1450:59272"  // component ID, NOT "LP-v3/Icon/Zap"
})
```

## JS Commands Cheatsheet

### Works ✓
```js
// Async API (required in latest Figma)
await figma.getNodeByIdAsync(id)
await figma.variables.getLocalVariablesAsync()
await figma.variables.getLocalVariableCollectionsAsync()

// Node search (fast)
node.findAllWithCriteria({types: ['VECTOR']})

// Variable binding
figma.variables.setBoundVariableForPaint(
  {type: 'SOLID', color: {r:0, g:0, b:0}}, 'color', variable
)  // returns Paint with binding
node.setBoundVariable('paddingTop', variable)  // for FLOAT vars

// Mode switching (per-node, explicit)
node.setExplicitVariableModeForCollection(collection, modeId)

// Component props
instance.setProperties({[internalKey]: value})  // internalKey = "Label#1452:149"
textNode.componentPropertyReferences = {characters: propKey}  // TEXT binding
instanceNode.componentPropertyReferences = {mainComponent: propKey}  // INSTANCE_SWAP binding

// Layout-safe resize
frame.resize(w, h)  // doesn't reset alignment

// Clear fills/strokes
node.fills = []
node.strokes = []
```

### Doesn't Work ✗ (JS sandbox blocks)
```js
node.remove()                    // use delete_node tool
figma.currentPage.findAll(...)   // use find_nodes tool
parent.insertChild(...)          // use move_node tool
figma.getNodeById(id)            // sync version blocked, use Async
```

### Traps
```js
// ❌ Bare variable name is ambiguous
cache.get("xl")  // 3 vars named "xl" across collections

// ❌ Setting stroke on icon frame != Vector
iconFrame.strokes = [greenPaint]  // frame gets green border
// Vector inside still has no stroke

// ❌ Instance override empty ≠ inheriting
instance.strokes = []  // creates override, does NOT inherit source

// ❌ Shorthand $var in jsx stroke
<frame stroke="$LP-Theme/border"/>  // may not bind (verify with inspect)
```

## Audit Tools That Should Exist

### 1. Color Coverage Scanner
```
scan_unbound_colors(root):
  for each node:
    for each fill/stroke:
      if paint.type === 'SOLID' && !node.boundVariables[prop]:
        report(hex, node.id, prop)
  exclude: whitelisted iconic colors (mac dots, gold stars)
```
Runs after any bulk color operation.

### 2. Layout Integrity Verifier
```
verify_layout(node):
  if node.layoutMode !== 'NONE':
    expected_align = derive_from_layout_intent(node)
    actual = node.primaryAxisAlignItems
    if actual !== expected: report mismatch
    
    // Waste detection
    content_size = sum(children widths) + total_gap
    padding = paddingLeft + paddingRight
    available = node.width - padding
    if available - content_size > 50 && actual === 'MIN':
      report "wasted space"
```

### 3. Default Stroke Bug Scanner
```
scan_default_black_strokes(root):
  for each node:
    if node.strokeWeight > 0 && node.strokes.length === 0:
      // This renders as #000000 silently
      report(node)
```

### 4. Instance Override Diff
```
diff_instance_vs_source(instance):
  for each overridden prop:
    report(prop, source_value, instance_override_value)
  // especially: empty overrides that hide source bindings
```

## Skills Worth Updating

### `.agent/skills/component-set/SKILL.md`
Add section: **"Instance property inheritance traps"**
- Empty override sticks
- stroke override propagation
- ComponentSet prop binding needs manual sync to all variants

### New skill: `variable-audit`
Runs color coverage + layout integrity + stroke defaults scans after:
- any bulk `edit()` operation
- any `js()` mutation script
- mode switching (catches regressions)

### Existing `componentization` skill
Add section: **"Rich icon handling"**
- Icon element creates Frame+Vector, stroke on Vector not Frame
- For colored icons: use dedicated Icon components per color OR edit Vector stroke directly
- Icon overflow clipping hides oversized vectors

## Bottom-Line Lessons

1. **Property pipeline bugs compound**: expandShorthands → normalizeProps → handlers → Figma defaults — each stage can silently drop or modify values. Need end-to-end verification.

2. **Instance overrides are lossy**: setting on source doesn't help once instance has override. Clearing = creating NEW empty override (not reverting).

3. **Color audit is not visual**: 1px strokes, opacity 0.3 text, bg behind children — all require programmatic scanning.

4. **Figma silently applies defaults**: strokeWeight w/o strokes → black, layoutMode → MIN align. Must counteract explicitly.

5. **Variable binding requires exact paths**: `"collection/name"` not `"name"`. Cache by full path.

6. **`describe` is a layout linter, not a design auditor**: colors, alignments, sizing consistency all need separate tools.

7. **jsx is not WYSIWYG**: `<instance ref>` doesn't set props, `stroke="$var"` shorthand may not bind, Figma applies defaults post-creation. Verify with inspect after every jsx.

8. **Bulk operations risk silent regressions**: every `findAll → modify` touch point is a potential side-effect. Before/after diff essential.
