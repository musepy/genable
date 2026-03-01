const fs = require('fs');
const path = require('path');

const catalogPath = path.join(__dirname, 'src/generated/prompt-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

// 1. Clean CONVENTIONS_PARENT_CHILD
catalog.CONVENTIONS_PARENT_CHILD = `## PARENT-CHILD CREATION
- **Top-Down Creation**: Create parent nodes first using \`patch_node\`, then create children using the parent's \`id\`.
- **Query-First**: If you are adding children to an existing node, you MUST \`search_nodes\` or \`read_node\` first to get its real ID.`;

// 2. Clean EXAMPLES
catalog.EXAMPLES = `## EXAMPLES

### Example 1: Finding and Modifying a Node
User: "把导航栏的背景改成蓝色"

**Step 1: Search**
\`search_nodes({ query: "导航栏" })\`
→ Returns: [{ id: "10:2", name: "导航栏", type: "FRAME" }]

**Step 2: Read details (optional but recommended)**
\`read_node({ id: "10:2" })\`
→ Returns exact props.

**Step 3: Patch**
\`patch_node({ id: "10:2", props: { fills: ["#0000FF"] } })\`

### Example 2: Creating a new element
User: "在主体区域加一个按钮"

**Step 1: Search for parent**
\`search_nodes({ query: "主体" })\`
→ Returns: [{ id: "20:5", name: "主体区域", type: "FRAME" }]

**Step 2: Create child node**
\`patch_node({ id: "new-btn", parentId: "20:5", props: { type: "FRAME", name: "按钮", fills: ["#000000"] } })\``;

// 3. Clean PROTOCOLS_DESIGN_GENERATION
catalog.PROTOCOLS_DESIGN_GENERATION = `## DESIGN GENERATION PROTOCOL

You only have ONE write primitive: \`patch_node\`.
- **Create**: Provide a new \`id\` (or let it auto-generate), specify \`parentId\`, \`type\`, and \`props\`.
- **Update**: Provide an existing \`id\` and the \`props\` you want to change.

### INLINE STYLING
ALWAYS include fills, cornerRadius, padding, etc., in the SAME call that creates the node.
NEVER create a bare node and style it in a separate call.`;

// 4. Clean PROTOCOLS_ERROR_RECOVERY
catalog.PROTOCOLS_ERROR_RECOVERY = `## ERROR RECOVERY
When a tool returns an error:
- \`NODE_NOT_FOUND\`: Use \`search_nodes\` to find the correct node by name or type. Do not guess IDs.
- \`INVALID_PROPS\`: Read the error message carefully and correct the property types or values.`;

// 5. Clean SCENE_GRAPH_MODEL (remove big batch processing overhead lines)
catalog.SCENE_GRAPH_MODEL = `## SCENE GRAPH MENTAL MODEL

### Structure: Rooted Acyclic Tree
- The Figma scene graph is a TREE. Every node has exactly one parent. The root has parent: null.
- FRAME = container (can hold children, supports layoutMode, padding, gap).
- TEXT, RECTANGLE, ELLIPSE, LINE, ICON = leaf nodes (no children, no layoutMode).
- TEXT nodes NEVER support layoutMode. Setting layoutMode on TEXT is silently ignored.

### Layout Context Propagation (Parent Constrains Child)
- A parent's layoutMode (HORIZONTAL/VERTICAL) creates an auto-layout context for its children.
- Children's sizing behavior is RELATIVE TO PARENT:
  - FILL = stretch to fill parent's available space. Requires parent to have layoutMode.
  - HUG = shrink to fit own content. Requires the FRAME itself to have layoutMode.
  - FIXED = explicit width/height in pixels. Always valid.

### Efficiency: Explore vs Write
- Use \`search_nodes\` to quickly find elements by name.
- Use \`list_children\` to understand structural nesting.
- Keep modifications targeted with \`patch_node\`.`;

// 6. Clean SCHEMA_RULES
delete catalog.SCHEMA_RULES; // redundant now

// 7. Clean THINKING_PROTOCOL
catalog.THINKING_PROTOCOL = `## THINKING PROTOCOL
- **Observe**: Read previous tool results and inspect the current stage of the plan.
- **Action First**: Call tools immediately (\`search_nodes\`, \`read_node\`, \`patch_node\`).
- **Evaluate**: after modifying a node, ask: "Did it work correctly?". Use \`read_node\` to verify if unsure.
- **Iterative**: Use tool responses to guide your next move.`;

// 8. Clean MODE_GUIDANCE
catalog.MODE_GUIDANCE = {
  PLANNING: `## MODE: PLANNING
- **Goal**: Understand the user's request and locate the relevant elements.
- **Behavior**:
  1. Translate the user's request into target nodes.
  2. Use \`search_nodes\` to find where to apply changes.
  3. Formulate a short mental plan and proceed.`,
  EXECUTION: `## MODE: EXECUTION (STRICT)
- **Goal**: Execute changes safely via the File System Exploration paradigm (Explore -> Read -> Overwrite).
- **CRITICAL: SEARCH FIRST**: Before modifying anything, use \`search_nodes\` to find the exact \`id\`.
- **READ BEFORE WRITE**: Use \`read_node\` to understand the current state before applying \`patch_node\`.
- **ZERO Text Narration**: Focus 100% on tool calls. Do not output descriptive text.`,
  VERIFICATION: `## MODE: VERIFICATION
- **Goal**: Validate your changes.
- **Action**: Use \`read_node\` on the elements you just modified to ensure their properties match what you intended.`,
  RECOVERY: `## MODE: RECOVERY
- **Goal**: Diagnose failure causes.
- **Action**: If \`patch_node\` fails, use \`read_node\` or \`search_nodes\` to verify if the element exists and what its current state is.`
};

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log('Cleaned prompt-catalog.json successfully.');
