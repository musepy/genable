/**
 * @file toolSerializer.ts
 * @description Tool serialization helpers for prompt composition.
 * Extracted from promptComposer.ts for reuse.
 */

import { ToolDefinition } from '../../agent/tools/types';

/**
 * Serialize tool definitions into a compact format for the prompt.
 */
export function serializeTools(tools: ToolDefinition[]): string {
    return tools.map(tool => `- **${tool.name}**: ${tool.description}`).join('\n');
}
