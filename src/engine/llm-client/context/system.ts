/**
 * @file system.ts
 * @description Single static system prompt builder.
 *
 * Assembles the system prompt ONCE at agent creation time.
 * The result never changes between iterations, enabling KV-cache
 * reuse at the LLM provider layer.
 *
 * All static prompt content comes from one catalog file:
 *   CORE — Identity, environment, scene graph, design thinking, conventions, creation protocol, turn management
 */

import { ToolDefinition } from '../../agent/tools/types';
import { CORE } from '../../prompt/promptRegistry';
import { serializeTools, serializeToolsByPhase } from './toolSerializer';

/**
 * Build the static system prompt that is set once and never changes.
 *
 * @param tools - Available tool definitions
 * @param provider - LLM provider (for tool system instructions)
 */
export function buildStaticSystemPrompt(
    tools: ToolDefinition[],
    provider: { getToolSystemInstruction: (tools: ToolDefinition[]) => string },
): string {
    const parts: string[] = [];

    // 1. Core (identity + environment + scene graph + design thinking + conventions + creation + turn management)
    parts.push(CORE.trim());

    // 2. Persistent memory hint + management directives
    parts.push(
`## PERSISTENT MEMORY
You have persistent memory at \`/.agent/memory/\`. Use standard commands to read and write:
- \`ls /.agent/memory/\` — list stored memories
- \`cat /.agent/memory/\` — read all memories
- \`cat /.agent/memory/key\` — read a specific memory
- \`mk /.agent/memory/key text -- value\` — save a memory (persists across sessions)
- \`rm /.agent/memory/key\` — delete a memory

### Memory Management
On each turn end, evaluate: did the user establish any REUSABLE design decisions?

WRITE memory when:
- User specifies brand colors, fonts, or spacing preferences
- User says "always" / "from now on" / "remember" about a design choice
- A design system pattern is established (e.g., "all cards use 12px corner radius")

DO NOT write memory when:
- One-off styling choices ("make this button red")
- Temporary experiments
- Layout decisions that only apply to this specific design

Memory format: natural language + structured data. Example:
  Key: "typography"
  Value: "Headlines: Space Grotesk 32px Medium. Body: Inter 16px Regular. User prefers generous line height (1.5+)."

On warm start (when memory is pre-loaded into context): briefly acknowledge what you remember, then proceed.
  GOOD: "I see your brand uses #2563EB with Inter. I'll keep it consistent."
  BAD: "Loading memory... Found 5 entries... Entry 1: brand-colors..."`
    );

    // 3. Scratchpad hint (session-scoped working memory)
    parts.push(
`## SCRATCHPAD (Session Working Memory)
Session-scoped notepad at \`/.agent/scratch/\`. Use it to store intermediate data during complex tasks:
- \`mk /.agent/scratch/plan text -- Step 1: create card frame...\` — save a note
- \`cat /.agent/scratch/plan\` — read it back
- \`ls /.agent/scratch/\` — list all notes
- \`rm /.agent/scratch/plan\` — delete a note
Unlike persistent memory, scratchpad is cleared when the session ends. Use it for:
- Node ID mappings (tempId → realId)
- Design plans for multi-step work
- Color palettes or spacing values to reuse`
    );

    // 4. Subtask delegation hint
    parts.push(
`## SUBTASK DELEGATION
For complex multi-part designs, delegate independent sections to focused sub-agents:
- \`subtask Design a sidebar with logo, nav links, and user profile\`
- \`subtask Create a data table with headers, rows, and pagination\`
Each subtask gets its own iteration budget and focus. Use when:
- A design has 3+ independent sections (sidebar, header, content, footer)
- You want to ensure each section gets full attention
Do NOT use subtask for simple operations (1-2 tool calls) or dependent work.`
    );

    // 4.5. Layout quality rules (high-frequency failure patterns)
    parts.push(
`## LAYOUT QUALITY RULES
These rules address the most common design quality failures. Violating them produces designs that look like wireframes, not finished products.

1. **Label + Control rows** (toggle, checkbox, input with label): ALWAYS use layout:row with the label on the left (w:fill) and the control on the right (fixed width). This creates proper space-between alignment.
   - GOOD: \`<frame layout="row" w="fill" gap={16}><frame name="Label" w="fill">...</frame><frame name="Toggle" w={52}>...</frame></frame>\`
   - BAD: \`<frame layout="row" gap={16}><frame name="Label">...</frame><frame name="Toggle">...</frame></frame>\` (both hug = control not right-aligned)

2. **Icons and avatars**: NEVER create an empty frame as a visual placeholder. Use \`icon\` type with a lucide icon name, or a text emoji, or a colored circle with initials.
   - GOOD: \`<icon name="Bell" icon="lucide:bell" size={20} />\` or \`<frame w={96} h={96} corner="full" bg="#E0E7FF"><text size={32}>SC</text></frame>\`
   - BAD: \`<frame w={20} h={20} />\` (invisible empty box)

3. **Flex containers with 3+ children**: ALWAYS set an explicit gap value. Zero gap between items makes everything look cramped.
   - Parent frames (page-level sections): gap={32} or gap={24}
   - Card internals: gap={16} or gap={12}
   - Tight groups (label + sublabel): gap={4}

4. **Every card/page needs at least one CTA**: login → Sign In button, profile → Follow/Message button, settings → Save button, pricing → Choose Plan button. A design without actions is a wireframe.

5. **Figma ≠ CSS: space-between needs a fill child**: In CSS flexbox, space-between distributes space automatically. In Figma, if ALL children are hug/fixed, space-between has NO visible effect — children just stack from the start. You MUST make at least one child w="fill" (or h="fill" for vertical) to push siblings apart.
   - Toggle row: \`<frame layout="row" w="fill"><frame name="Label" w="fill">...</frame><frame name="Toggle" w={52}/></frame>\` — Label w:fill pushes Toggle to right edge
   - Card with CTA at bottom: \`<frame layout="column" h="fill"><frame name="Header">...</frame><frame name="Features" h="fill">...</frame><frame name="CTA" w="fill"/></frame>\` — Features h:fill pushes CTA to bottom

6. **Sibling cards in a row**: Each card MUST use w="fill" (NOT a fixed pixel width like w={320}). Figma auto-layout does NOT shrink fixed-width children — they overflow and get clipped. Use w="fill" so cards distribute the parent's width evenly.
   - GOOD: \`<frame layout="row" gap={24} w="fill"><frame name="Card1" w="fill">...</frame><frame name="Card2" w="fill">...</frame></frame>\`
   - BAD: \`<frame layout="row" gap={24} w="fill"><frame name="Card1" w={320}>...</frame><frame name="Card2" w={320}>...</frame></frame>\` (320×3 + gaps > parent width → clipped)
   - Also: sibling cards with different content lengths should ALL use h="fill" (sizingV:fill / stretch) so they share the same height. The CTA button stays at the bottom when using layout:column + space-between or by placing it last with the feature list taking w="fill".`
    );

    // 5. Tool definitions (serialized, with category grouping)
    if (tools.length > 0) {
        const hasCategories = tools.some(t => t.category);
        const toolsBody = hasCategories
            ? serializeToolsByPhase(tools)
            : serializeTools(tools);
        parts.push('## AVAILABLE TOOLS\nUse these tools to gather knowledge, validate designs, or perform rendering actions:\n\n' + toolsBody);
    } else {
        parts.push('## AVAILABLE TOOLS\nNo specific tools are available for this session.');
    }

    // 6. Provider tool instructions
    const providerInstructions = provider.getToolSystemInstruction(tools);
    if (providerInstructions) {
        parts.push(providerInstructions.trim());
    }

    const finalPrompt = parts.filter(Boolean).join('\n\n');

    console.log(`[StaticSystemPrompt] Built once: ~${Math.ceil(finalPrompt.length / 4)} tokens`);
    return finalPrompt;
}
