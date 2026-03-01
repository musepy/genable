/**
 * @file agentPrompts.ts
 * @description Re-exports agent prompts from the centralized prompt registry,
 * plus composite constants used by the static system prompt builder.
 *
 * All prompt definitions now live in `engine/prompt/promptRegistry.ts`.
 */

export {
    AGENT_IDENTITY,
    AGENT_THINKING_PROTOCOL,
    AGENT_DESIGN_FREEDOM,
    DESIGN_RULES,
    WORKFLOW,
    FIGMA_MENTAL_MODEL,
    TOOL_EXAMPLES,
    ERROR_HANDLING,
} from '../prompt/promptRegistry';
