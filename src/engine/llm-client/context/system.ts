/**
 * @file system.ts
 * @description Single static system prompt builder.
 *
 * Assembles the system prompt ONCE at agent creation time.
 * The result never changes between iterations, enabling KV-cache
 * reuse at the LLM provider layer.
 *
 * All static prompt content comes from 3 catalog files:
 *   CORE          — Identity, environment, scene graph, visual quality, conventions, design freedom
 *   WORKFLOW      — Tool calling, creation, error recovery, completion protocol
 *   TOOL_EXAMPLES — Tool usage examples
 */

import { ToolDefinition } from '../../agent/tools/types';
import {
    CORE,
    WORKFLOW,
    TOOL_EXAMPLES,
} from '../../prompt/promptRegistry';
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

    // 1. Core (identity + environment + scene graph + visual quality + conventions + design freedom)
    parts.push(CORE.trim());

    // 2. Workflow (tool calling + creation + error recovery + completion protocol)
    if (WORKFLOW) {
        parts.push(WORKFLOW.trim());
    }

    // 5. Persistent memory hint
    parts.push(
`## PERSISTENT MEMORY
You have persistent memory at \`/.agent/memory/\`. Use standard commands to read and write:
- \`ls /.agent/memory/\` — list stored memories
- \`cat /.agent/memory/\` — read all memories
- \`cat /.agent/memory/key\` — read a specific memory
- \`mk /.agent/memory/key text -- value\` — save a memory (persists across sessions)
- \`rm /.agent/memory/key\` — delete a memory
Use this to remember user preferences, design patterns, or anything useful across conversations.`
    );

    // 5b. Scratchpad hint (session-scoped working memory)
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

    // 5c. Subtask delegation hint
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

    // 6. Tool definitions (serialized, with category grouping)
    if (tools.length > 0) {
        const hasCategories = tools.some(t => t.category);
        const toolsBody = hasCategories
            ? serializeToolsByPhase(tools)
            : serializeTools(tools);
        parts.push('## AVAILABLE TOOLS\nUse these tools to gather knowledge, validate designs, or perform rendering actions:\n\n' + toolsBody);
    } else {
        parts.push('## AVAILABLE TOOLS\nNo specific tools are available for this session.');
    }

    // 7. Tool examples
    if (TOOL_EXAMPLES) {
        parts.push(TOOL_EXAMPLES.trim());
    }

    // 8. Provider tool instructions
    const providerInstructions = provider.getToolSystemInstruction(tools);
    if (providerInstructions) {
        parts.push(providerInstructions.trim());
    }

    const finalPrompt = parts.filter(Boolean).join('\n\n');

    console.log(`[StaticSystemPrompt] Built once: ~${Math.ceil(finalPrompt.length / 4)} tokens`);
    return finalPrompt;
}
