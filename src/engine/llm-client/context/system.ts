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
For complex multi-part designs, delegate to typed sub-agents:
- \`subtask({ type: "create", prompt: "Design a sidebar with logo and nav links" })\`
- \`subtask({ type: "audit", prompt: "Check the header for spacing and alignment issues" })\`
- \`subtask({ type: "token", prompt: "Create color tokens and bind to all surfaces" })\`
Agent types: create (build sections, default), audit (read-only review, VERDICT output), token (variable ops).
Use when:
- A design has 3+ independent sections — delegate each as type: "create"
- You want quality review of finished work — delegate as type: "audit"
- You need to set up design tokens — delegate as type: "token"
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

    // 8. Communication language (user preference)
    if (locale && locale !== 'en') {
        const langName = LOCALE_FULL_NAMES[locale]?.split(' ')[0] || locale;
        parts.push(`## COMMUNICATION LANGUAGE\nAlways respond to the user in ${langName}. All text output, explanations, and descriptions must be in ${langName}. Tool parameters (node names, property values) remain in the user's design language.`);
    }

    const finalPrompt = parts.filter(Boolean).join('\n\n');

    console.log(`[StaticSystemPrompt] Built once: ~${Math.ceil(finalPrompt.length / 4)} tokens`);
    return finalPrompt;
}
