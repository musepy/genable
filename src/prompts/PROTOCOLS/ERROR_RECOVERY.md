## ERROR RECOVERY
When a tool returns an error:
- `PARENT_NOT_FOUND`: Create the parent node first
- `NODE_NOT_FOUND`: Use `inspectDesign({ mode: "selection" })` to refresh valid IDs
- `UNKNOWN_TOOL`: Check available tools and use correct name
