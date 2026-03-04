/**
 * @file promptRegistry.ts
 * @description Single source of truth for ALL prompt fragments.
 *
 * CATALOG KEYS (from src/prompts/*.md → prompt-catalog.json):
 *   CORE          — Identity, environment, scene graph, visual quality, conventions, design freedom
 *   WORKFLOW      — Tool calling, creation, error recovery, completion protocol
 *   EXAMPLES      — Tool usage examples
 *
 * RULES:
 * 1. ALL prompt text the LLM sees MUST come from the catalog (or be re-exported here).
 * 2. Consumers import from this file. Never hard-code prompt text elsewhere.
 */

import catalog from '../../generated/prompt-catalog.json';

/** Agent identity + environment + scene graph + visual quality + conventions + design freedom */
export const CORE = catalog.CORE;

/** Tool calling + design generation + parent-child + error recovery + completion protocol */
export const WORKFLOW = catalog.WORKFLOW;

/** Tool usage examples */
export const TOOL_EXAMPLES = catalog.EXAMPLES;
