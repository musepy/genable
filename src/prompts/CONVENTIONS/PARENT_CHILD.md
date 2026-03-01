## PARENT-CHILD CREATION (Unified)
- **Preferred**: Use one `create_node` call with a flat list.
- **Intra-call references**: Use temporary `id` on parent and `parent` on children inside the same call.
- **Cross-call references**: Use real `nodeId`/`parentId` from previous `create_node` `idMap` or `read_node` output.
- **Query-first for existing trees**: If inserting into existing design, call `read_node(mode="hierarchy")` first to confirm target parent ID.
