/**
 * @file toolSerializer.ts
 * @description Tool serialization helpers for prompt composition.
 * Extracted from promptComposer.ts for reuse.
 */

import { ToolDefinition } from '../../agent/tools/types';
import { HIGH_FREQ_TOOL_NAMES, deriveMenuSummary } from '../../agent/tools/unified/toolCategories';

/**
 * Serialize tool definitions into a compact format for the prompt.
 *
 * Legacy flat list — kept for tests and any caller that wants the old
 * unsegmented shape. Production code uses `serializeToolsCategorized`.
 */
export function serializeTools(tools: ToolDefinition[]): string {
    return tools.map(tool => `- **${tool.name}**: ${tool.description}`).join('\n');
}

/**
 * Serialize tools split into a high-frequency block (full descriptions)
 * and a menu block (one-line summaries). The menu directs the model to
 * call `tool_search` when it needs full details or parameter examples.
 *
 * Saves ~15-18K prompt chars vs. the flat list by replacing the descriptions
 * of low-frequency tools (~28 tools × ~600 chars avg) with one-liners.
 *
 * Tools whose name is not in `HIGH_FREQ_TOOL_NAMES` go to the menu block.
 */
export function serializeToolsCategorized(tools: ToolDefinition[]): string {
    const detailed: ToolDefinition[] = [];
    const menu: ToolDefinition[] = [];
    for (const tool of tools) {
        if (HIGH_FREQ_TOOL_NAMES.has(tool.name)) {
            detailed.push(tool);
        } else {
            menu.push(tool);
        }
    }

    const parts: string[] = [];

    if (detailed.length > 0) {
        parts.push('### Detailed (high-frequency — full description below)');
        parts.push(detailed.map(t => `- **${t.name}**: ${t.description}`).join('\n'));
    }

    if (menu.length > 0) {
        parts.push(
`### Menu (low-frequency — one-line summary)
These tools are listed by name + short hook only. Their full description and parameter examples live in the provider's tools API (your function-calling spec), so you CAN call them directly. If you need to refresh details or examples mid-conversation, call \`tool_search({tool_names: [...]})\` to pull the full description into recent context.`
        );
        parts.push(menu.map(t => `- **${t.name}**: ${deriveMenuSummary(t)}`).join('\n'));
    }

    return parts.join('\n\n');
}
