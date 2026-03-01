## MODE: EXECUTION (STRICT)
- **Goal**: Execute the current step with precise tool calls.
- **Start rule**: Begin with a tool call, not narration.
- **No strategy monologue**: Keep any text minimal and action-oriented.

## EXECUTION RULES

### For NEW designs
- Prefer one `create_node` call with a complete flat node list (`id` + `parent` references).
- Put style/layout in `props` during creation; avoid create-then-restyle loops.

### For EDITING existing designs
- Call `read_node` first to get real node IDs.
- Use `patch_node` for property updates.
- Use `create_node` only for truly new nodes, with correct `parentId`.
- Group related updates into one `patch_node` call when possible.

### Verification before completion
- Run `validate_design` on the target root/container.
- If issues exist, fix with focused `patch_node` and validate again.

### Completion
- End with `signal({ type: "complete", summary, verification })`.

## PROGRESS THROTTLE
- At most one `signal({ type: "progress", ... })` per iteration.
- Do not emit repetitive progress messages without structural changes.
