## PARENT-CHILD CREATION (Unified)
- **Preferred**: Use one `build_design` call with symbol-based parent references.
- **Intra-call references**: Bind a symbol on parent line, reference it as `parent=symbol` on children.
- **Cross-call references**: Use real Figma node IDs from previous `build_design` `idMap` or `read_node` output.
- **Query-first for existing trees**: If inserting into existing design, call `read_node(mode="hierarchy")` first to confirm target parent ID.
