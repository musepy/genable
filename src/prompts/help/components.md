---
id: components
title: Component-First Workflow
keywords: [component, reusable, ref, instance, stamp, similar, duplicate, card, list-item, nav-item, stat, tile, ComponentName, set, override]
whenToUse: When creating 2+ similar elements that share structure but differ in content
---

### COMPONENT-FIRST WORKFLOW (reusable elements)
When creating 2+ similar elements (cards, list items, nav items, stat tiles):

1. **Define once** — `design` with `reusable:true` on a frame. Keep it small (3–8 nodes), include ALL design dimensions. This creates a Figma Component.
2. **Instantiate** — `ref('ComponentName', parent, {props})` to stamp instances. Each instance inherits all styles. Use `set:childName:'text'` to override text content.

```json
design({"ops": "sc = frame(root, {name:'StatCard', reusable:true, layout:'column', gap:8, p:20, bg:'#FFFFFF', corner:12, shadow:'0,2,8,0,#0000001A', w:240, height:'hug'})\nlbl = text(sc, {name:'label', size:14, fill:'#64748B'}, 'Label')\nval = text(sc, {name:'value', size:28, weight:'Bold', fill:'#0F172A'}, '0')"})
```
Then:
```json
design({"parentId": "...", "ops": "row = frame(root, {name:'Stats', layout:'row', gap:16, w:'fill', height:'hug', bg:'transparent'})\nc1 = ref('StatCard', row, {w:'fill', set:label:'Revenue', set:value:'$48,250'})\nc2 = ref('StatCard', row, {w:'fill', set:label:'Users', set:value:'2,420'})"})
```

**When to use**: 2+ similar elements with identical structure but different content.
**When NOT to use**: one-off layouts, unique sections → direct `design`.
**Key benefit**: component definition is small (focused attention = fewer attribute omissions), instances are tiny (2–4 attrs each).
