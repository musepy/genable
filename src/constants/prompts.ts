/**
 * @file prompts.ts
 * @description Re-exports prompt constants from the centralized prompt registry.
 *
 * All prompt definitions now live in `engine/prompt/promptRegistry.ts`.
 * This file exists solely for backward compatibility.
 *
 * REMOVED: PROPERTY ALIASES section (stale — aliases like "spacing", "borderRadius"
 * are no longer resolved by the normalizer).
 */

export {
    ICON_SEMANTIC_TEMPLATE,
    DESIGN_AGENT_PERSONA_TEMPLATE,
    PROMPT_HEADERS,
} from '../engine/prompt/promptRegistry';
