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
 * @param skillMenu - Lightweight skill index (id + description) for system prompt
 */
export function buildStaticSystemPrompt(
    tools: ToolDefinition[],
    provider: { getToolSystemInstruction: (tools: ToolDefinition[]) => string },
    skillMenu: Array<{ id: string; description: string }>
): string {
    const parts: string[] = [];

    // 1. Core (identity + environment + scene graph + visual quality + conventions + design freedom)
    parts.push(CORE.trim());

    // 2. Workflow (tool calling + creation + error recovery + completion protocol)
    if (WORKFLOW) {
        parts.push(WORKFLOW.trim());
    }

    // 3. Skill menu (lightweight index — LLM calls query_knowledge to load details)
    if (skillMenu.length > 0) {
        const menuLines = skillMenu.map(s => `- **${s.id}**: ${s.description}`);
        parts.push([
            '## Available Skills',
            'Call `query_knowledge(source="skill", query="<skill-id>")` to load detailed instructions.',
            ...menuLines,
        ].join('\n'));
    }

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
