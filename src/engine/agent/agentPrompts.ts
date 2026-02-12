/**
 * @file agentPrompts.ts
 * @description Re-exports agent prompts from the centralized prompt registry.
 *
 * All prompt definitions now live in `engine/prompt/promptRegistry.ts`.
 * This file exists solely for backward compatibility — existing consumers
 * can continue to `import { AGENT_IDENTITY } from './agentPrompts'`.
 */

export {
    AGENT_IDENTITY,
    AGENT_THINKING_PROTOCOL,
    DYNAMIC_GUIDANCE,
    DEEP_NODE_PROCESSING_PROTOCOL,
    AGENT_NAMING_CONVENTION,
    AGENT_CONTENT_REQUIREMENT,
    AGENT_PARENT_CHILD_RULE,
    AGENT_DESIGN_FREEDOM,
    SCHEMA_RULES as JSON_FORMAT_RULES,
} from '../prompt/promptRegistry';
