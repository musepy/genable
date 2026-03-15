# Component Set Recreation: Lessons Learned

## Context
Attempting to replicate a Figma design system section (Button, Icon Button, Button Danger, Button Group) using the plugin MCP's `design` tool.

## Target vs Achieved

### Target (Original Design)
- **Button** ComponentSet with 7 properties:
  - 3 variant props: Variant (Primary/Neutral/Subtle), State (Default/Hover/Disabled), Size (Medium/Small)
  - 1 text property: Label (default: "Button")
  - 2 boolean properties: Has Icon Start (false), Has Icon End (false)
  - 2 instance swap properties: Icon Start (Star), Icon End (X)
- Variants arranged in a **grid layout** (3×3 for Medium, 3×3 for Small)
- Icon instances (Star, X) inside each variant, visibility controlled by boolean props

### Achieved (First Attempt)
- 18 variants with correct colors, sizes, padding ✓
- Variant properties auto-derived from naming ✓
- **Missing**: Label text property, boolean visibility, instance swap properties ✗
- **Missing**: Icon nodes inside buttons (Star, X) ✗
- **Layout**: Single horizontal row instead of grid ✗

## Root Causes

### 1. Tool Limitation: No Component Property API
The `design` tool (`flatOpsParser.ts` → `executor.ts`) has no support for:
- `component.addComponentProperty(name, type, defaultValue)` — Figma's API for adding text/boolean/swap props
- `node.componentPropertyReferences = { field: propertyKey }` — linking nodes to properties
- Only variant properties (from naming convention) are supported

### 2. Wrong Workflow: Styling First, Structure Later
**Wrong**: Created styled frames with text → cloned for variants → combined
**Right**: Should create full structure first (frame + icon instances + text) → add properties → adjust layout

### 3. Missing Content Nodes
Buttons should contain:
- Text node "Button" (linked to Label text property)
- Frame "Icon Start" containing Star icon instance (visibility linked to "Has Icon Start")
- Frame "Icon End" containing X icon instance (visibility linked to "Has Icon End")

Only text was created; icon frames/instances were omitted.

### 4. Layout Not Configured
`variantSet` defaults to `HORIZONTAL` layout after `combineAsVariants()`. Need to set:
- `layoutWrap: 'WRAP'` for grid arrangement
- `counterAxisSpacing` for row gaps
- Explicit width to control wrapping breakpoint

## Correct Approach

### Step 1: Create complete content structure
Build ONE base variant with all nodes:
```
frame(root, {reusable:true, ...})
  frame("IconStartFrame", {visible:false, ...})  ← hidden by default
    icon("Star", ...)
  text("Label", ..., 'Button')
  frame("IconEndFrame", {visible:false, ...})     ← hidden by default
    icon("X", ...)
```

### Step 2: Clone for all variants
Use `clone()` with cascading overrides for each variant combination.

### Step 3: Combine into variantSet
```
variantSet(root, {name:'Button', from:'...', layout:'row', wrap:true, gap:20, crossGap:20, w:400})
```

### Step 4: Add component properties
```
setProperty(variant, 'Label', 'text', textNode)
setProperty(variant, 'Has Icon Start', 'bool', iconStartFrame, false)
setProperty(variant, 'Icon Start', 'swap', starInstance)
setProperty(variant, 'Has Icon End', 'bool', iconEndFrame, false)
setProperty(variant, 'Icon End', 'swap', xInstance)
```

## Implementation Required

### Files to modify:
| File | Change |
|------|--------|
| `src/domain/design-ir.ts` | Add `'componentProperty'` to OperationIR.command union |
| `src/engine/actions/types.ts` | Add `ComponentPropertyAction` interface |
| `src/engine/flat/flatOpsParser.ts` | Add `parseSetProperty()` + compiler case |
| `src/engine/actions/executor.ts` | Add `case 'componentProperty'` handler |

### Figma API calls needed:
```typescript
// On ComponentNode (one variant is enough, syncs to all)
const propKey = component.addComponentProperty('Label', 'TEXT', 'Button');
textNode.componentPropertyReferences = { characters: propKey };

const boolKey = component.addComponentProperty('Has Icon Start', 'BOOLEAN', false);
iconStartFrame.componentPropertyReferences = { visible: boolKey };

const swapKey = component.addComponentProperty('Icon Start', 'INSTANCE_SWAP', starComponent.id);
starInstance.componentPropertyReferences = { mainComponent: swapKey };
```

## Design Token Reference (extracted from original)

### Button Colors
| Variant | State | Fill | Stroke | Text |
|---------|-------|------|--------|------|
| Primary | Default | #2C2C2C | #2C2C2C | #F5F5F5 |
| Primary | Hover | #1E1E1E | #2C2C2C | #F5F5F5 |
| Primary | Disabled | #D9D9D9 | #B3B3B3 | #B3B3B3 |
| Neutral | Default | #E3E3E3 | #767676 | #1E1E1E |
| Neutral | Hover | #CDCDCD | #767676 | #1E1E1E |
| Neutral | Disabled | #D9D9D9 | #B3B3B3 | #B3B3B3 |
| Subtle | Default | — | — | #303030 |
| Subtle | Hover | — | #D9D9D9 | #1E1E1E |
| Subtle | Disabled | #D9D9D9 | #B3B3B3 | #B3B3B3 |

### Common Specs
- Font: Inter Regular 16px, lineHeight 100%
- Medium: padding 12px, Small: padding 8px
- Corner radius: 8px (Button), 32px (Icon Button)
- Gap: 8px, border: 1px
