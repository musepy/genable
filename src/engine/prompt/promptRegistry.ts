/**
 * @file promptRegistry.ts
 * @description Single source of truth for ALL prompt fragments.
 *
 * CATALOG KEY (from src/prompts/CORE.md → prompt-catalog.json):
 *   CORE — Identity, environment, scene graph, design thinking, conventions, creation protocol, turn management
 *
 * RULES:
 * 1. ALL prompt text the LLM sees MUST come from the catalog (or be re-exported here).
 * 2. Consumers import from this file. Never hard-code prompt text elsewhere.
 */

import catalog from '../../generated/prompt-catalog.json';

/** The unified system prompt — identity + mental model + design + workflow + turn management */
export const CORE = catalog.CORE;
