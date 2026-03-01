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
    AGENT_NAMING_CONVENTION,
    AGENT_CONTENT_REQUIREMENT,
    AGENT_DESIGN_FREEDOM
} from '../prompt/promptRegistry';
