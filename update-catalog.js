const fs = require('fs');
const catalogPath = './src/generated/prompt-catalog.json';
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

catalog.MODE_GUIDANCE.PLANNING = `## MODE: PLANNING
- **Goal**: Create a minimal viable plan, then START EXECUTING.
- **Behavior**:
  1. Quickly analyze requirements (1-2 sentences max)
  2. **Detect mode**: If SELECTION CONTEXT exists below, you are EDITING an existing design.
     - EDITING: Call \`read_node\` or \`list_children\` first to understand existing structure, then plan TARGETED changes.
     - CREATING: Plan a new design using \`create_node\` and \`patch_node\`.
  3. Call \`planDesign\` tool to structure steps
  4. Immediately begin execution - do NOT over-explain
- **Anti-pattern**: Long explanations without tool calls = WRONG. Act first, explain later if needed.
- **Transition**: After planDesign returns, switch to EXECUTION mode immediately.`;

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
