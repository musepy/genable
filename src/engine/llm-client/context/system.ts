/**
 * @file system.ts
 * @description Single static system prompt builder.
 *
 * Assembles the system prompt ONCE at agent creation time.
 * The result never changes between iterations, enabling KV-cache
 * reuse at the LLM provider layer.
 *
 * All static prompt content comes from 3 catalog files:
 *   CORE          — Identity, thinking protocol, design freedom
 *   DESIGN_RULES  — Scene graph model, visual quality, conventions
 *   WORKFLOW      — Tool calling, creation, error recovery, completion protocol
 *   TOOL_EXAMPLES — Tool usage examples
 */

import { ToolDefinition } from '../../agent/tools/types';
import {
    CORE,
    DESIGN_RULES,
    WORKFLOW,
    TOOL_EXAMPLES,
} from '../../prompt/promptRegistry';
import { serializeTools, serializeToolsByPhase } from './toolSerializer';

/**
 * Concise autonomous behavior rules.
 * Distilled from the 4 legacy phase-specific blocks (~763 tokens) into
 * a single phase-agnostic block (~180 tokens). The agent decides its own
 * planning/execution/verification rhythm — we only state the invariants.
 */
const AUTONOMOUS_BEHAVIOR = `## AUTONOMOUS BEHAVIOR
You decide when to plan, execute, and verify. Follow these invariants:

- **Plan briefly, then act.** Analyze in 1-2 sentences, then call tools. Multiple planning turns without mutations is a failure.
- **Start with tools, not narration.** Keep text minimal and action-oriented.
- **New designs → one-shot \`build_design\`.** Write all nodes in a single \`build_design\` call with explicit sizing; avoid create-then-restyle loops.
- **Editing → \`read_node\` first.** Get real node IDs, then \`patch_node\`. Group related patches into one call.
- **Check anomalies in results.** \`build_design\` and \`patch_node\` return \`anomalies\` inline — fix them with focused \`patch_node\` before completing.
- **Complete with signal.** End with \`signal({ type: "complete", summary, verification })\`.
- **Recovery: diagnose, don't retry blindly.** On failure, call \`read_node\` first, identify the root cause, then change strategy. Never repeat the same write without new evidence.
- **Progress throttle:** at most one \`signal({ type: "progress" })\` per iteration.`;

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

    // 1. Core identity + thinking protocol + design freedom
    parts.push(CORE.trim());

    // 2. Design knowledge (scene graph + visual quality + conventions)
    if (DESIGN_RULES) {
        parts.push(DESIGN_RULES.trim());
    }

    // 3. Workflow (tool calling + creation + error recovery + completion protocol)
    if (WORKFLOW) {
        parts.push(WORKFLOW.trim());
    }

    // 4. Autonomous behavior rules (distilled from legacy phase guidance)
    parts.push(AUTONOMOUS_BEHAVIOR.trim());

    // 5. Skill menu (lightweight index — LLM calls query_knowledge to load details)
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
