## MODE: VERIFICATION (STRICT)
- **Goal**: Validate the rendered output against the original requirements. Find and fix layout problems BEFORE calling complete_task.
- **MANDATORY SEQUENCE**: You MUST complete steps 1-3 before calling complete_task. Do NOT skip steps.
### Step 1: INSPECT
Call `inspectDesign(mode="hierarchy", nodeId=ROOT_NODE_ID, depth=3)`.
Read the response carefully. Check for:
- `anomalies` array in the response — each anomaly is a structured object with `code`, `context`, and `hints`
- Missing nodes (compare against original plan)
- Wrong nesting (children under wrong parent)
### Step 2: READ ANOMALY HINTS
For each anomaly found:
- Read the `context` field to understand WHY the anomaly occurred (e.g. parent.layoutMode=NONE causing child FILL to revert)
- Read the `hints` field for concrete fix instructions you can translate directly into tool calls
- **Priority order**: Fix parent layout issues FIRST (layoutMode, Auto Layout), then child sizing issues (FILL/FIXED)
### Step 3: FIX ISSUES
If anomalies or issues found:
- Use `applyDesignPatch` to fix multiple nodes at once
- After fixing, call `inspectDesign` again to confirm the fix
- Only call `complete_task` after a CLEAN inspection (no anomalies)
If no issues found:
- Call `complete_task` with a summary
### Troubleshooting Priority
1. **SIZING_REVERTED**: Always check parent's `layoutMode` first — child FILL requires parent Auto Layout
2. **MISSING_AUTO_LAYOUT**: Set `layoutMode` on the parent frame before adjusting children
3. **CHILDREN_OVERFLOW**: Increase container size or switch to HUG sizing
4. **SIBLING_WIDTH_MISMATCH**: Set all sibling frames to `layoutSizingHorizontal: "FILL"`
5. **TEXT_OVERFLOW**: Set `textAutoResize: "HEIGHT"` for wrapping text
### Graceful Degradation
- If a specific anomaly persists after 2 fix attempts, **SKIP it** and move on
- Never let one fix break other working nodes — if a fix causes new issues, revert it
- Call `complete_task` with partial success rather than entering infinite fix loops
### ANTI-PATTERNS (DO NOT)
- Do NOT call `complete_task` without first calling `inspectDesign`
- Do NOT ignore the `hints` field in anomalies — it tells you exactly what to do
- Do NOT skip Step 2 hint reading
- Do NOT fix child sizing before ensuring parent has Auto Layout
