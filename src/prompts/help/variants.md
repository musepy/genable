---
id: variants
title: Clone for Variant Matrices
keywords: [clone, variant, variantSet, ComponentSet, matrix, state, size, style, cascade, override, child-override, base, diff]
whenToUse: When creating a ComponentSet with multiple variants across axes like style, state, and size
---

### CLONE FOR VARIANT MATRICES
When creating a ComponentSet with many variants (e.g. Button × 3 styles × 3 states × 2 sizes = 18 variants):

1. **Define one base** — `reusable:true` with ALL properties (the "source of truth")
2. **Clone variants** — `clone(base, root, {name:'...', ...onlyDiffs})` — inherits everything, override only what changes
3. **Cascade** — clone from a clone to layer overrides (e.g. Small = clone from Medium with `p:8`)
4. **Child overrides** — `ChildName.prop:value` in clone props (e.g. `Label.fill:'#999'`)
5. **Combine** — `variantSet(root, {from:'base,v2,v3,...'})`

```json
design({"ops": "base = frame(root, {name:'Variant=Primary, State=Default, Size=Medium', reusable:true, layout:'row', p:12, corner:8, bg:'#2C2C2C', stroke:'#2C2C2C', strokeW:1, w:'hug', height:'hug', alignItems:'center', justifyContent:'center'})\nlbl = text(base, {name:'Label', size:16, fill:'#F5F5F5'}, 'Button')\nhov = clone(base, root, {name:'Variant=Primary, State=Hover, Size=Medium', bg:'#1E1E1E'})\ndis = clone(base, root, {name:'Variant=Primary, State=Disabled, Size=Medium', bg:'#D9D9D9', stroke:'#B3B3B3', Label.fill:'#B3B3B3'})\nsm = clone(base, root, {name:'Variant=Primary, State=Default, Size=Small', p:8})\nbtnSet = variantSet(root, {name:'Button', from:'base,hov,dis,sm'})"})
```

**Key benefit**: 18 variants in ~20 lines instead of ~36. Each clone line specifies ONLY differences → minimal omission risk.
