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
 */
export function serializeToolsByPhase(tools: ToolDefinition[]): string {
    const phases = {
        read: tools.filter(t => t.category === 'read'),
        knowledge: tools.filter(t => t.category === 'knowledge'),
        plan: tools.filter(t => t.category === 'plan'),
        create: tools.filter(t => t.category === 'create'),
        modify: tools.filter(t => t.category === 'modify'),
        validate: tools.filter(t => t.category === 'validate')
    };

    const formatTool = (tool: ToolDefinition) => {
        const deps = tool.dependencies && tool.dependencies.length > 0
            ? ` (after: ${tool.dependencies.join(', ')})`
            : '';
        return `- **${tool.name}**${deps}: ${tool.description}`;
    };

    const sections = [];

    if (phases.read.length > 0 || phases.knowledge.length > 0) {
        sections.push(`### Phase 1: Information Gathering (Parallel)
${[...phases.read, ...phases.knowledge].map(formatTool).join('\n')}`);
    }

    if (phases.plan.length > 0) {
        sections.push(`### Phase 2: Planning (Sequential)
${phases.plan.map(formatTool).join('\n')}`);
    }

    if (phases.create.length > 0 || phases.modify.length > 0) {
        sections.push(`### Phase 3: Execution (Sequential, respect dependencies)
Parent-child create commands MUST be sequential. Wait for parent nodeId before creating children.
${[...phases.create, ...phases.modify].map(formatTool).join('\n')}`);
    }

    if (phases.validate.length > 0) {
        sections.push(`### Phase 4: Validation (Parallel)
${phases.validate.map(formatTool).join('\n')}`);
    }

    return sections.join('\n\n');
}
