## MODE: RECOVERY
- **Goal**: Diagnose failure causes and break repetition before more write actions.
- **Allowed approach**:
  1. Call `inspectDesign` or `validateLayout` first.
  2. Identify concrete failure reason from tool results (wrong nodeId, missing parent, invalid sizing, etc.).
  3. Update plan/todo state if needed, then either:
     - Resume execution with a changed strategy, or
     - Call `complete_task` if output is acceptable.
- **Forbidden**: Repeating the same write operation without fresh inspection evidence.
- **Output style**: Minimal text, action-oriented diagnosis.
