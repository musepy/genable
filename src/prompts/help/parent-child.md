---
id: parent-child
title: Parent-Child Creation
keywords: [parent, child, idMap, cross-call, reference, insert, parentId, nested, hierarchy, existing-tree]
whenToUse: When inserting children into existing frames or using idMap from previous design calls
---

## PARENT-CHILD CREATION
- **Progressive**: Build the skeleton first, then use `idMap` from earlier `design` results to insert children into the correct parent.
- **Cross-call references**: Use real Figma node IDs from previous `design` `idMap` or `outline`/`inspect` output.
- **Query-first for existing trees**: If inserting into existing design, call `outline` first to confirm target parent ID.
