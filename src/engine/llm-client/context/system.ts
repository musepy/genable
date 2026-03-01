/**
 * @file system.ts
 * @description Single static system prompt builder.
 *
 * Assembles the system prompt ONCE at agent creation time.
 * The result never changes between iterations, enabling KV-cache
 * reuse at the LLM provider layer.
 *
 * Per-iteration mode changes go into a tiny dynamic context message
 * (see dynamicContext.ts) — NOT into the system prompt.
 */

import { ToolDefinition } from '../../agent/tools/types';
import {
    AGENT_IDENTITY,
    AGENT_DESIGN_FREEDOM,
    AGENT_THINKING_PROTOCOL,
    FIGMA_MENTAL_MODEL,
    DESIGN_RULES,
    WORKFLOW,
    TOOL_EXAMPLES,
    ERROR_HANDLING,
} from '../../agent/agentPrompts';
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
- **New designs → one-shot \`build_design\`.** Write all nodes in a single DSL script with explicit sizing; avoid create-then-restyle loops.
- **Editing → \`read_node\` first.** Get real node IDs, then \`patch_node\`. Group related patches into one call.
- **Validate before completing.** Run \`validate_design\` on the target root. If issues exist, fix with focused \`patch_node\` and re-validate.
- **Complete with signal.** End with \`signal({ type: "complete", summary, verification })\`.
- **Recovery: diagnose, don't retry blindly.** On failure, call \`read_node\`/\`validate_design\` first, identify the root cause, then change strategy. Never repeat the same write without new evidence.
- **Progress throttle:** at most one \`signal({ type: "progress" })\` per iteration.`;

/**
 * Build the static system prompt that is set once and never changes.
 *
 * @param tools - Available tool definitions
 * @param provider - LLM provider (for tool system instructions)
 * @param skillBodies - System-injected skill prompt sections
 */
export function buildStaticSystemPrompt(
    tools: ToolDefinition[],
    provider: { getToolSystemInstruction: (tools: ToolDefinition[]) => string },
    skillBodies: string[]
): string {
    const parts: string[] = [];

    // 1. Agent identity constants
    parts.push(AGENT_IDENTITY.trim());
    parts.push(AGENT_DESIGN_FREEDOM.trim());
    parts.push(AGENT_THINKING_PROTOCOL.trim());

    // 2. Design knowledge (scene graph model + design rules)
    if (FIGMA_MENTAL_MODEL) {
        parts.push(FIGMA_MENTAL_MODEL.trim());
    }
    if (DESIGN_RULES) {
        parts.push(DESIGN_RULES.trim());
    }

    // 3. Workflow rules (tool calling, creation, modification protocols)
    if (WORKFLOW) {
        parts.push(WORKFLOW.trim());
    }

    // 4. Autonomous behavior rules (distilled from legacy phase guidance)
    parts.push(AUTONOMOUS_BEHAVIOR.trim());

    // 5. Skill bodies (from SKILL.md files with injectionType: 'system')
    for (const body of skillBodies) {
        if (body) parts.push(body.trim());
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

    // 8. Error recovery
    if (ERROR_HANDLING) {
        parts.push(ERROR_HANDLING.trim());
    }

    // 9. Provider tool instructions
    const providerInstructions = provider.getToolSystemInstruction(tools);
    if (providerInstructions) {
        parts.push(providerInstructions.trim());
    }

    const finalPrompt = parts.filter(Boolean).join('\n\n');

    console.log(`[StaticSystemPrompt] Built once: ~${Math.ceil(finalPrompt.length / 4)} tokens`);
    return finalPrompt;
}
