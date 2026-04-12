/**
 * @file system.ts
 * @description Single static system prompt builder.
 *
 * Assembles the system prompt ONCE at agent creation time.
 * The result never changes between iterations, enabling KV-cache
 * reuse at the LLM provider layer.
 *
 * Prompt content comes from one catalog file:
 *   SYSTEM — Identity, environment, scene graph, design thinking, conventions (WHAT & WHY)
 *
 * Procedures (HOW) live in src/prompts/help/*.md and are retrieved on demand
 * via the `knowledge` tool.
 */

import { ToolDefinition } from '../../agent/tools/types';
import { SYSTEM } from '../../prompt/promptRegistry';
import { serializeTools } from './toolSerializer';
import { KNOWLEDGE_LIBRARY_SECTION } from './knowledgeLibrarySection';
import { LOCALE_FULL_NAMES, type Locale } from '../../../ui/i18n';

/**
 * Build the static system prompt that is set once and never changes.
 *
 * @param tools - Available tool definitions
 * @param provider - LLM provider (for tool system instructions)
 */
export function buildStaticSystemPrompt(
    tools: ToolDefinition[],
    provider: { getToolSystemInstruction: (tools: ToolDefinition[]) => string },
    locale?: Locale,
): string {
    const parts: string[] = [];

    // 1. System prompt (WHAT & WHY: identity + environment + scene graph + design thinking + conventions)
    parts.push(SYSTEM.trim());

    // 2. Knowledge library menu (full id + description list — lets the LLM pick
    // entries directly via knowledge.read instead of guessing keywords with search)
    parts.push(KNOWLEDGE_LIBRARY_SECTION.trim());

    // 3. Subtask delegation hint (typed agents)
    parts.push(
`## SUBTASK DELEGATION
Delegate focused work to child agents. Each subtask is an independent runtime with its own iteration budget.

### Agent types
- **create**: Build a UI section or page. Budget: 15 iterations.
- **audit**: Read-only design review. Reports PASS/FAIL/WARN. Budget: 8 iterations.
- **token**: Variable system operations (create/bind/alias). Budget: 10 iterations.

### When to delegate
- A design has 3+ independent sections that each deserve full attention
- You need a quality audit of finished work
- Variable system setup is needed as a separate focused task

### Workflow for multi-section pages
1. **Plan first**: decide the page structure, shared style, and section breakdown
2. **Create the page container**: use jsx to create the outer frame with layout properties
3. **Delegate each section**: tell each subtask the parent container ID and design constraints
   Example: subtask({ type: "create", prompt: "Build the hero section INSIDE Page#1:2. Use 16px grid, Inter font, primary #6366F1. Full-width, 480px tall." })
4. **Verify**: after all subtasks complete, use describe to check the assembled page

### Workflow for independent pages
Delegate directly — each subtask creates at canvas root:
  subtask({ type: "create", prompt: "Design a login page. Style: Inter, primary #6366F1, 400px wide." })

### What to include in the subtask prompt
- **WHERE**: parent container ID (if building inside an existing frame)
- **WHAT**: specific section/component to build
- **STYLE**: design constraints (font, colors, spacing, sizing)
- **CONTEXT**: relationship to siblings ("this is section 2 of 4, after the header")

### Do NOT use subtask for
- Simple operations (1-2 tool calls) — just do them inline
- Dependent sequential work where step 2 needs step 1's output
- Assembling pieces that subtasks created — move_node or inspect yourself`
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

    // 8. Communication language (user preference)
    if (locale && locale !== 'en') {
        const langName = LOCALE_FULL_NAMES[locale]?.split(' ')[0] || locale;
        parts.push(`## COMMUNICATION LANGUAGE\nAlways respond to the user in ${langName}. All text output, explanations, and descriptions must be in ${langName}. Tool parameters (node names, property values) remain in the user's design language.`);
    }

    const finalPrompt = parts.filter(Boolean).join('\n\n');

    console.log(`[StaticSystemPrompt] Built once: ~${Math.ceil(finalPrompt.length / 4)} tokens`);
    return finalPrompt;
}
