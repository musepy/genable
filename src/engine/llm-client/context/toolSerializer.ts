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

/**
 * Phase-based tool serialization with category grouping and dependency hints.
 * Groups: read+knowledge (parallel), create+modify (sequential).
 */
export function serializeToolsByPhase(tools: ToolDefinition[]): string {
    const groups = {
        read: tools.filter(t => t.category === 'read' || t.category === 'knowledge'),
        execute: tools.filter(t => t.category === 'create' || t.category === 'modify'),
    };

    const formatTool = (tool: ToolDefinition) => {
        const deps = tool.dependencies && tool.dependencies.length > 0
            ? ` (after: ${tool.dependencies.join(', ')})`
            : '';
        return `- **${tool.name}**${deps}: ${tool.description}`;
    };

    const sections = [];

    if (groups.read.length > 0) {
        sections.push(`### Information Gathering (Parallel)
${groups.read.map(formatTool).join('\n')}`);
    }

    if (groups.execute.length > 0) {
        sections.push(`### Execution (Sequential, respect dependencies)
Parent-child create commands MUST be sequential. Wait for parent nodeId before creating children.
${groups.execute.map(formatTool).join('\n')}`);
    }

    return sections.join('\n\n');
}
