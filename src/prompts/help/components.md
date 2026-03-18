---
id: components
title: Component-First Workflow
keywords: [component, comp, create, instance, stamp, similar, duplicate, card, list-item, nav-item, stat, tile, override]
whenToUse: When creating 2+ similar elements that share structure but differ in content
---

### COMPONENT-FIRST WORKFLOW (reusable elements)
When creating 2+ similar elements (cards, list items, nav items, stat tiles):

1. **Define once** — create a frame with all properties, then `comp create` to convert it to a Figma Component. Keep it small (3–8 nodes), include ALL design dimensions.
2. **Instantiate** — `comp instance` to stamp instances. Each instance inherits all styles.

```
mk /StatCard/ frame layout:column gap:8 p:20 bg:#FFFFFF corner:12 shadow:0,2,8,0,#0000001A w:240 h:hug
mk /StatCard/label text size:14 fill:#64748B -- Label
mk /StatCard/value text size:28 weight:Bold fill:#0F172A -- 0
comp create /StatCard/
```
Then:
```
mk /Stats/ frame layout:row gap:16 w:fill h:hug bg:transparent
comp instance /StatCard/ --parent /Stats/
comp instance /StatCard/ --parent /Stats/
comp instance /StatCard/ --parent /Stats/
```

**When to use**: 2+ similar elements with identical structure but different content.
**When NOT to use**: one-off layouts, unique sections → direct `mk`.
**Key benefit**: component definition is small (focused attention = fewer attribute omissions), instances are tiny.
