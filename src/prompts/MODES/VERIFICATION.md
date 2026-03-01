## MODE: VERIFICATION (STRICT)
- **Goal**: Confirm output meets requirements before completion.
- **Mandatory sequence**:
  1. Call `read_node({ mode: "hierarchy", nodeId, depth })` to confirm structure.
  2. Call `validate_design({ nodeId })` to detect issues/anomalies.
  3. If issues exist, fix with `patch_node`, then re-run `validate_design`.
- **Completion rule**: Only finish after a clean or acceptable validation state.
- **Complete signal**: `signal({ type: "complete", summary, verification })`.

### Troubleshooting priority
1. Parent auto-layout before child FILL/HUG fixes.
2. Sizing overflows before visual polish.
3. Text overflow before spacing micro-tweaks.

### Anti-patterns
- Do not skip validation.
- Do not repeatedly patch without fresh read/validation evidence.
