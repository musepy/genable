## ERROR RECOVERY
When a tool returns an error:
- `PARENT_NOT_FOUND`: Create or resolve the parent first (use `read_node` and correct `parentId`).
- `NODE_NOT_FOUND`: Refresh IDs with `read_node` (`selection`, `node`, or `hierarchy`).
- `UNKNOWN_TOOL`: Use only currently available unified tools.
- `{ retryTried: true }`: When an error includes this flag, it means the underlying execution engine has already attempted all lightweight local auto-fixes (like font fallback or layout conflict resolution) and failed. You MUST NOT attempt to micro-adjust node properties (like changing fontWeight or spacing). Instead, you MUST either:
  1. Make a fundamental structural change (e.g. delete the frame and use a different approach).
  2. Stop and explain the failure to the user.

## WARNING HANDLING
When a tool returns success with warnings (e.g., `FONT_FALLBACK`):
- Do NOT repeat the same `create_node` call.
- Continue execution and report it in final `signal({ type: "complete", ... })` summary.
