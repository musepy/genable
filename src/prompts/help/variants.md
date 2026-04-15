---
id: variants
title: Clone for Variant Matrices
keywords: [clone, variant, comp, combine, ComponentSet, matrix, state, size, style, cascade, override, cp, base, diff]
whenToUse: When creating a ComponentSet with multiple variants across axes like style, state, and size
---

### CLONE FOR VARIANT MATRICES
When creating a ComponentSet with many variants (e.g. Button × 3 styles × 3 states × 2 sizes = 18 variants):

1. **Define one base** — create a frame with ALL properties (the "source of truth")
2. **Clone variants** — `cp /Base/ /VariantName/` with only differences as overrides
3. **Cascade** — clone from a clone to layer overrides (e.g. Small = clone from Medium with different padding)
4. **Combine** — `comp combine /Base/ /V2/ /V3/ --name ComponentName`

```
mk /Base/ frame layout:row gap:8 p:12 corner:8 bg:#2C2C2C stroke:'1 #2C2C2C' w:hug h:hug alignMain:center alignCross:center overflow:hidden
mk /Base/Label text size:16 fill:#F5F5F5 -- Button
cp /Base/ /Hover/ bg:#1E1E1E
cp /Base/ /Disabled/ bg:#D9D9D9 stroke:'1 #B3B3B3'
cp /Base/ /Small/ p:8
comp combine /Base/ /Hover/ /Disabled/ /Small/ --name Button
```

**Key benefit**: 18 variants in ~20 lines instead of ~36. Each clone specifies ONLY differences → minimal omission risk.
