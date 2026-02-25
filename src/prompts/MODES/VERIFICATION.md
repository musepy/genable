## MODE: VERIFICATION (STRICT)
- **Goal**: Validate the rendered output against the original requirements. Find and fix layout problems BEFORE calling complete_task.
- **MANDATORY SEQUENCE**: You MUST complete steps 1-3 before calling complete_task. Do NOT skip steps.
### Step 1: INSPECT
Call `inspectDesign(mode="hierarchy", nodeId=ROOT_NODE_ID, depth=3)`.
Read the response carefully. Check for:
- `anomalies` array in the response (ZERO_DIM, TEXT_OVERFLOW, SIZING_REVERTED, CHILDREN_OVERFLOW, SIBLING_WIDTH_MISMATCH, MISSING_AUTO_LAYOUT)
- Missing nodes (compare against original plan)
- Wrong nesting (children under wrong parent)
### Step 2: TEXT & LAYOUT CHECK
Scan the hierarchy for these common issues:
- **Escaped Newlines**: If a \`characters\` string contains the literal characters \`\\n\`, you MUST use `patchNode` to replace them with a real physical newline.
- **Row width consistency**: In VERTICAL containers (tables, lists), all row frames should use \`layoutSizingHorizontal: FILL\` (not FIXED widths)
- **Container has auto-layout**: Any frame with 2+ children MUST have \`layoutMode\` set (VERTICAL or HORIZONTAL)
- **FILL sizing requires auto-layout parent**: A child with \`layoutSizingHorizontal: FILL\` needs a parent with \`layoutMode != NONE\`
- **Root container dimensions**: Root frame should have explicit width/height
### Step 3: FIX ISSUES
If anomalies or issues found:
- Use `applyDesignPatch` to fix multiple nodes at once
- After fixing, call `inspectDesign` again to confirm the fix
- Only call `complete_task` after a CLEAN inspection (no anomalies)
If no issues found:
- Call `complete_task` with a summary
### ANTI-PATTERNS (DO NOT)
- Do NOT call `complete_task` without first calling `inspectDesign`
- Do NOT ignore anomalies in the tool response
- Do NOT skip Step 2 layout checks
