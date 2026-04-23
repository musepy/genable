---
id: componentization
title: Componentization — Create Components & Assemble with Instances
whenToUse: Creating reusable components, converting frames to components, using instances, component properties
keywords:
  - component
  - instance
  - componentize
  - reusable
  - component prop
  - TEXT prop
  - BOOLEAN prop
  - instance ref
---

## Componentization SOP — Shortest Path

**Core rule: Components-first, NOT design-first.**

Create atomic components at the canvas top level FIRST, then assemble pages using `<instance ref="..."/>`. NEVER create components inside other components (Figma API hard limit).

### Critical Failures to Avoid

1. **Component inside Component**: `create_component()` on a node inside another component → "Cannot move node. Reparenting would create a component inside a component". Fix: create components at top level.

2. **ID lost after create_component**: `create_component(oldId)` invalidates `oldId`, returns a NEW id. Always use the returned id.

3. **JS sandbox bypass**: `js({code: "node.remove()"})` → BLOCKED. Use `delete_node`, `find_nodes`, `move_node` instead.

### 4-Step Flow

**Step 1 — Create atomic components** (1 jsx call):

Use `<component>` element to create real Figma Components directly:

```jsx
jsx({markup: `
<component name="Text Input" w={356} layout="column" gap={8}>
  <text name="Label" size={14} weight="Medium">Label</text>
  <frame name="Input Box" w="fill" h={44} corner={8} stroke="#D1D5DB" layout="row" align="center" p={{left:16, right:16}}>
    <text name="Placeholder" size={14} fill="#9CA3AF">Placeholder</text>
  </frame>
</component>

<component name="Button" w={356} h={48} corner={8} bg="#4F46E5" layout="row" justify="center" align="center">
  <text name="Label" size={16} weight="SemiBold" fill="#FFFFFF">Button</text>
</component>
`})
```

Multiple `<component>` elements in one jsx call. All created at canvas top level.

**Step 2 — Add component properties** (inspect + add_component_prop):

```
inspect({node: componentId, mode: "tree", depth: 3})  // get child IDs
add_component_prop({node: compId, name: "Label", type: "TEXT", default: "Label", bind: labelNodeId})
add_component_prop({node: compId, name: "Placeholder", type: "TEXT", default: "Placeholder", bind: placeholderNodeId})
add_component_prop({node: compId, name: "Show Icon", type: "BOOLEAN", default: "true", bind: iconNodeId})
// All add_component_prop calls can be parallel
```

**Step 3 — Assemble with instances** (1 jsx call):

Use `<instance ref="ComponentName"/>` to create instances inline:

```jsx
jsx({markup: `
<frame name="Login Form" w={420} layout="column" gap={24} p={32} bg="#FFFFFF" corner={16}>
  <frame name="Header" w="fill" layout="column" gap={8}>
    <text size={28} weight="Bold">Sign In</text>
  </frame>
  <frame name="Fields" w="fill" layout="column" gap={16}>
    <instance ref="Text Input"/>
    <instance ref="Text Input"/>
  </frame>
  <instance ref="Button"/>
</frame>
`})
```

**Step 4 — Override instance text** (1 set_text call):

Instance child ID format: `I{instanceId};{componentChildId}`

```
set_text({nodes: [
  {node: "I{inst1};{labelId}", text: "Email"},
  {node: "I{inst1};{placeholderId}", text: "you@example.com"},
  {node: "I{inst2};{labelId}", text: "Password"},
  {node: "I{btnInst};{btnLabelId}", text: "Sign In"}
]})
```

One batch call for ALL text overrides.

### Call Count

| Step | Tool | Count | Parallel? |
|------|------|-------|-----------|
| 1. Components | jsx | 1 | - |
| 2a. Read IDs | inspect | 1 | - |
| 2b. Props | add_component_prop | N | Yes |
| 3. Assemble | jsx | 1 | - |
| 4. Overrides | set_text | 1 | - |
| Verify | get_screenshot | 1 | - |

Total: ~6-10 calls depending on prop count.
