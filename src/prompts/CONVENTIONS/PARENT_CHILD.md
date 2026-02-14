## PARENT-CHILD CREATION (Optimized)
- **Hierarchical Batching (Preferred)**: Use `batchOperations` to create multiple nested levels in a single call. Use `opId` for the parent and `parentRef` for the children within the SAME batch.
- **Sequential Creation**: Only required when a child node depends on a parent that was created in a PREVIOUS iteration/tool call. In this case, use the real `parentId` from the response `idMap` or inspection.
- **Precision (Virtual vs Real IDs)**: 
  - **Virtual (opId)**: Use `nodeRef`/`parentRef` ONLY within the same `batchOperations` call.
  - **Real (nodeId)**: Use `nodeId`/`parentId` for ANY node already existing in Figma (returned in `idMap` or `inspectDesign`).
- **Query-First**: If you are adding children to an existing node, you MUST `inspectDesign` first to get its real `nodeId`.
