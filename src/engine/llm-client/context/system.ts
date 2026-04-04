/**
 * @file system.ts
 * @description Single static system prompt builder.
 *
 * Assembles the system prompt ONCE at agent creation time.
 * The result never changes between iterations, enabling KV-cache
 * reuse at the LLM provider layer.
 *
 * Prompt content comes from two catalog files:
 *   SYSTEM — Identity, environment, scene graph, design thinking, conventions (WHAT & WHY)
 *   SOP    — Workflows, creation flow, verification gate, quality patterns (HOW)
 */

import { ToolDefinition } from '../../agent/tools/types';
import { SYSTEM, SOP } from '../../prompt/promptRegistry';
import { serializeTools } from './toolSerializer';

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

    // 1. System prompt (WHAT & WHY: identity + environment + scene graph + design thinking + conventions)
    parts.push(SYSTEM.trim());

    // 2. SOP (HOW: workflows + creation flow + verification gate + quality patterns)
    parts.push(SOP.trim());

    // 3. Persistent memory hint + management directives
    parts.push(
`## PERSISTENT MEMORY
You have persistent memory that survives across sessions. Use the memory tools:
- \`list_memories()\` — list all stored memories
- \`list_memories({key: "brand-colors"})\` — read a specific memory
- \`save_memory({key: "typography", value: "Headlines: Space Grotesk 32px. Body: Inter 16px."})\` — save a memory
- \`delete_memory({key: "old-palette"})\` — delete a memory

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

On warm start (when memory is pre-loaded into context): briefly acknowledge what you remember, then proceed.
  GOOD: "I see your brand uses #2563EB with Inter. I'll keep it consistent."
  BAD: "Loading memory... Found 5 entries... Entry 1: brand-colors..."`
    );

    // 4. Scratchpad hint (session-scoped working memory)
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

    // 5. Subtask delegation hint
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

    // 6. Tool definitions
    if (tools.length > 0) {
        parts.push('## AVAILABLE TOOLS\nUse these tools to gather knowledge, create designs, inspect results, and modify properties:\n\n' + serializeTools(tools));
    } else {
        parts.push('## AVAILABLE TOOLS\nNo specific tools are available for this session.');
    }

    // 7. Provider tool instructions
    const providerInstructions = provider.getToolSystemInstruction(tools);
    if (providerInstructions) {
        parts.push(providerInstructions.trim());
    }

    const finalPrompt = parts.filter(Boolean).join('\n\n');

    console.log(`[StaticSystemPrompt] Built once: ~${Math.ceil(finalPrompt.length / 4)} tokens`);
    return finalPrompt;
}
