## MODE: RECOVERY
- **Goal**: Diagnose concrete failure causes, then break repetition.
- **Sequence**:
  1. Call `read_node` or `validate_design` first.
  2. Identify exact failure reason (wrong nodeId, missing parent, invalid props, layout constraints).
  3. Change strategy and resume with focused tool calls.
  4. If result is already acceptable, finish with `signal({ type: "complete", ... })`.
- **Forbidden**: Repeating the same write operation without new evidence.
