---
id: help:component-workflow
name: Component Workflow
description: Use when building reusable components and instances — covers the components-first ordering, ID tracking, and override mechanism.
category: help
tags: [component, instance, create_component, override, component-prop, workflow]
---

## COMPONENT WORKFLOW

When creating reusable components + instances, follow this order strictly. Violating it causes unrecoverable errors.

### Rule 1: Components-first, NOT design-first
Create atomic components at the canvas top level FIRST, then assemble pages using `<instance ref="..."/>`. Do NOT create a flat design and try to componentize after — that path leads to component-inside-component errors and ID tracking failures.

### Rule 2: Never create components inside other components
Figma API hard limit: `create_component()` on a node inside another component → fatal error "Cannot move node. Reparenting would create a component inside a component." There is no workaround.

### Rule 3: Use `<component>` and `<instance ref>` in jsx
```
jsx({markup: `
<component name="Input" w={356} layout="column" gap={8}>
  <text name="Label" size={14} weight="Medium">Label</text>
  <frame name="Box" w="fill" h={44} corner={8} stroke="#D1D5DB" layout="row" align="center" p={{left:16, right:16}}>
    <text name="Placeholder" size={14} fill="#9CA3AF">Placeholder</text>
  </frame>
</component>
`})
// Then assemble with instances:
jsx({markup: `
<frame name="Form" w={420} layout="column" gap={16} p={32}>
  <instance ref="Input"/>
  <instance ref="Input"/>
</frame>
`})
```

### Rule 4: Instance overrides — use `edit` with component prop names
`<instance ref>` does NOT apply property overrides. After assembly, use `edit` with the component property DISPLAY NAMES (the names you gave to `add_component_prop`).

```
edit({nodes: [
  {node: emailInstanceId,  props: {Label: "Email", Placeholder: "you@example.com"}},
  {node: pwdInstanceId,    props: {Label: "Password", Placeholder: "••••••••"}},
  {node: cardInstanceId,   props: {IconSlot: "1450:59275", Title: "Secure", Description: "..."}},
  {node: buttonInstanceId, props: {"Show Icon": "false", Label: "Sign In"}}
]})
```

This handles TEXT, BOOLEAN, and INSTANCE_SWAP props — Figma props (w, bg, p) can mix in the same call. No need to construct `I{instanceId};{childId}` paths.

### Rule 5: ID tracking after create_component
`create_component(oldId)` invalidates `oldId` and returns a NEW id. Always use the returned id for subsequent operations.
